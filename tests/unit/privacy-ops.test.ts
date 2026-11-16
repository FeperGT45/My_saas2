import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
const db = new PGlite(),
  user = 'a0000000-0000-0000-0000-000000000001',
  other = 'a0000000-0000-0000-0000-000000000002';
async function rpc(name: string, args: unknown[] = []) {
  return (
    await db.query<{ v: unknown }>(
      `SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS v`,
      args,
    )
  ).rows[0].v;
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const name of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile('supabase/migrations/' + name, 'utf8'));
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [user, other]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Own'),($2,'Other')",
    [user, other],
  );
}, 30000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('deduplicates deletion requests, scopes identities and never changes learning/profile data', async () => {
  const before = (await db.query('SELECT * FROM public.users ORDER BY id'))
    .rows;
  await db.exec('SET ROLE service_role');
  const a = await rpc('request_account_deletion', [user, crypto.randomUUID()]);
  expect(
    await rpc('request_account_deletion', [user, crypto.randomUUID()]),
  ).toEqual(a);
  const b = await rpc('request_account_deletion', [other, crypto.randomUUID()]);
  expect(b).not.toEqual(a);
  expect(
    (await db.query('SELECT * FROM public.privacy_deletion_requests')).rows,
  ).toHaveLength(2);
  expect(
    (await db.query('SELECT * FROM public.users ORDER BY id')).rows,
  ).toEqual(before);
});
it('denies client tables and RPCs even with a claimed user id', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    for (const table of [
      'privacy_deletion_requests',
      'ops_error_counters',
      'ops_notification_leases',
    ])
      await expect(db.query('SELECT * FROM public.' + table)).rejects.toThrow(
        /permission denied/,
      );
    await expect(
      rpc('request_account_deletion', [other, crypto.randomUUID()]),
    ).rejects.toThrow(/permission denied/);
    await expect(rpc('record_ops_error', ['payment_webhook'])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      rpc('claim_ops_notification', ['ops_digest', 1800, false]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  }
});
it('aggregates only known error types without storing payloads', async () => {
  await db.exec('SET ROLE service_role');
  await rpc('record_ops_error', ['payment_webhook']);
  await rpc('record_ops_error', ['payment_webhook']);
  expect(
    (await db.query('SELECT code,occurrences FROM public.ops_error_counters'))
      .rows,
  ).toEqual([{ code: 'payment_webhook', occurrences: 2 }]);
  await expect(
    rpc('record_ops_error', ['secret_token=should-never-be-stored']),
  ).rejects.toThrow();
});
it('reserves one delivery, recovers an expired lease and refuses stale completion', async () => {
  await db.exec('SET ROLE service_role');
  const a = await rpc('claim_ops_notification', ['ops_digest', 1800, false]);
  expect(a).toEqual(expect.any(String));
  expect(
    await rpc('claim_ops_notification', ['ops_digest', 1800, false]),
  ).toBeNull();
  await db.exec(
    "UPDATE public.ops_notification_leases SET reserved_until=now()-interval '1 minute' WHERE key='ops_digest'",
  );
  const b = await rpc('claim_ops_notification', ['ops_digest', 1800, false]);
  expect(b).not.toBe(a);
  await rpc('complete_ops_notification', ['ops_digest', a, true]);
  expect(
    (
      await db.query<{ delivered_at: string | null }>(
        "SELECT delivered_at FROM public.ops_notification_leases WHERE key='ops_digest'",
      )
    ).rows[0].delivered_at,
  ).toBeNull();
  await rpc('complete_ops_notification', ['ops_digest', b, true]);
  expect(
    await rpc('claim_ops_notification', ['ops_digest', 1800, false]),
  ).toBeNull();
});
it('sends a setup notification once; failed deliveries remain retryable', async () => {
  await db.exec('SET ROLE service_role');
  const a = await rpc('claim_ops_notification', ['monitor_ready', 1800, true]);
  await rpc('complete_ops_notification', ['monitor_ready', a, false]);
  await db.exec(
    "UPDATE public.ops_notification_leases SET reserved_until=now()-interval '1 minute' WHERE key='monitor_ready'",
  );
  const b = await rpc('claim_ops_notification', ['monitor_ready', 1800, true]);
  await rpc('complete_ops_notification', ['monitor_ready', b, true]);
  await db.exec(
    "UPDATE public.ops_notification_leases SET reserved_until=now()-interval '1 minute' WHERE key='monitor_ready'",
  );
  expect(
    await rpc('claim_ops_notification', ['monitor_ready', 1800, true]),
  ).toBeNull();
  expect(await rpc('privacy_ops_status')).toMatchObject({
    ready: true,
    version: 'privacy-ops-v3',
  });
});

it('keeps errors arriving during notification delivery pending after acknowledgement', async () => {
  await db.exec('SET ROLE service_role');
  const snapshot = (
    await db.query<{ occurrences: number }>(
      "SELECT occurrences FROM public.ops_error_counters WHERE code='payment_webhook'",
    )
  ).rows[0].occurrences;
  await rpc('record_ops_error', ['payment_webhook']);
  await db.query(
    "UPDATE public.ops_error_counters SET notified_occurrences=$1 WHERE code='payment_webhook'",
    [snapshot],
  );
  const row = (
    await db.query<{ occurrences: number; notified_occurrences: number }>(
      "SELECT occurrences,notified_occurrences FROM public.ops_error_counters WHERE code='payment_webhook'",
    )
  ).rows[0];
  expect(Number(row.occurrences)).toBeGreaterThan(
    Number(row.notified_occurrences),
  );
});

it('clears the delivery marker for a new attempt so an older success cannot hide a failed retry', async () => {
  await db.exec('SET ROLE service_role');
  await db.exec(
    "UPDATE public.ops_notification_leases SET reserved_until=now()-interval '1 minute' WHERE key='ops_digest'",
  );
  const id = await rpc('claim_ops_notification', ['ops_digest', 1800, false]);
  expect(id).toEqual(expect.any(String));
  expect(
    (
      await db.query<{ delivered_at: string | null }>(
        "SELECT delivered_at FROM public.ops_notification_leases WHERE key='ops_digest'",
      )
    ).rows[0].delivered_at,
  ).toBeNull();
  await rpc('complete_ops_notification', ['ops_digest', id, false]);
  expect(
    (
      await db.query<{ delivered_at: string | null }>(
        "SELECT delivered_at FROM public.ops_notification_leases WHERE key='ops_digest'",
      )
    ).rows[0].delivered_at,
  ).toBeNull();
});

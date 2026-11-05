import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  defaultAppearance,
  appearanceValid,
  themes,
} from '@/lib/premium/appearance';
import type { AppearanceData } from '@/lib/premium/appearance';
import type { ExtendedData } from '@/lib/placement/extended';
const db = new PGlite();
async function rpc<T = unknown>(f: string, a: unknown[] = []): Promise<T> {
  return (
    await db.query<{ v: T }>(
      `SELECT public.${f}(${a.map((_, i) => '$' + (i + 1)).join(',')}) AS v`,
      a,
    )
  ).rows[0].v;
}
async function user(premium = true) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Appearance learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Premium expansion isolated',
    ]);
  return id;
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const f of (await readdir('supabase/migrations')).sort()) {
    try {
      await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
    } catch (e) {
      throw Error(f + ': ' + (e as Error).message);
    }
  }
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('locks approved prices and durations, switches only unpaid plans and rejects client execution', async () => {
  const u = await user(false);
  await db.query('UPDATE public.users SET telegram_id=74101 WHERE id=$1', [u]);
  const key = randomUUID();
  const week = await rpc<{ payload: string; amount: number; days: number }>(
    'create_star_plan_order',
    [u, key, 'week'],
  );
  expect(week.amount).toBe(49);
  expect(week.days).toBe(7);
  expect(await rpc('create_star_plan_order', [u, key, 'week'])).toEqual(week);
  await expect(
    rpc('create_star_plan_order', [u, key, 'month']),
  ).rejects.toThrow('request plan mismatch');
  await expect(
    rpc('create_star_plan_order', [u, randomUUID(), 'lifetime']),
  ).rejects.toThrow('invalid premium plan');
  const month = await rpc<{ payload: string; amount: number; days: number }>(
    'create_star_plan_order',
    [u, randomUUID(), 'month'],
  );
  expect(month.amount).toBe(149);
  expect(month.days).toBe(30);
  expect(
    await rpc('check_star_checkout', [
      week.payload,
      74101,
      'XTR',
      49,
      'old-week',
    ]),
  ).toBe(false);
  expect(
    await rpc('check_star_checkout', [
      month.payload,
      74101,
      'XTR',
      49,
      'bad-price',
    ]),
  ).toBe(false);
  expect(
    await rpc('check_star_checkout', [
      month.payload,
      74101,
      'XTR',
      149,
      'month-q',
    ]),
  ).toBe(true);
  await expect(
    rpc('create_star_plan_order', [u, randomUUID(), 'week']),
  ).rejects.toThrow('checkout already approved');
  await db.exec('SET ROLE authenticated');
  await expect(
    rpc('create_star_plan_order', [u, randomUUID(), 'week']),
  ).rejects.toThrow('permission denied');
});
it.each([
  ['week', 7, 49, 'month', 30, 149],
  ['month', 30, 149, 'week', 7, 49],
] as const)(
  'grants %s accurately, preserves mixed durations through duplicate delivery, refund and reactivation',
  async (first, firstDays, firstPrice, second, secondDays, secondPrice) => {
    const u = await user(false),
      tg = first === 'week' ? 74102 : 74103;
    await db.query('UPDATE public.users SET telegram_id=$1 WHERE id=$2', [
      tg,
      u,
    ]);
    const a = await rpc<{ payload: string }>('create_star_plan_order', [
      u,
      randomUUID(),
      first,
    ]);
    await rpc('check_star_checkout', [
      a.payload,
      tg,
      'XTR',
      firstPrice,
      'a-' + u,
    ]);
    await db.query(
      "UPDATE public.star_orders SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [u],
    );
    const b = await rpc<{ payload: string }>('create_star_plan_order', [
      u,
      randomUUID(),
      second,
    ]);
    await rpc('check_star_checkout', [
      b.payload,
      tg,
      'XTR',
      secondPrice,
      'b-' + u,
    ]);
    const paid = (
      o: { payload: string },
      price: number,
      charge: string,
      refund = false,
    ) =>
      rpc('apply_star_event', [
        o.payload,
        tg,
        'XTR',
        price,
        charge + u,
        refund,
      ]);
    await expect(paid(a, firstPrice + 1, 'a')).rejects.toThrow(
      'payment mismatch',
    );
    await paid(a, firstPrice, 'a');
    await paid(a, firstPrice, 'a');
    await paid(b, secondPrice, 'b');
    const durations = () =>
      db.query<{ days: number }>(
        "SELECT extract(epoch FROM(ends_at-starts_at))/86400 AS days FROM public.subscriptions WHERE user_id=$1 AND status='active' ORDER BY starts_at",
        [u],
      );
    expect((await durations()).rows.map((r) => Number(r.days))).toEqual([
      firstDays,
      secondDays,
    ]);
    await paid(a, firstPrice, 'a', true);
    expect((await durations()).rows.map((r) => Number(r.days))).toEqual([
      secondDays,
    ]);
    expect(await rpc('has_premium', [u])).toBe(true);
    await paid(b, secondPrice, 'b', true);
    expect(await rpc('has_premium', [u])).toBe(false);
    const again = await rpc<{ payload: string }>('create_star_plan_order', [
      u,
      randomUUID(),
      first,
    ]);
    await rpc('check_star_checkout', [
      again.payload,
      tg,
      'XTR',
      firstPrice,
      'again-' + u,
    ]);
    await paid(again, firstPrice, 'again');
    expect((await durations()).rows.map((r) => Number(r.days))).toEqual([
      firstDays,
    ]);
  },
);
it('preserves free themes, protects Premium settings, persists previews and falls back after expiry without deleting choices', async () => {
  const free = await user(false);
  expect(Object.values(themes).filter((t) => !t.premium)).toHaveLength(3);
  expect(Object.values(themes).filter((t) => t.premium)).toHaveLength(5);
  expect(appearanceValid({ ...defaultAppearance, theme: 'unknown' })).toBe(
    false,
  );
  await db.exec('SET ROLE service_role');
  let d = await rpc<AppearanceData>('appearance_save', [
    free,
    JSON.stringify({ ...defaultAppearance, theme: 'slate' }),
    0,
  ]);
  expect(d.effective.theme).toBe('slate');
  await expect(
    rpc('appearance_save', [
      free,
      JSON.stringify({ ...defaultAppearance, theme: 'sakura' }),
      d.version,
    ]),
  ).rejects.toThrow('premium required');
  await db.exec('RESET ROLE');
  const u = await user();
  const paid = {
    theme: 'sakura',
    frame: 'orbit',
    badge: 'star',
    effect: 'spark',
    decoration: 'dots',
  };
  d = await rpc('appearance_save', [u, JSON.stringify(paid), 0]);
  expect(d.saved).toEqual(paid);
  await expect(
    rpc('appearance_save', [u, JSON.stringify(paid), 0]),
  ).rejects.toThrow('conflict');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  d = await rpc('appearance_read', [u]);
  expect(d.saved).toEqual(paid);
  expect(d.effective).toEqual(defaultAppearance);
  await rpc('grant_premium_access', [
    u,
    randomUUID(),
    30,
    'Restore appearance',
  ]);
  expect((await rpc<AppearanceData>('appearance_read', [u])).effective).toEqual(
    paid,
  );
});
async function complete(u: string, correct: boolean) {
  let d = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  const diffs: number[] = [];
  while (d.question) {
    const q = d.question;
    const raw = (
      await db.query<{ current: { level: string; correct_option: string } }>(
        'SELECT current FROM public.extended_attempts WHERE id=$1',
        [d.id],
      )
    ).rows[0].current;
    diffs.push(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(raw.level));
    const option = correct
        ? raw.correct_option
        : q.options.find((o) => o.id !== raw.correct_option)!.id,
      request = randomUUID();
    d = await rpc('extended_answer', [u, d.id, request, q.id, option]);
    expect(
      await rpc('extended_answer', [u, d.id, request, q.id, option]),
    ).toEqual(d);
  }
  return { d, diffs };
}
it('adapts difficulty up/down, saves 36 unique balanced questions and exposes review only at completion', async () => {
  const u = await user();
  await db.exec('SET ROLE service_role');
  const first = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  expect(first.review).toEqual([]);
  expect(JSON.stringify(first.question)).not.toContain('correct_option');
  const { d, diffs } = await complete(u, true);
  expect(d.answered).toBe(36);
  expect(d.review).toHaveLength(36);
  expect(new Set(d.review.map((q) => q.prompt)).size).toBe(36);
  expect(Object.values(d.result!.categories).map((s) => s.answered)).toEqual([
    12, 12, 12,
  ]);
  expect(diffs.at(-1)).toBeGreaterThan(diffs[0]);
  expect(d.result!.level).toMatch(/B2|C1|C2/);
  expect((await rpc<ExtendedData>('extended_read', [u, d.id])).result).toEqual(
    d.result,
  );
  const down = await complete(u, false);
  expect(down.d.result!.level).toBe('A1');
  expect(down.d.history).toHaveLength(2);
  expect(down.diffs.filter((n) => n === 0).length).toBeGreaterThan(0);
  expect(down.diffs.every((n) => n <= 1)).toBe(true);
  expect(
    (await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [u]))
      .rows,
  ).toEqual([]);
}, 30000);
it('rejects Free, чужие attempts, out-of-order answers and direct client mutation', async () => {
  const free = await user(false);
  await expect(rpc('extended_start', [free, randomUUID()])).rejects.toThrow(
    'premium required',
  );
  const u = await user(),
    other = await user(),
    d = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  await expect(rpc('extended_read', [other, d.id])).rejects.toThrow(
    'unavailable',
  );
  await expect(
    rpc('extended_answer', [u, d.id, randomUUID(), randomUUID(), 'a']),
  ).rejects.toThrow('conflict');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec('SET ROLE authenticated');
  expect(
    (
      await db.query(
        'SELECT * FROM public.appearance_settings WHERE user_id=$1',
        [u],
      )
    ).rows,
  ).toEqual([]);
  await expect(
    rpc('appearance_save', [u, JSON.stringify(defaultAppearance), 0]),
  ).rejects.toThrow('permission');
  await expect(
    db.query('SELECT * FROM public.extended_answers'),
  ).rejects.toThrow('permission');
  await expect(rpc('extended_start', [u, randomUUID()])).rejects.toThrow(
    'permission',
  );
});
it('preserves public leaderboard privacy while returning only effective cosmetics', async () => {
  const u = await user();
  await rpc('appearance_save', [
    u,
    JSON.stringify({ ...defaultAppearance, frame: 'pulse', badge: 'leaf' }),
    0,
  ]);
  await db.query(
    "UPDATE public.users SET leaderboard_visible=true,public_alias='Learner' WHERE id=$1",
    [u],
  );
  const a = randomUUID(),
    lesson = '40000000-0000-0000-0000-000000000001';
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,completed_at,score) VALUES($1,$2,$3,'completed',now(),100)",
    [a, u, lesson],
  );
  await db.query(
    'INSERT INTO public.xp_events(user_id,lesson_id,attempt_id,amount) VALUES($1,$2,$3,10)',
    [u, lesson, a],
  );
  const s = await rpc<{ entries: { appearance: { frame: string } }[] }>(
    'social_summary',
    [u, 'global', 0],
  );
  expect(s.entries[0].appearance.frame).toBe('pulse');
  expect(JSON.stringify(s.entries)).not.toContain(u);
  expect(JSON.stringify(s.entries)).not.toContain('telegram');
});

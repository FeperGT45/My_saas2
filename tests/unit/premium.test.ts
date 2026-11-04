import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isSubscriptionAccess } from '@/lib/premium/permissions';
const db = new PGlite();
const user = randomUUID(),
  other = randomUUID();
const lesson = '40000000-0000-0000-0000-000000000002';
async function rpc<T = unknown>(
  name: string,
  args: unknown[] = [],
): Promise<T> {
  return (
    await db.query<{ v: T }>(
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
  await db.exec(
    await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
  );
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [user, other]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Subscriber'),($2,'Free learner')",
    [user, other],
  );
}, 30000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('defaults to Free, hides unknown features and preserves historical plus/pro rows without silently granting rights', async () => {
  const s = await rpc('premium_status', [user]);
  expect(isSubscriptionAccess(s)).toBe(true);
  expect(s).toMatchObject({
    plan: 'free',
    premium: false,
    status: 'free',
    startsAt: null,
    expiresAt: null,
    autoRenew: false,
  });
  expect(await rpc('has_feature', [user, 'invented_feature'])).toBe(false);
  await db.query(
    "INSERT INTO public.subscriptions(user_id,plan,status,starts_at,ends_at) VALUES($1,'plus','active',now()-interval '1 day',now()+interval '1 day'),($1,'pro','active',now()-interval '1 day',now()+interval '1 day')",
    [user],
  );
  expect(await rpc('has_premium', [user])).toBe(false);
  expect(
    (
      await db.query('SELECT * FROM public.subscriptions WHERE user_id=$1', [
        user,
      ])
    ).rows,
  ).toHaveLength(2);
});
let grant: string;
it('an unverified Premium row does not confer access', async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO public.subscriptions(id,user_id,plan,status,starts_at,ends_at) VALUES($1,$2,'premium','active',now()-interval '1 day',now()+interval '30 days')",
    [id, other],
  );
  expect(await rpc('has_premium', [other])).toBe(false);
  expect(await rpc('premium_status', [other])).toMatchObject({
    plan: 'free',
    status: 'free',
  });
});
it('trusted activation is idempotent, records the exact window and refuses changed requests', async () => {
  grant = randomUUID();
  await db.exec('SET ROLE service_role');
  expect(
    await rpc('grant_premium_access', [
      user,
      grant,
      30,
      'Owner approved test grant',
    ]),
  ).toBe(grant);
  expect(
    await rpc('grant_premium_access', [
      user,
      grant,
      30,
      'Owner approved test grant',
    ]),
  ).toBe(grant);
  await expect(
    rpc('grant_premium_access', [user, grant, 31, 'Owner approved test grant']),
  ).rejects.toThrow('conflict');
  await expect(
    rpc('grant_premium_access', [
      other,
      grant,
      30,
      'Owner approved test grant',
    ]),
  ).rejects.toThrow('conflict');
  await expect(
    rpc('grant_premium_access', [user, randomUUID(), 0, 'bad']),
  ).rejects.toThrow('invalid');
  const s = await rpc('premium_status', [user]);
  expect(isSubscriptionAccess(s)).toBe(true);
  expect(s).toMatchObject({
    plan: 'premium',
    premium: true,
    status: 'active',
    features: { advanced_statistics: true, premium_courses: true },
  });
  expect(await rpc('has_premium', [other])).toBe(false);
});
it('global flags deny paid lessons, extra exercises and the paid API at database execution time', async () => {
  await db.query("UPDATE public.courses SET access_tier='premium'");
  expect(await rpc('can_access_lesson', [user, lesson])).toBe(true);
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key IN ('premium_courses','advanced_statistics')",
  );
  expect(await rpc('has_premium', [user])).toBe(true);
  expect(await rpc('can_access_lesson', [user, lesson])).toBe(false);
  await expect(
    rpc('start_lesson', [user, lesson, randomUUID()]),
  ).rejects.toThrow('premium required');
  await expect(rpc('premium_features', [user])).rejects.toThrow(
    'premium required',
  );
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true;UPDATE public.courses SET access_tier='free'",
  );
  await db.query(
    `INSERT INTO public.exercises(lesson_id,kind,prompt,position,public_payload,answer_key,explanation,premium_only) VALUES($1,'grammar','Extra',7,'{"options":[{"id":"a","label":"I am"},{"id":"b","label":"I is"}]}','{"value":"a"}','I am.',true)`,
    [lesson],
  );
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='extra_exercises'",
  );
  expect(await rpc('start_lesson', [user, lesson, randomUUID()])).toMatchObject(
    { total: 6 },
  );
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='extra_exercises'",
  );
  const attempt = randomUUID();
  expect(await rpc('start_lesson', [user, lesson, attempt])).toMatchObject({
    total: 7,
  });
  for (const [position, answer] of [
    'hello',
    ['i', 'like', 'reading'],
    'am',
    { cat: 'cat_ru', dog: 'dog_ru' },
    'speaks',
    'morning',
  ].entries())
    await rpc('submit_lesson_answer', [
      user,
      attempt,
      position + 1,
      JSON.stringify(answer),
    ]);
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='extra_exercises'",
  );
  await expect(rpc('lesson_state', [user, attempt])).rejects.toThrow(
    'premium required',
  );
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='extra_exercises'",
  );
  expect(await rpc('lesson_state', [user, attempt])).toMatchObject({
    answered: 6,
    total: 7,
  });
  // RLS follows the same flag, even for a client with a real Supabase identity.
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='premium_courses';UPDATE public.courses SET access_tier='premium';SET ROLE authenticated",
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  expect(
    (await db.query('SELECT id FROM public.lessons WHERE id=$1', [lesson]))
      .rows,
  ).toHaveLength(0);
  await db.exec(
    "RESET ROLE;UPDATE public.subscription_features SET enabled=true;UPDATE public.courses SET access_tier='free'",
  );
});
it('expiry immediately denies access without a cleanup job, leaves progress unchanged, and reactivation restores rights', async () => {
  await db.query(
    'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,85)',
    [user, lesson],
  );
  const progress = (
    await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
      user,
    ])
  ).rows;
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '30 days',ends_at=now() WHERE id=$1",
    [grant],
  );
  expect(await rpc('has_premium', [user])).toBe(false);
  expect(await rpc('premium_status', [user])).toMatchObject({
    plan: 'free',
    status: 'expired',
    premium: false,
  });
  await expect(rpc('premium_features', [user])).rejects.toThrow(
    'premium required',
  );
  const next = randomUUID();
  await rpc('grant_premium_access', [
    user,
    next,
    30,
    'Reactivation test grant',
  ]);
  expect(await rpc('premium_status', [user])).toMatchObject({
    premium: true,
    status: 'active',
  });
  expect(
    (
      await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
        user,
      ])
    ).rows,
  ).toEqual(progress);
  expect(
    (await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [user]))
      .rows,
  ).toHaveLength(0);
  await db.query(
    "UPDATE public.subscriptions SET status='cancelled' WHERE id=$1",
    [next],
  );
  expect(await rpc('has_premium', [user])).toBe(false);
  expect(await rpc('premium_status', [user])).toMatchObject({
    status: 'cancelled',
    plan: 'free',
  });
});
it('future periods do not grant early access and missing flags fail closed', async () => {
  await db.query(
    "UPDATE public.subscriptions SET status='expired' WHERE user_id=$1 AND plan='premium'",
    [user],
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO public.subscriptions(id,user_id,plan,status,starts_at,ends_at,grant_reason) VALUES($1,$2,'premium','active',now()+interval '1 day',now()+interval '2 days','Scheduled test')",
    [id, user],
  );
  expect(await rpc('premium_status', [user])).toMatchObject({
    status: 'scheduled',
    plan: 'free',
    premium: false,
  });
  expect(await rpc('has_feature', [user, 'advanced_statistics'])).toBe(false);
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  expect(await rpc('has_premium', [user])).toBe(true);
  await db.exec(
    "DELETE FROM public.subscription_features WHERE key='lesson_review_plan'",
  );
  expect(await rpc('has_feature', [user, 'lesson_review_plan'])).toBe(false);
  await expect(rpc('premium_features', [user])).rejects.toThrow(
    'premium required',
  );
  await db.exec(
    "INSERT INTO public.subscription_features(key,minimum_plan) VALUES('lesson_review_plan','premium')",
  );
});
it.each(['anon', 'authenticated'])(
  '%s cannot grant, modify or select another identity privileges',
  async (role) => {
    await db.exec('SET ROLE ' + role);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    await expect(
      rpc('grant_premium_access', [other, randomUUID(), 30, 'Self grant']),
    ).rejects.toThrow('permission denied');
    await expect(rpc('has_feature', [user, 'premium_courses'])).rejects.toThrow(
      'permission denied',
    );
    await expect(rpc('premium_status', [user])).rejects.toThrow(
      'permission denied',
    );
    await expect(
      db.exec(
        "UPDATE public.subscriptions SET ends_at=now()+interval '100 years'",
      ),
    ).rejects.toThrow('permission denied');
    await expect(
      db.exec(
        "INSERT INTO public.subscription_features VALUES('extra_exercises','free',true)",
      ),
    ).rejects.toThrow('permission denied');
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "SELECT voklumi_private.current_user_has_feature('premium_courses') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  },
);
it('rejects incomplete and inconsistent server status DTOs', async () => {
  const s = await rpc<Record<string, unknown>>('premium_status', [user]);
  expect(isSubscriptionAccess(s)).toBe(true);
  expect(isSubscriptionAccess({ ...s, features: {} })).toBe(false);
  expect(isSubscriptionAccess({ ...s, premium: true, plan: 'free' })).toBe(
    false,
  );
  expect(isSubscriptionAccess({ ...s, serverTime: 'invalid' })).toBe(false);
});

it('checks schema and client privileges before release', async () => {
  expect(await rpc('premium_permissions_status')).toEqual({
    version: 'permissions-v1',
    ready: true,
  });
  await db.exec(
    'GRANT INSERT ON public.subscription_features TO authenticated',
  );
  expect(await rpc('premium_permissions_status')).toMatchObject({
    ready: false,
  });
  await db.exec(
    'REVOKE INSERT ON public.subscription_features FROM authenticated',
  );
});

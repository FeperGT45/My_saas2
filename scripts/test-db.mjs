import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
// Only test harness: Supabase normally provides these roles and auth schema.
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`);
for (const name of (await readdir('supabase/migrations')).sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
await db.exec(await readFile('supabase/seed.sql', 'utf8'));
const a = 'a0000000-0000-0000-0000-000000000001',
  b = 'a0000000-0000-0000-0000-000000000002';
const lesson = '40000000-0000-0000-0000-000000000001';
await db.exec(`INSERT INTO auth.users VALUES('${a}'),('${b}'); INSERT INTO public.users(id,display_name) VALUES('${a}','Test A'),('${b}','Test B');
INSERT INTO public.subscriptions(user_id,plan,status,starts_at,ends_at) VALUES('${a}','plus','active',now(),now()+interval '1 month'),('${b}','pro','active',now(),now()+interval '1 month');
INSERT INTO public.courses(language_id,slug,title,level) SELECT id,'draft','Draft','A1' FROM public.languages;
INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,completed_at) VALUES('60000000-0000-0000-0000-000000000001','${a}','${lesson}','completed',100,now()),('60000000-0000-0000-0000-000000000002','${b}','${lesson}','completed',50,now());`);
async function rejects(sql) {
  await assert.rejects(db.exec(sql));
}
await db.exec('SET ROLE anon');
assert.equal((await db.query('SELECT id FROM public.courses')).rows.length, 1);
await rejects('SELECT * FROM public.users');
await rejects('SELECT is_correct FROM public.exercise_options');
await rejects('SELECT explanation FROM public.exercises');
assert.equal(
  (await db.query('SELECT label FROM public.exercise_options')).rows.length,
  2,
);
await rejects(
  `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000001')`,
);
await db.exec(`RESET ROLE; SET ROLE service_role;`);
assert.equal(
  (
    await db.query(
      `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000001') AS ok`,
    )
  ).rows[0].ok,
  true,
);
assert.equal(
  (
    await db.query(
      `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000001') AS ok`,
    )
  ).rows[0].ok,
  false,
);
await db.exec(
  `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000002'); RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${a}';`,
);
assert.equal((await db.query('SELECT id FROM public.users')).rows.length, 1);
for (const table of [
  'user_progress',
  'lesson_attempts',
  'xp_events',
  'daily_streaks',
  'subscriptions',
]) {
  const rows = (await db.query(`SELECT user_id FROM public.${table}`)).rows;
  assert.equal(rows.length, 1, table);
  assert.equal(rows[0].user_id, a);
  await rejects(`DELETE FROM public.${table}`);
}
await rejects('UPDATE public.xp_events SET amount=999');
await rejects("UPDATE public.subscriptions SET plan='pro'");
await rejects(
  `INSERT INTO public.daily_streaks(user_id,activity_date) VALUES('${a}',current_date)`,
);
await rejects(
  `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000001')`,
);
for (const table of [
  'users',
  'languages',
  'courses',
  'units',
  'lessons',
  'exercises',
  'exercise_options',
  'achievements',
  'user_achievements',
  'referrals',
]) {
  await rejects(`DELETE FROM public.${table}`);
}
await db.exec('RESET ROLE');
await rejects(
  `INSERT INTO public.referrals(referrer_id,referred_id) VALUES('${a}','${a}')`,
);
await rejects(
  `INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES('${a}','${lesson}',101)`,
);
await rejects(
  `INSERT INTO public.exercises(lesson_id,prompt,position) VALUES('${lesson}','Invalid no options',99)`,
);
await rejects(
  `INSERT INTO public.referrals(referrer_id,referred_id) VALUES('${a}','ffffffff-ffff-ffff-ffff-ffffffffffff')`,
);
await rejects(
  `UPDATE public.subscriptions SET ends_at=starts_at WHERE user_id='${a}'`,
);
await rejects(
  `UPDATE public.exercise_options SET is_correct=true WHERE label='Goodbye'`,
);
await rejects(`DELETE FROM public.exercise_options WHERE is_correct`);
await db.exec('ROLLBACK');
await db.exec(
  `INSERT INTO public.lesson_attempts(id,user_id,lesson_id) VALUES('60000000-0000-0000-0000-000000000003','${a}','${lesson}')`,
);
await rejects(
  `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000003')`,
);
await db.exec(
  `UPDATE public.lesson_attempts SET status='completed',score=100,completed_at=now() WHERE id='60000000-0000-0000-0000-000000000003'`,
);
assert.equal(
  (
    await db.query(
      `SELECT public.award_completed_lesson('60000000-0000-0000-0000-000000000003') AS ok`,
    )
  ).rows[0].ok,
  false,
);
await db.exec('ROLLBACK');
assert.equal(
  (
    await db.query(
      `SELECT sum(amount)::int AS xp FROM public.xp_events WHERE user_id='${a}'`,
    )
  ).rows[0].xp,
  10,
);
console.log(
  'PASS: migrations, seed, RLS isolation, draft visibility, answer secrecy, client write denial, integrity and idempotent XP',
);
// Telegram session provisioning is service-only, atomic and rejects reused signed data.
const telegramAuthId = 'a0000000-0000-0000-0000-000000000003';
await db.exec(`INSERT INTO auth.users VALUES('${telegramAuthId}')`);
await db.exec('SET ROLE authenticated');
await rejects('SELECT * FROM public.telegram_sessions');
await rejects(
  `SELECT public.create_telegram_session('${telegramAuthId}',12345,'Name',NULL,NULL,repeat('a',64),repeat('b',64))`,
);
await db.exec('RESET ROLE; SET ROLE service_role');
assert.equal(
  (
    await db.query(
      `SELECT public.create_telegram_session('${telegramAuthId}',12345,'Name',NULL,'https://example.com/avatar.jpg',repeat('a',64),repeat('b',64)) AS uid`,
    )
  ).rows[0].uid,
  telegramAuthId,
);
await rejects(
  `SELECT public.create_telegram_session('${telegramAuthId}',12345,'Name',NULL,NULL,repeat('c',64),repeat('b',64))`,
);
assert.equal(
  (await db.query('SELECT count(*)::int AS n FROM public.telegram_sessions'))
    .rows[0].n,
  1,
);
await db.exec('RESET ROLE');
await db.exec('SET ROLE service_role');
assert.equal(
  (
    await db.query(
      `SELECT public.create_telegram_session('${telegramAuthId}',12345,'Updated',NULL,NULL,repeat('d',64),repeat('e',64)) AS uid`,
    )
  ).rows[0].uid,
  telegramAuthId,
);
await db.exec('RESET ROLE');
console.log(
  'PASS: Telegram profile/session provisioning, replay uniqueness and session RLS',
);
await db.close();

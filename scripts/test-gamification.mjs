import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { contentId } from './content/catalog.mjs';
const db = new PGlite();
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  const users = ['a', 'b', 'c', 'd', 'e'].map((x) =>
    contentId(`game-user/${x}`),
  );
  for (const user of users)
    await db.query('INSERT INTO auth.users VALUES($1)', [user]);
  for (const user of users)
    await db.query('INSERT INTO public.users(id,display_name) VALUES($1,$2)', [
      user,
      'Game test',
    ]);
  for (const [xp, expected] of [
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [599, 3],
    [600, 4],
    [999, 4],
    [1000, 5],
  ])
    assert.equal(
      (await db.query('SELECT public.game_level($1) AS n', [xp])).rows[0].n,
      expected,
    );
  const lessons = [
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
  ];
  const third = contentId('game-third');
  await db.query(
    `INSERT INTO public.lessons(id,unit_id,title,position,published,xp_reward) VALUES($1,'30000000-0000-0000-0000-000000000001','Third',3,true,80)`,
    [third],
  );
  lessons.push(third);
  async function complete(user, lesson, score, at, key) {
    const id = contentId(`game-attempt/${key}`);
    await db.query(
      `INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,started_at,completed_at) VALUES($1,$2,$3,'completed',$4,$5::timestamptz-interval '5 minutes',$5)`,
      [id, user, lesson, score, at],
    );
    return id;
  }
  const award = async (id) =>
    (await db.query('SELECT public.award_completed_lesson($1) AS ok', [id]))
      .rows[0].ok;
  const balance = async (user) =>
    (
      await db.query(
        'SELECT coalesce(sum(amount),0)::int AS n FROM public.coin_events WHERE user_id=$1',
        [user],
      )
    ).rows[0].n;
  const summary = async (user) =>
    (await db.query('SELECT public.game_summary($1) AS data', [user])).rows[0]
      .data;
  const streak = async (user, today) =>
    (await db.query('SELECT public.game_streak($1,$2) AS data', [user, today]))
      .rows[0].data;
  await db.query(`SELECT public.set_game_timezone($1,'America/New_York')`, [
    users[0],
  ]);
  await assert.rejects(
    db.query(`SELECT public.set_game_timezone($1,'Mars/Olympus')`, [users[0]]),
  );
  const first = await complete(
    users[0],
    lessons[0],
    100,
    '2026-03-07T16:00:00Z',
    'first',
  );
  assert.equal(await award(first), true);
  assert.equal(await balance(users[0]), 30);
  assert.equal(await award(first), false);
  assert.equal(await balance(users[0]), 30);
  // 23-hour DST day is still one calendar day; repeats maintain streak but pay nothing.
  for (const [i, time] of [
    '2026-03-08T15:00:00Z',
    '2026-03-09T15:00:00Z',
  ].entries()) {
    const id = await complete(users[0], lessons[0], 100, time, `dst-${i}`);
    assert.equal(await award(id), false);
  }
  assert.deepEqual(await streak(users[0], '2026-03-09'), {
    current: 3,
    longest: 3,
  });
  assert.deepEqual(await streak(users[0], '2026-03-10'), {
    current: 3,
    longest: 3,
  });
  assert.deepEqual(await streak(users[0], '2026-03-11'), {
    current: 0,
    longest: 3,
  });
  assert.equal(await balance(users[0]), 30);
  await assert.rejects(
    db.query(`SELECT public.set_game_timezone($1,'UTC')`, [users[0]]),
  );
  // Fresh user across local midnight despite same UTC date.
  await db.query(`SELECT public.set_game_timezone($1,'Asia/Tokyo')`, [
    users[1],
  ]);
  await award(
    await complete(
      users[1],
      lessons[0],
      100,
      '2026-01-01T14:59:00Z',
      'tokyo-before',
    ),
  );
  await award(
    await complete(
      users[1],
      lessons[0],
      100,
      '2026-01-01T15:01:00Z',
      'tokyo-after',
    ),
  );
  assert.deepEqual(await streak(users[1], '2026-01-02'), {
    current: 2,
    longest: 2,
  });
  const time = new Date().toISOString();
  // Low scores are persisted, but cannot earn XP, coins, daily credit or activity.
  const low = await complete(users[2], lessons[0], 59, time, 'low');
  assert.equal(await award(low), false);
  assert.equal(await balance(users[2]), 0);
  assert.equal((await summary(users[2])).completedLessons, 0);
  assert.equal((await summary(users[2])).xp, 0);
  for (let i = 0; i < lessons.length; i++)
    await award(
      await complete(
        users[2],
        lessons[i],
        i === 0 ? 60 : 100,
        time,
        `daily-${i}`,
      ),
    );
  const daily = await summary(users[2]);
  assert.equal(daily.xp, 120);
  assert.equal(daily.level, 2);
  assert.equal(daily.levelFloor, 100);
  assert.equal(daily.nextLevelXp, 300);
  assert.equal(daily.coins, 210);
  assert.equal(daily.completedLessons, 3);
  assert.equal(
    daily.daily.every((q) => q.claimed),
    true,
  );
  assert.equal(daily.sections.length, 2);
  const repeat = await complete(
    users[2],
    lessons[2],
    100,
    time,
    'repeat-section',
  );
  await Promise.all([award(repeat), award(repeat), award(repeat)]);
  assert.equal(await balance(users[2]), 210);
  // Transaction rollback if a coin insert fails: XP/progress/streak all remain absent.
  await db.exec(
    `CREATE FUNCTION public.test_coin_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${users[3]}'::uuid THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_coin_failure BEFORE INSERT ON public.coin_events FOR EACH ROW EXECUTE FUNCTION public.test_coin_failure();`,
  );
  const rollback = await complete(users[3], lessons[0], 100, time, 'rollback');
  await assert.rejects(award(rollback));
  assert.equal((await summary(users[3])).xp, 0);
  assert.equal((await summary(users[3])).completedLessons, 0);
  assert.equal(await balance(users[3]), 0);
  await db.exec(
    'DROP TRIGGER test_coin_failure ON public.coin_events;DROP FUNCTION public.test_coin_failure()',
  );
  assert.equal(await award(rollback), true);
  // Seven consecutive local days unlock exactly one streak badge, even on repeats.
  for (let day = 1; day <= 7; day++)
    await award(
      await complete(
        users[4],
        lessons[0],
        100,
        `2026-02-${String(day).padStart(2, '0')}T12:00:00Z`,
        `week-${day}`,
      ),
    );
  assert.deepEqual(await streak(users[4], '2026-02-07'), {
    current: 7,
    longest: 7,
  });
  assert.equal(await balance(users[4]), 80);
  const week = (await summary(users[4])).achievements.find(
    (a) => a.code === 'week_streak',
  );
  assert.equal(week.unlocked, true);
  // Ten unique 100-XP lessons reach level five and unlock both achievement thresholds.
  for (let i = 0; i < 10; i++) {
    const lesson = contentId(`bonus-lesson/${i}`);
    await db.query(
      `INSERT INTO public.lessons(id,unit_id,title,position,xp_reward,published) VALUES($1,'30000000-0000-0000-0000-000000000001',$2,$3,100,true)`,
      [lesson, `Bonus ${i}`, i + 4],
    );
    await award(await complete(users[4], lesson, 100, time, `xp-${i}`));
  }
  const badges = (await summary(users[4])).achievements;
  assert.equal(badges.find((a) => a.code === 'xp_1000').unlocked, true);
  assert.equal(badges.find((a) => a.code === 'ten_lessons').unlocked, true);
  // Own-row RLS and no client mutation/RPC (including timestamp and zone tampering).
  await db.exec(
    `SET ROLE authenticated;SET request.jwt.claim.sub='${users[2]}'`,
  );
  const own = (
    await db.query('SELECT DISTINCT user_id FROM public.coin_events')
  ).rows;
  assert.deepEqual(own, [{ user_id: users[2] }]);
  for (const sql of [
    'UPDATE public.coin_events SET amount=1000',
    "UPDATE public.users SET time_zone='Asia/Tokyo'",
    `SELECT public.award_completed_lesson('${repeat}')`,
    `SELECT public.set_game_timezone('${users[2]}','UTC')`,
    `SELECT public.game_summary('${users[0]}')`,
  ])
    await assert.rejects(db.exec(sql));
  console.log(
    'PASS: XP/level boundaries, 60% threshold, IANA/local-midnight/DST streaks, daily unique credit, coins, unit/course/achievement bonuses, repeats, concurrent duplicate requests, timezone lock, transaction rollback and RLS.',
  );
} finally {
  await db.close();
}

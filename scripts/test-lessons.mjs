import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  const user = 'a0000000-0000-0000-0000-000000000001',
    other = 'a0000000-0000-0000-0000-000000000002',
    lesson = '40000000-0000-0000-0000-000000000002',
    attempt = '70000000-0000-0000-0000-000000000001';
  const good = [
    'hello',
    ['i', 'like', 'reading'],
    ' AM ',
    { cat: 'cat_ru', dog: 'dog_ru' },
    'speaks',
    'morning',
  ];
  const bad = [
    'bye',
    ['reading', 'like', 'i'],
    'is',
    { cat: 'dog_ru', dog: 'cat_ru' },
    'speak',
    'night',
  ];
  const items = (
    await db.query(
      'SELECT kind,answer_key FROM public.exercises WHERE lesson_id=$1 ORDER BY position',
      [lesson],
    )
  ).rows;
  assert.equal(items.length, 6);
  for (let i = 0; i < 6; i++) {
    const grade = async (answer) =>
      (
        await db.query(
          'SELECT public.lesson_grade($1,$2::jsonb,$3::jsonb) AS ok',
          [
            items[i].kind,
            JSON.stringify(items[i].answer_key),
            JSON.stringify(answer),
          ],
        )
      ).rows[0].ok;
    assert.equal(await grade(good[i]), true, `${items[i].kind} correct`);
    assert.equal(await grade(bad[i]), false, `${items[i].kind} incorrect`);
  }
  await db.exec(
    `INSERT INTO auth.users VALUES('${user}'),('${other}');INSERT INTO public.users(id,display_name) VALUES('${user}','A'),('${other}','B');`,
  );
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const sql of [
      'SELECT answer_key FROM public.exercises',
      'SELECT * FROM public.lesson_attempt_items',
      'SELECT * FROM public.exercise_submissions',
      `SELECT public.start_lesson('${user}','${lesson}','${attempt}')`,
    ])
      await assert.rejects(db.exec(sql));
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  const start = async (id = attempt) =>
    (
      await db.query('SELECT public.start_lesson($1,$2,$3) AS state', [
        user,
        lesson,
        id,
      ])
    ).rows[0].state;
  const state = async (uid = user, id = attempt) =>
    (await db.query('SELECT public.lesson_state($1,$2) AS state', [uid, id]))
      .rows[0].state;
  const submit = async (position, answer, id = attempt) =>
    (
      await db.query(
        'SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb) AS result',
        [user, id, position, JSON.stringify(answer)],
      )
    ).rows[0].result;
  const first = await start();
  assert.equal(first.total, 6);
  assert.equal(first.answered, 0);
  assert.deepEqual(await start(), first);
  assert.equal(JSON.stringify(first).includes('answer_key'), false);
  assert.equal(JSON.stringify(first).includes('explanation'), false);
  assert.equal(JSON.stringify(first).includes('универсальное'), false);
  await assert.rejects(state(other));
  await assert.rejects(submit(2, good[1]));
  await assert.rejects(submit(1, 'made-up-option'));
  await assert.rejects(submit(1, { correct: true }));
  // Source changes cannot change this attempt or its reward.
  await db.exec(
    `UPDATE public.exercises SET answer_key='{"value":"bye"}' WHERE lesson_id='${lesson}' AND position=1;UPDATE public.lessons SET xp_reward=99 WHERE id='${lesson}';`,
  );
  for (let i = 0; i < 6; i++) {
    const result = await submit(i + 1, good[i]);
    assert.equal(result.correct, true);
    assert.ok(result.explanation.length);
    assert.equal(result.state.answered, i + 1);
    const replay = await submit(i + 1, good[i]);
    assert.equal(replay.correct, true);
    await assert.rejects(submit(i + 1, bad[i]));
  }
  const completed = await state();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.score, 100);
  assert.equal(completed.xp, 30);
  assert.equal(completed.exercise, null);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM public.exercise_submissions',
      )
    ).rows[0].n,
    6,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM public.xp_events')).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.query('SELECT best_score FROM public.user_progress')).rows[0]
      .best_score,
    100,
  );
  await db.exec(
    `UPDATE public.exercises SET answer_key='{"value":"hello"}' WHERE lesson_id='${lesson}' AND position=1;`,
  );
  const retry = '70000000-0000-0000-0000-000000000002';
  await start(retry);
  for (let i = 0; i < 6; i++) await submit(i + 1, bad[i], retry);
  const repeated = await state(user, retry);
  assert.equal(repeated.score, 0);
  assert.equal(repeated.xp, 0);
  assert.equal(
    (await db.query('SELECT best_score FROM public.user_progress')).rows[0]
      .best_score,
    100,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM public.daily_streaks'))
      .rows[0].n,
    1,
  );
  await assert.rejects(submit(7, 'extra', retry));
  console.log(
    'PASS: all six graders (correct/incorrect), frozen content and XP, ownership, safe DTOs, ordering, malformed answers, idempotent starts/answers/completion, repeat attempts, best score and no duplicate XP',
  );
} finally {
  await db.close();
}

import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import {
  readCatalog,
  validateCatalog,
  importPayload,
  contentId,
} from './content/catalog.mjs';
const data = await readCatalog();
const payload = importPayload(data);
assert.equal(payload.lessons.length, 30);
assert.equal(payload.exercises.length, 240);
assert.equal(new Set(payload.exercises.map((e) => e.id)).size, 240);
assert.deepEqual(importPayload(structuredClone(data)), payload);
// Independent editorial regression anchors: correct references, not distractors.
const lesson = (course, slug) =>
  data.courses
    .find((c) => c.title === course)
    .lessons.find((l) => l.slug === slug);
assert.equal(
  lesson('Basic English', 'present-simple').exercises[5].reference_answer,
  "He doesn't like coffee.",
);
assert.equal(
  lesson('Basic English', 'basic-review').exercises[7].reference_answer,
  'This is my sister. She is ten.',
);
assert.ok(
  lesson('Basic English', 'greetings').notes.some((n) =>
    n.includes('перед сном'),
  ),
);
assert.ok(
  lesson('Internet English', 'abbreviations').notes.some((n) =>
    n.includes('неформальны'),
  ),
);
assert.equal(
  lesson('Gaming English', 'dota-2').exercises[6].public_payload.text,
  'The enemy is missing from my lane.',
);
assert.equal(
  lesson('Gaming English', 'roblox').exercises[7].reference_answer,
  "I don't share my password.",
);
assert.equal(
  lesson('Internet English', 'internet-review').exercises[7].reference_answer,
  "I don't share login codes.",
);
for (const mutate of [
  (d) => {
    d.courses[0].lessons.pop();
  },
  (d) => {
    d.courses[0].lessons[0].exercises[0].answer_key.value = 'unknown';
  },
  (d) => {
    d.courses[0].lessons[0].exercises[0].explanation = '';
  },
  (d) => {
    d.courses[0].lessons[0].exercises[2].answer_key.value.reverse();
  },
  (d) => {
    d.courses[0].lessons[0].exercises[0].public_payload.options[0].is_correct = true;
  },
]) {
  const invalid = structuredClone(data);
  mutate(invalid);
  assert.throws(() => validateCatalog(invalid));
}
const positions = new Map();
for (const e of payload.exercises.filter((e) => e.public_payload.options)) {
  const index = e.public_payload.options.findIndex(
    (o) => o.id === e.answer_key.value,
  );
  positions.set(index, (positions.get(index) ?? 0) + 1);
}
assert.ok(
  Math.max(...positions.values()) <
    payload.exercises.filter((e) => e.public_payload.options).length * 0.6,
);
const db = new PGlite();
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  const counts = async () => {
    const result = {};
    for (const table of [
      'languages',
      'courses',
      'units',
      'lessons',
      'exercises',
    ])
      result[table] = (
        await db.query(`SELECT count(*)::int AS n FROM public.${table}`)
      ).rows[0].n;
    return result;
  };
  const before = await counts();
  const importData = async (body) =>
    (
      await db.query(
        'SELECT public.import_english_curriculum($1::jsonb) AS result',
        [JSON.stringify(body)],
      )
    ).rows[0].result;
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(importData(payload));
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  assert.deepEqual(await importData(payload), {
    courses: 3,
    units: 7,
    lessons: 30,
    exercises: 240,
  });
  const first = await counts();
  assert.deepEqual(first, {
    languages: before.languages,
    courses: before.courses + 3,
    units: before.units + 7,
    lessons: before.lessons + 30,
    exercises: before.exercises + 240,
  });
  await importData(payload);
  assert.deepEqual(await counts(), first);
  const invalid = structuredClone(payload);
  invalid.courses[0].title = 'SHOULD ROLL BACK';
  invalid.exercises[0].answer_key.value = 'nonexistent';
  await assert.rejects(importData(invalid));
  assert.equal(
    (
      await db.query('SELECT title FROM public.courses WHERE id=$1', [
        payload.courses[0].id,
      ])
    ).rows[0].title,
    'Basic English',
  );
  const user = 'a0000000-0000-0000-0000-000000000001';
  await db.exec(
    `RESET ROLE;INSERT INTO auth.users VALUES('${user}');INSERT INTO public.users(id,display_name) VALUES('${user}','Content test');SET ROLE service_role;`,
  );
  for (const l of payload.lessons) {
    const attempt = contentId(`test-attempt/${l.id}`);
    let state = (
      await db.query('SELECT public.start_lesson($1,$2,$3) AS state', [
        user,
        l.id,
        attempt,
      ])
    ).rows[0].state;
    assert.equal(state.total, 8);
    assert.equal(JSON.stringify(state).includes('answer_key'), false);
    assert.equal(JSON.stringify(state).includes('explanation'), false);
    const exercises = payload.exercises
      .filter((e) => e.lesson_id === l.id)
      .sort((a, b) => a.position - b.position);
    for (const e of exercises) {
      const key = e.answer_key;
      const answer =
        e.kind === 'gap'
          ? key.accepted[0]
          : e.kind === 'matching'
            ? key.pairs
            : key.value;
      const result = (
        await db.query(
          'SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb) AS result',
          [user, attempt, e.position, JSON.stringify(answer)],
        )
      ).rows[0].result;
      assert.equal(result.correct, true, `${l.title}/${e.position}`);
      assert.equal(result.explanation, e.explanation);
      state = result.state;
    }
    assert.equal(state.score, 100);
    assert.equal(state.status, 'completed');
    assert.equal(state.xp, 30);
  }
  // A revision updates stable rows, supports reordered positions and preserves attempts.
  const revised = structuredClone(payload);
  revised.exercises[0].explanation =
    'Обновлённое пояснение для проверки импорта.';
  const one = revised.exercises[0],
    two = revised.exercises[1];
  [one.position, two.position] = [two.position, one.position];
  await importData(revised);
  assert.deepEqual(await counts(), first);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM public.lesson_attempts'))
      .rows[0].n,
    30,
  );
  assert.equal(
    (
      await db.query(
        'SELECT explanation FROM public.lesson_attempt_items WHERE exercise_id=$1',
        [one.id],
      )
    ).rows[0].explanation,
    payload.exercises[0].explanation,
  );
  // Restore the authoritative version and verify a third ordinary import.
  await importData(payload);
  assert.deepEqual(await counts(), first);
  console.log(
    'PASS: 30 lessons / 240 exercises; editorial references, six types per lesson, private keys, negative validation, service-only import, atomic rollback, idempotent/revision import, existing catalog preservation, all 240 answers graded with 100% lesson completion and immutable attempt snapshots.',
  );
} finally {
  await db.close();
}

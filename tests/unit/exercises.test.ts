import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  exerciseKinds,
  type ExerciseKind,
  type ExercisePayload,
  type ExerciseKey,
} from '@/lib/exercises/contracts';
import { validateExercise } from '@/lib/admin/validation';
import { answerReady } from '@/features/lesson/interactive-controls';
import type { Answer, LessonState, Feedback } from '@/features/lesson/types';
type Example = {
  kind: ExerciseKind;
  prompt: string;
  public_payload: ExercisePayload;
  answer_key: ExerciseKey;
  reference_answer: Answer;
  incorrect_answer: Answer;
  explanation: string;
};
const examples: Example[] = JSON.parse(
  readFileSync('tests/fixtures/exercises-v2.json', 'utf8'),
).exercises;
const db = new PGlite();
const user = randomUUID(),
  other = randomUUID(),
  oldAttempt = randomUUID();
const lesson = randomUUID();
async function rpc<T = unknown>(
  name: string,
  args: unknown[] = [],
): Promise<T> {
  return (
    await db.query<{ data: T }>(
      `SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS data`,
      args,
    )
  ).rows[0].data;
}
const json = JSON.stringify;
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  const migrations = (await readdir('supabase/migrations')).sort();
  const stage = migrations.find((f) =>
    f.endsWith('_interactive_exercise_types.sql'),
  )!;
  for (const f of migrations.filter((f) => f !== stage))
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [user, other]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Exercise learner'),($2,'Other')",
    [user, other],
  );
  await rpc('start_lesson', [
    user,
    '40000000-0000-0000-0000-000000000002',
    oldAttempt,
  ]);
  await db.exec(await readFile(`supabase/migrations/${stage}`, 'utf8'));
  await db.query(
    "INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES($1,'30000000-0000-0000-0000-000000000001','Local QA, not production content',3,true)",
    [lesson],
  );
  for (const [i, e] of examples.entries())
    await db.query(
      'INSERT INTO public.exercises(lesson_id,kind,prompt,position,public_payload,answer_key,explanation) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [
        lesson,
        e.kind,
        e.prompt,
        i + 1,
        json(e.public_payload),
        json(e.answer_key),
        e.explanation,
      ],
    );
}, 30000);
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db.close();
});
describe('every interactive exercise contract', () => {
  it('covers all twenty requested formats plus legacy grammar without modifying the curriculum', () => {
    expect(examples.map((e) => e.kind).sort()).toEqual(
      [...exerciseKinds].sort(),
    );
  });
  it.each(examples)(
    '$kind accepts its authored answer and rejects a meaningful wrong answer on PostgreSQL',
    async (e) => {
      const validated = validateExercise(
        e.kind,
        e.public_payload,
        e.answer_key,
      );
      expect(validated.public_payload).toEqual(e.public_payload);
      const p = await rpc<ExercisePayload>('lesson_public_payload', [
        e.kind,
        json(e.public_payload),
      ]);
      expect(
        await rpc('lesson_key_valid', [e.kind, json(p), json(e.answer_key)]),
      ).toBe(true);
      expect(
        await rpc('lesson_check_answer', [
          e.kind,
          json(p),
          json(e.answer_key),
          json(e.reference_answer),
        ]),
      ).toBe(true);
      expect(
        await rpc('lesson_check_answer', [
          e.kind,
          json(p),
          json(e.answer_key),
          json(e.incorrect_answer),
        ]),
      ).toBe(false);
      expect(() =>
        validateExercise(
          e.kind,
          { ...e.public_payload, correctAnswer: e.reference_answer },
          e.answer_key,
        ),
      ).toThrow();
      expect(
        await rpc('lesson_check_answer', [
          e.kind,
          json(p),
          json(e.answer_key),
          'null',
        ]),
      ).toBe(false);
    },
  );
  it('normalizes NFKC, apostrophes, contractions and whitespace without deleting negation or changing meaning', async () => {
    const key = { accepted: ['I do not like coffee.', 'I dislike coffee.'] };
    for (const answer of [
      "I DON'T like coffee!",
      'I dislike coffee.',
      'Ｉ do not like coffee.',
      'I don’t like coffee',
      '  I do not  like\ncoffee.  ',
    ])
      expect(
        await rpc('lesson_check_answer', [
          'translation',
          json({ source: 'Я не люблю кофе.' }),
          json(key),
          json(answer),
        ]),
      ).toBe(true);
    for (const answer of [
      'I like coffee.',
      'I do like coffee.',
      'I do not like tea.',
      'I likes coffee.',
      'He does not like coffee.',
    ])
      expect(
        await rpc('lesson_check_answer', [
          'translation',
          json({ source: 'Я не люблю кофе.' }),
          json(key),
          json(answer),
        ]),
      ).toBe(false);
  });
  it('rejects duplicate selections, forged IDs, partial checkpoint maps and text objects', async () => {
    for (const kind of ['multiple_choice', 'word_order', 'spelling'] as const) {
      const e = examples.find((e) => e.kind === kind)!;
      for (const answer of [
        ['forged'],
        [
          e.public_payload.options?.[0]?.id ?? e.public_payload.tokens![0].id,
          e.public_payload.options?.[0]?.id ?? e.public_payload.tokens![0].id,
        ],
        { value: 'a' },
      ])
        expect(
          await rpc('lesson_answer_valid', [
            kind,
            json(e.public_payload),
            json(answer),
          ]),
        ).toBe(false);
    }
    const checkpoint = examples.find((e) => e.kind === 'unit_test')!;
    for (const answer of [
      { q1: 'hello' },
      { q1: 'hello', q2: 'is', extra: 'a' },
      { q1: 'forged', q2: 'is' },
    ])
      expect(
        await rpc('lesson_answer_valid', [
          'unit_test',
          json(checkpoint.public_payload),
          json(answer),
        ]),
      ).toBe(false);
    expect(() =>
      validateExercise(
        'multiple_choice',
        examples.find((e) => e.kind === 'multiple_choice')!.public_payload,
        { value: ['a'] },
      ),
    ).toThrow();
    expect(() =>
      validateExercise(
        'dictation',
        { text: 'Hello', lang: 'invalid<script>' },
        { accepted: ['hello'] },
      ),
    ).toThrow();
  });
  it('keeps validation and learner readiness separate from correctness', () => {
    for (const e of examples)
      expect(
        answerReady(
          {
            position: 1,
            kind: e.kind,
            payload: e.public_payload,
            prompt: e.prompt,
          },
          e.reference_answer,
        ),
      ).toBe(true);
    const e = examples.find((e) => e.kind === 'unit_test')!;
    expect(
      answerReady(
        {
          position: 1,
          kind: e.kind,
          payload: e.public_payload,
          prompt: e.prompt,
        },
        { q1: 'hello' },
      ),
    ).toBe(false);
    const word = examples.find((e) => e.kind === 'word_order')!;
    expect(
      answerReady(
        {
          position: 1,
          kind: word.kind,
          payload: word.public_payload,
          prompt: word.prompt,
        },
        ['i'],
      ),
    ).toBe(false);
  });
});
describe('existing lesson engine integration and security', () => {
  it('resumes and grades a legacy attempt created before migration', async () => {
    const state = await rpc<LessonState>('lesson_state', [user, oldAttempt]);
    expect(state.exercise?.kind).toBe('single_choice');
    const feedback = await rpc<Feedback>('submit_lesson_answer', [
      user,
      oldAttempt,
      1,
      json('hello'),
    ]);
    expect(feedback.correct).toBe(true);
    expect(feedback.state.answered).toBe(1);
  });
  it('saves all formats, resumes, grades snapshots, retries without duplication and awards once', async () => {
    const attempt = randomUUID();
    const start = await rpc<LessonState>('start_lesson', [
      user,
      lesson,
      attempt,
    ]);
    expect(start.total).toBe(21);
    expect(JSON.stringify(start)).not.toMatch(
      /answer_key|accepted|explanations|correct_option/,
    );
    for (const [i, e] of examples.entries()) {
      const feedback = await rpc<Feedback>('submit_lesson_answer', [
        user,
        attempt,
        i + 1,
        json(e.reference_answer),
      ]);
      expect(feedback.correct, e.kind).toBe(true);
      expect(feedback.state.answered).toBe(i + 1);
      const retry = await rpc<Feedback>('submit_lesson_answer', [
        user,
        attempt,
        i + 1,
        json(e.reference_answer),
      ]);
      expect(retry).toEqual(feedback);
      if (e.kind === 'unit_test')
        expect(feedback.details?.map((d) => d.correct)).toEqual([true, true]);
      if (i === 6)
        expect(
          (await rpc<LessonState>('lesson_state', [user, attempt])).answered,
        ).toBe(7);
    }
    const end = await rpc<LessonState>('lesson_state', [user, attempt]);
    expect(end).toMatchObject({ status: 'completed', score: 100, correct: 21 });
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.exercise_submissions WHERE attempt_id=$1',
          [attempt],
        )
      ).rows[0].n,
    ).toBe(21);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.xp_events WHERE user_id=$1 AND lesson_id=$2',
          [user, lesson],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      rpc('submit_lesson_answer', [
        user,
        attempt,
        1,
        json(examples[0].incorrect_answer),
      ]),
    ).rejects.toThrow(/already submitted/);
    await expect(rpc('lesson_state', [other, attempt])).rejects.toThrow(
      /unavailable/,
    );
  });
  it('records wrong answers and per-question checkpoint feedback, then allows a fresh repeat without more XP', async () => {
    const attempt = randomUUID();
    await rpc('start_lesson', [user, lesson, attempt]);
    for (const [i, e] of examples.entries()) {
      const f = await rpc<Feedback>('submit_lesson_answer', [
        user,
        attempt,
        i + 1,
        json(e.incorrect_answer),
      ]);
      expect(f.correct, e.kind).toBe(false);
      expect(f.explanation).toBe(e.explanation);
      if (e.kind === 'unit_test') {
        expect(f.details?.map((d) => d.correct)).toEqual([false, true]);
        expect(f.details?.every((d) => !!d.explanation)).toBe(true);
      }
    }
    expect(
      await rpc<LessonState>('lesson_state', [user, attempt]),
    ).toMatchObject({ status: 'completed', score: 0 });
    expect(
      (
        await db.query<{ best_score: number }>(
          'SELECT best_score FROM public.user_progress WHERE user_id=$1 AND lesson_id=$2',
          [user, lesson],
        )
      ).rows[0].best_score,
    ).toBe(100);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.xp_events WHERE user_id=$1 AND lesson_id=$2',
          [user, lesson],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('does not reveal keys through nested checkpoint DTOs or allow client RPC bypasses', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of ['lesson_attempt_items', 'exercise_submissions'])
        await expect(db.query(`SELECT * FROM public.${table}`)).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        db.query('SELECT answer_key FROM public.exercises'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        rpc('submit_lesson_answer_core', [user, oldAttempt, 1, json('hello')]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        rpc('lesson_check_answer', ['translation', '{}', '{}', '"x"']),
      ).rejects.toThrow(/permission denied/);
      await db.exec('RESET ROLE');
    }
    expect(await rpc('exercise_engine_status')).toEqual({
      ready: true,
      version: 'interactive-v2',
      kinds: 21,
    });
    await db.exec('SET ROLE service_role');
    expect(
      await rpc('lesson_grade', ['grammar', json({ value: 'a' }), json('a')]),
    ).toBe(true);
  });
  it('updates recommendation skill grouping without treating a mixed checkpoint as one measured skill', async () => {
    for (const [kind, skill] of [
      ['dictation', 'listening'],
      ['tenses', 'grammar'],
      ['reading', 'reading'],
      ['dialogue', 'reading'],
      ['word_review', 'vocabulary'],
      ['unit_test', null],
    ])
      expect(await rpc('learning_exercise_skill', [kind])).toBe(skill);
  });
});

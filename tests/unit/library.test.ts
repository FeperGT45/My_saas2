import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  loadLibrary,
  libraryPayload,
  libraryId,
  validateLibrary,
  questionFingerprint,
  type Library,
} from '../../scripts/content/library';
import type { Feedback, LessonState } from '@/features/lesson/types';
import {
  recommendLearningPath,
  type LearningContext,
} from '@/lib/learning/recommend';
const db = new PGlite();
let library: Library;
let payload: ReturnType<typeof libraryPayload>;
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
async function user() {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Curriculum learner')",
    [id],
  );
  return id;
}
beforeAll(async () => {
  library = await loadLibrary();
  payload = libraryPayload(library);
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const f of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
}, 30000);
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db.close();
});
describe('modular learning content quality', () => {
  it('contains 300 available full lessons with 303 source lessons and 2598 exercises', () => {
    expect(validateLibrary(library)).toEqual({
      lessons: 303,
      exercises: 2598,
      levels: { A1: 71, A2: 61, B1: 61, B2: 50, C1: 35, C2: 25 },
    });
    expect(
      new Set(payload.exercises.map((e) => e.kind)).size,
    ).toBeGreaterThanOrEqual(17);
    expect(new Set(payload.exercises.map((e) => e.id)).size).toBe(2598);
    const available = library.lessons.filter(
      (l) => !l.skills.includes('listening'),
    );
    expect(available).toHaveLength(300);
    expect(
      Object.fromEntries(
        ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => [
          level,
          available.filter((l) => l.level === level).length,
        ]),
      ),
    ).toEqual({ A1: 70, A2: 60, B1: 60, B2: 50, C1: 35, C2: 25 });
    const batch = library.lessons.slice(60, 92);
    expect(batch).toHaveLength(32);
    for (const level of ['B1', 'B2', 'C1', 'C2'])
      expect(batch.filter((l) => l.level === level)).toHaveLength(8);
    expect(
      batch.some(
        (l) =>
          l.skills.includes('listening') ||
          l.exercises.some((e) => ['listening', 'dictation'].includes(e.kind)),
      ),
    ).toBe(false);
    const passages = batch.map(
      (l) =>
        l.exercises.find((e) => e.kind === 'reading')!.public_payload.passage,
    );
    expect(new Set(passages).size).toBe(32);
    for (const lesson of batch) {
      expect(lesson.notes.every((n) => /[а-яё]/i.test(n))).toBe(true);
      expect(lesson.exercises.filter((e) => e.kind === 'reading')).toHaveLength(
        2,
      );
      expect(
        new Set(lesson.exercises.map((e) => e.kind)).size,
      ).toBeGreaterThanOrEqual(7);
    }
    const fourth = library.lessons.slice(92, 132);
    expect(fourth).toHaveLength(40);
    for (const level of ['A1', 'A2', 'B1', 'B2'])
      expect(fourth.filter((l) => l.level === level)).toHaveLength(10);
    const fifth = library.lessons.slice(132, 172);
    expect(fifth).toHaveLength(40);
    for (const [level, count] of Object.entries({
      A1: 12,
      A2: 12,
      B1: 8,
      B2: 8,
    }))
      expect(fifth.filter((l) => l.level === level)).toHaveLength(count);
    const sixth = library.lessons.slice(172, 212);
    expect(sixth).toHaveLength(40);
    for (const [level, count] of Object.entries({
      A1: 8,
      A2: 8,
      B1: 8,
      B2: 6,
      C1: 6,
      C2: 4,
    }))
      expect(sixth.filter((l) => l.level === level)).toHaveLength(count);
    const seventh = library.lessons.slice(212, 236);
    expect(seventh).toHaveLength(24);
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
      expect(seventh.filter((l) => l.level === level)).toHaveLength(4);
    const eighth = library.lessons.slice(236, 248);
    expect(eighth).toHaveLength(12);
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
      expect(eighth.filter((l) => l.level === level)).toHaveLength(2);
    const ninth = library.lessons.slice(248, 260);
    expect(ninth).toHaveLength(12);
    for (const [level, count] of Object.entries({
      A1: 4,
      A2: 2,
      B1: 2,
      B2: 2,
      C1: 2,
      C2: 0,
    }))
      expect(ninth.filter((l) => l.level === level)).toHaveLength(count);
    const tenth = library.lessons.slice(260, 266);
    expect(tenth).toHaveLength(6);
    for (const [level, count] of Object.entries({
      A1: 2,
      A2: 1,
      B1: 1,
      B2: 1,
      C1: 1,
      C2: 0,
    }))
      expect(tenth.filter((l) => l.level === level)).toHaveLength(count);
    const final = library.lessons.slice(266);
    expect(final).toHaveLength(37);
    for (const [level, count] of Object.entries({
      A1: 9,
      A2: 7,
      B1: 8,
      B2: 4,
      C1: 7,
      C2: 2,
    }))
      expect(final.filter((l) => l.level === level)).toHaveLength(count);
    const latest = [
      ...fourth,
      ...fifth,
      ...sixth,
      ...seventh,
      ...eighth,
      ...ninth,
      ...tenth,
      ...final,
    ];
    expect(
      new Set(
        latest.map(
          (l) =>
            l.exercises.find((e) => e.kind === 'reading')!.public_payload
              .passage,
        ),
      ).size,
    ).toBe(211);
    for (const lesson of latest) {
      const isFinal = final.includes(lesson);
      expect(lesson.exercises).toHaveLength(isFinal ? 8 : 9);
      expect(new Set(lesson.exercises.map((e) => e.kind)).size).toBe(
        isFinal ? 7 : 8,
      );
      expect(
        lesson.exercises.some((e) =>
          ['listening', 'dictation'].includes(e.kind),
        ),
      ).toBe(false);
      expect(lesson.exercises.filter((e) => e.kind === 'reading')).toHaveLength(
        2,
      );
      expect(lesson.exercises.some((e) => e.kind === 'matching')).toBe(true);
    }
    const repaired = library.lessons
      .slice(60)
      .flatMap((l) => l.exercises)
      .filter((e) => e.public_payload.options);
    expect(
      new Set(repaired.map((e) => e.answer_key.value)).size,
    ).toBeGreaterThan(100);
  });
  it('preserves IDs across revisions, file ordering and wording changes', () => {
    const changed = structuredClone(library);
    changed.manifest.revision++;
    changed.lessons.reverse();
    changed.lessons[0].title += ' — новая редакция';
    expect(
      libraryPayload(changed)
        .lessons.map((l) => l.id)
        .sort(),
    ).toEqual(payload.lessons.map((l) => l.id).sort());
    expect(libraryId('stable/key')).toBe(
      '7a99a7ee-bda4-5210-a237-092be0d7f810',
    );
  });
  it('detects missing answers, explanations, draft lessons, duplicates and invalid prerequisite order', () => {
    const mutations: ((l: Library) => void)[] = [
      (l) => {
        l.lessons[0].exercises[0].explanation = '';
      },
      (l) => {
        l.lessons[0].exercises[0].answer_key = { value: 'forged' };
      },
      (l) => {
        l.lessons[0].quality.status = 'draft';
      },
      (l) => {
        l.lessons[0].prerequisites = [l.lessons[1].key];
      },
      (l) => {
        l.lessons[0].exercises[1] = structuredClone(l.lessons[0].exercises[0]);
      },
      (l) => {
        l.lessons[0].lexicon = [];
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(library);
      mutate(copy);
      expect(() => validateLibrary(copy)).toThrow();
    }
    const first = library.lessons[0].exercises[0],
      shuffled = structuredClone(first);
    shuffled.public_payload.options?.reverse();
    expect(questionFingerprint(first)).toBe(questionFingerprint(shuffled));
  });
  it('keeps the generated SQL import synchronized with the reviewed JSON modules', async () => {
    const seed = await readFile('supabase/library-seed.sql', 'utf8');
    const parts = seed.split('$curriculum_package$');
    expect(parts).toHaveLength(3);
    expect(JSON.parse(parts[1])).toEqual(payload);
  });
  it('keeps independent editorial anchors for difficult meanings and grammar', () => {
    const lesson = (key: string) => library.lessons.find((l) => l.key === key)!;
    expect(
      lesson('a2/weekend').exercises.find((e) => e.kind === 'correction')!
        .answer_key.accepted,
    ).toContain('Did you go to the park?');
    expect(
      lesson('b2/hypotheses').exercises.find((e) => e.kind === 'correction')!
        .answer_key.accepted,
    ).toContain('If she had left earlier, she would have caught the train.');
    expect(
      lesson('c1/hedging').exercises.find((e) => e.kind === 'translation')!
        .answer_key.accepted,
    ).toContain(
      'The results may indicate an association, but they do not prove causation.',
    );
    expect(
      lesson('c2/implicature').exercises.find((e) => e.kind === 'translation')!
        .answer_key.accepted,
    ).toContain(
      'The proposal is not without merit, but its benefits have been overstated.',
    );
    expect(lesson('c2/precision').notes.join(' ')).toContain(
      'не означает автоматически',
    );
    // Independently fixed meanings: qualifiers must survive future editing.
    const selectedMeaning = (key: string, exerciseKey: string) => {
      const e = lesson(key).exercises.find((x) => x.key === exerciseKey)!;
      return e.public_payload.options!.find((o) => o.id === e.answer_key.value)!
        .label;
    };
    expect(selectedMeaning('c2/up-to-ceiling', 'e01')).toBe(
      'Forty is the maximum, subject to the layout.',
    );
    expect(selectedMeaning('c2/changed-operational-definition', 'e07')).toBe(
      'The current counts did not establish the claimed improvement.',
    );
    expect(selectedMeaning('c2/some-and-all-context', 'e01')).toBe(
      'All six agreed.',
    );
    expect(selectedMeaning('c2/unconvinced-versus-refuted', 'e07')).toBe(
      'It turned lack of persuasion into proof that timing had no effect.',
    );
    expect(
      lesson('c1/hope-so-reference').exercises.find((e) => e.key === 'e04')!
        .answer_key.accepted,
    ).toContain('Will the delivery be late? I hope not.');
    const positions = payload.exercises
      .filter(
        (e) =>
          e.public_payload.options && typeof e.answer_key.value === 'string',
      )
      .map((e) =>
        e.public_payload.options!.findIndex((o) => o.id === e.answer_key.value),
      );
    expect(
      Math.max(
        ...[0, 1, 2, 3].map((p) => positions.filter((x) => x === p).length),
      ) / positions.length,
    ).toBeLessThan(0.6);
  });
});
describe('transactional curriculum import', () => {
  it(
    'keeps in-progress answers valid when predictable option IDs are replaced in a later revision',
    { timeout: 15000 },
    async () => {
      const previous = structuredClone(payload),
        keep = new Set(previous.lessons.slice(0, 92).map((l) => l.id));
      previous.revision = 4;
      previous.lessons = previous.lessons.filter((l) => keep.has(l.id));
      previous.exercises = previous.exercises.filter((e) =>
        keep.has(e.lesson_id),
      );
      previous.units = previous.units.filter((u) =>
        previous.lessons.some((l) => l.unit_id === (u as { id: string }).id),
      );
      const repairedIds = new Set(previous.lessons.slice(60).map((l) => l.id));
      for (const e of previous.exercises.filter(
        (e) => repairedIds.has(e.lesson_id) && e.public_payload.options,
      )) {
        const opts = e.public_payload.options!,
          correct = e.reference_answer;
        let wrong = 2;
        const map = new Map(
          opts.map((o) => [o.id, o.id === correct ? 'o1' : `o${wrong++}`]),
        );
        e.public_payload.options = opts.map((o) => ({
          ...o,
          id: map.get(o.id)!,
        }));
        e.answer_key.value = map.get(e.answer_key.value as string)!;
        e.reference_answer = map.get(e.reference_answer as string)!;
        e.incorrect_answer = map.get(e.incorrect_answer as string)!;
      }
      await db.exec('BEGIN');
      try {
        await rpc('import_curriculum_package', [JSON.stringify(previous)]);
        const u = await user(),
          lesson = previous.lessons.find(
            (l) => l.title === 'Что произошло до прибытия',
          )!,
          attempt = randomUUID();
        await rpc('start_lesson', [u, lesson.id, attempt]);
        const query =
          'SELECT payload,answer_key FROM public.lesson_attempt_items WHERE attempt_id=$1 ORDER BY position';
        const snapshots = (await db.query(query, [attempt])).rows;
        await rpc('import_curriculum_package', [JSON.stringify(payload)]);
        expect((await db.query(query, [attempt])).rows).toEqual(snapshots);
        for (const e of previous.exercises.filter(
          (e) => e.lesson_id === lesson.id,
        ))
          expect(
            (
              await rpc<Feedback>('submit_lesson_answer', [
                u,
                attempt,
                e.position,
                JSON.stringify(e.reference_answer),
              ])
            ).correct,
          ).toBe(true);
        expect(
          await rpc<LessonState>('lesson_state', [u, attempt]),
        ).toMatchObject({ status: 'completed', score: 100 });
      } finally {
        await db.exec('ROLLBACK');
      }
    },
  );
  it('expands revision ten without changing any of its 260 existing lessons or exercise keys', async () => {
    const old = structuredClone(payload);
    const originalIds = new Set(old.lessons.slice(0, 260).map((l) => l.id));
    old.revision = 10;
    old.lessons = old.lessons.filter((l) => originalIds.has(l.id));
    old.exercises = old.exercises.filter((e) => originalIds.has(e.lesson_id));
    old.units = old.units.filter((u) =>
      old.lessons.some((l) => l.unit_id === (u as { id: string }).id),
    );
    await db.exec('BEGIN');
    try {
      await rpc('import_curriculum_package', [JSON.stringify(old)]);
      const originalRows = (
        await db.query(
          'SELECT id,lesson_id,answer_key FROM public.exercises WHERE content_package_id=$1 ORDER BY id',
          [payload.package_id],
        )
      ).rows;
      expect(
        await rpc('import_curriculum_package', [JSON.stringify(payload)]),
      ).toMatchObject({ lessons: 303, exercises: 2598, unchanged: false });
      const expandedRows = (
        await db.query<{ id: string; lesson_id: string; answer_key: unknown }>(
          'SELECT id,lesson_id,answer_key FROM public.exercises WHERE content_package_id=$1 ORDER BY id',
          [payload.package_id],
        )
      ).rows;
      expect(
        expandedRows.filter((e) => originalIds.has(e.lesson_id as string)),
      ).toEqual(originalRows);
      expect(
        await rpc('import_curriculum_package', [JSON.stringify(payload)]),
      ).toMatchObject({ unchanged: true });
    } finally {
      await db.exec('ROLLBACK');
    }
  }, 15000);
  it('grades every accepted open-answer variant in the new batch, not only the first reference', async () => {
    for (const lesson of library.lessons.slice(30)) {
      expect(lesson.exercises.length).toBeGreaterThanOrEqual(8);
      for (const exercise of lesson.exercises) {
        for (const answer of exercise.answer_key.accepted ?? []) {
          const result = await rpc<boolean>('lesson_check_answer', [
            exercise.kind,
            JSON.stringify(exercise.public_payload),
            JSON.stringify(exercise.answer_key),
            JSON.stringify(answer),
          ]);
          expect(result, `${lesson.key}: ${answer}`).toBe(true);
        }
      }
    }
  });
  it('imports the package without replacing legacy lessons and repeats without writes', async () => {
    const legacy = (await db.query('SELECT * FROM public.lessons ORDER BY id'))
      .rows;
    await db.exec('SET ROLE service_role');
    expect(
      await rpc('import_curriculum_package', [JSON.stringify(payload)]),
    ).toMatchObject({ lessons: 303, exercises: 2598, unchanged: false });
    const versions = (
      await db.query(
        'SELECT id,admin_version FROM public.exercises WHERE content_package_id=$1 ORDER BY id',
        [payload.package_id],
      )
    ).rows;
    expect(
      await rpc('import_curriculum_package', [JSON.stringify(payload)]),
    ).toMatchObject({ unchanged: true });
    expect(
      (
        await db.query(
          'SELECT * FROM public.lessons WHERE content_package_id IS NULL ORDER BY id',
        )
      ).rows,
    ).toEqual(legacy);
    expect(
      (
        await db.query(
          'SELECT id,admin_version FROM public.exercises WHERE content_package_id=$1 ORDER BY id',
          [payload.package_id],
        )
      ).rows,
    ).toEqual(versions);
  });
  it('grades every reference and completes every published non-audio lesson', async () => {
    const id = await user();
    for (const e of payload.exercises) {
      expect(
        await rpc('lesson_answer_valid', [
          e.kind,
          JSON.stringify(e.public_payload),
          JSON.stringify(e.incorrect_answer),
        ]),
      ).toBe(true);
      expect(
        await rpc('lesson_check_answer', [
          e.kind,
          JSON.stringify(e.public_payload),
          JSON.stringify(e.answer_key),
          JSON.stringify(e.reference_answer),
        ]),
        e.prompt,
      ).toBe(true);
      expect(
        await rpc('lesson_check_answer', [
          e.kind,
          JSON.stringify(e.public_payload),
          JSON.stringify(e.answer_key),
          JSON.stringify(e.incorrect_answer),
        ]),
        e.prompt,
      ).toBe(false);
    }
    const active = new Set(
      (
        await db.query<{ id: string }>(
          'SELECT id FROM public.lessons WHERE published',
        )
      ).rows.map((l) => l.id),
    );
    for (const lesson of payload.lessons.filter((l) => active.has(l.id))) {
      const attempt = randomUUID();
      await rpc('start_lesson', [id, lesson.id, attempt]);
      const es = payload.exercises.filter((e) => e.lesson_id === lesson.id);
      for (const e of es)
        expect(
          (
            await rpc<Feedback>('submit_lesson_answer', [
              id,
              attempt,
              e.position,
              JSON.stringify(e.reference_answer),
            ])
          ).correct,
          e.prompt,
        ).toBe(true);
      expect(
        await rpc<LessonState>('lesson_state', [id, attempt]),
      ).toMatchObject({ status: 'completed', score: 100 });
    }
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.user_progress WHERE user_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(payload.lessons.filter((l) => active.has(l.id)).length);
  }, 30000);
  it('publishes safe library metadata and integrates advanced recommendations with real available courses', async () => {
    const catalog =
      await rpc<{ level: string; lessons: { id: string }[] }[]>(
        'curriculum_library',
      );
    expect(catalog.flatMap((c) => c.lessons)).toHaveLength(301);
    expect(JSON.stringify(catalog)).not.toMatch(
      /answer_key|reference_answer|incorrect_answer|accepted/,
    );
    const id = await user();
    await rpc('placement_beginner', [id]);
    await rpc('placement_set_route', [id, 'C2']);
    const snapshot = await rpc<{ context: LearningContext }>(
      'learning_path_context',
      [id],
    );
    const plan = recommendLearningPath(snapshot.context);
    expect(plan.items[0].level).toBe('C2');
    expect(plan.items[0].ready).toBe(true);
    expect(plan.fallback).toBe(false);
  });
  it('rejects duplicate IDs, stale revisions, missing metadata and a wrong key atomically', async () => {
    for (const mutate of [
      (p: typeof payload) => {
        p.revision = 0;
      },
      (p: typeof payload) => {
        p.revision = payload.revision + 1;
        p.exercises[0].answer_key = { value: 'forged' };
      },
      (p: typeof payload) => {
        p.revision = payload.revision + 1;
        p.exercises.push(p.exercises[0]);
      },
      (p: typeof payload) => {
        p.revision = payload.revision + 1;
        delete (p.lessons[0] as Partial<(typeof p.lessons)[0]>)
          .estimated_minutes;
      },
    ]) {
      const bad = structuredClone(payload);
      mutate(bad);
      await expect(
        rpc('import_curriculum_package', [JSON.stringify(bad)]),
      ).rejects.toThrow();
    }
    expect(
      await rpc('import_curriculum_package', [JSON.stringify(payload)]),
    ).toMatchObject({ unchanged: true });
  });
  it('does not overwrite administrator edits or silently remove published materials', async () => {
    const id = payload.exercises[0].id;
    await db.exec('BEGIN');
    try {
      await db.query(
        "UPDATE public.exercises SET prompt=prompt||' editorial adjustment' WHERE id=$1",
        [id],
      );
      await expect(
        rpc('import_curriculum_package', [JSON.stringify(payload)]),
      ).rejects.toThrow(/manual edits conflict/);
    } finally {
      await db.exec('ROLLBACK');
    }
    const omitted = structuredClone(payload);
    omitted.revision++;
    omitted.exercises.pop();
    await expect(
      rpc('import_curriculum_package', [JSON.stringify(omitted)]),
    ).rejects.toThrow(/removal requires/);
  });
  it(
    'updates a revision while preserving an already-started snapshot, progress and XP',
    { timeout: 15000 },
    async () => {
      const id = await user(),
        lesson = payload.lessons[0],
        attempt = randomUUID();
      await rpc('start_lesson', [id, lesson.id, attempt]);
      const snapshot = (
        await db.query(
          'SELECT * FROM public.lesson_attempt_items WHERE attempt_id=$1 ORDER BY position',
          [attempt],
        )
      ).rows;
      const update = structuredClone(payload);
      update.revision++;
      update.exercises[0].prompt += ' (редакция 2)';
      await rpc('import_curriculum_package', [JSON.stringify(update)]);
      expect(
        (
          await db.query(
            'SELECT * FROM public.lesson_attempt_items WHERE attempt_id=$1 ORDER BY position',
            [attempt],
          )
        ).rows,
      ).toEqual(snapshot);
      for (const e of payload.exercises.filter(
        (e) => e.lesson_id === lesson.id,
      ))
        await rpc('submit_lesson_answer', [
          id,
          attempt,
          e.position,
          JSON.stringify(e.reference_answer),
        ]);
      const xp = (
        await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id])
      ).rows;
      await rpc('import_curriculum_package', [JSON.stringify(update)]);
      expect(
        (
          await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [
            id,
          ])
        ).rows,
      ).toEqual(xp);
    },
  );
  it('rejects prerequisite cycles and attempts to adopt another package’s rows', async () => {
    await expect(
      db.query('INSERT INTO public.lesson_prerequisites VALUES($1,$2)', [
        payload.lessons[0].id,
        payload.lessons[1].id,
      ]),
    ).rejects.toThrow(/cycle/);
    const foreign = structuredClone(payload);
    foreign.package_id = 'foreign-package';
    await expect(
      rpc('import_curriculum_package', [JSON.stringify(foreign)]),
    ).rejects.toThrow(/ownership conflict/);
  });
  it('protects import metadata, prerequisites, and core admin writes from client roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(
        rpc('import_curriculum_package', [JSON.stringify(payload)]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query('SELECT * FROM public.curriculum_packages'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query('SELECT * FROM public.lesson_prerequisites'),
      ).rejects.toThrow(/permission denied/);
      await expect(rpc('curriculum_library')).rejects.toThrow(
        /permission denied/,
      );
      await db.exec('RESET ROLE');
    }
    expect(await rpc('curriculum_database_status')).toMatchObject({
      ready: true,
      version: 'curriculum-v2',
    });
  });
});

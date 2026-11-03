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
  it('contains thirty complete new lessons and 240 varied exercises covering all CEFR levels', () => {
    expect(validateLibrary(library)).toEqual({
      lessons: 30,
      exercises: 240,
      levels: { A1: 5, A2: 5, B1: 5, B2: 5, C1: 5, C2: 5 },
    });
    expect(
      new Set(payload.exercises.map((e) => e.kind)).size,
    ).toBeGreaterThanOrEqual(17);
    expect(new Set(payload.exercises.map((e) => e.id)).size).toBe(240);
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
  it('imports the package without replacing legacy lessons and repeats without writes', async () => {
    const legacy = (await db.query('SELECT * FROM public.lessons ORDER BY id'))
      .rows;
    await db.exec('SET ROLE service_role');
    expect(
      await rpc('import_curriculum_package', [JSON.stringify(payload)]),
    ).toMatchObject({ lessons: 30, exercises: 240, unchanged: false });
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
  it('grades every positive and negative reference on the production grader and completes every new lesson', async () => {
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
    for (const lesson of payload.lessons) {
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
    ).toBe(30);
  }, 30000);
  it('publishes safe library metadata and integrates advanced recommendations with real available courses', async () => {
    const catalog =
      await rpc<{ level: string; lessons: { id: string }[] }[]>(
        'curriculum_library',
      );
    expect(catalog.flatMap((c) => c.lessons)).toHaveLength(32);
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
        p.revision = 2;
        p.exercises[0].answer_key = { value: 'forged' };
      },
      (p: typeof payload) => {
        p.revision = 2;
        p.exercises.push(p.exercises[0]);
      },
      (p: typeof payload) => {
        p.revision = 2;
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
  it('updates a revision while preserving an already-started snapshot, progress and XP', async () => {
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
    for (const e of payload.exercises.filter((e) => e.lesson_id === lesson.id))
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
      (await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id]))
        .rows,
    ).toEqual(xp);
  });
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

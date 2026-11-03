import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  recommendLearningPath,
  type LearningContext,
  type LearningLesson,
} from '@/lib/learning/recommend';
import { learningCommand } from '@/lib/learning/validation';
const db = new PGlite();
const baseContext = (): LearningContext => ({
  level: 'A1',
  goal: 'general',
  courseId: null,
  assessmentSkills: [],
  recentSkills: [],
  recentLessons: [],
  lessons: [],
});
const lesson = (overrides: Partial<LearningLesson> = {}): LearningLesson => ({
  id: randomUUID(),
  title: 'Урок',
  unitTitle: 'Раздел',
  courseId: randomUUID(),
  courseTitle: 'Курс',
  level: 'A1',
  goals: ['general'],
  skills: ['grammar'],
  prerequisites: [],
  bestScore: null,
  lastScore: null,
  recentWrong: 0,
  ...overrides,
});
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
    "INSERT INTO public.users(id,display_name) VALUES($1,'Learning learner')",
    [id],
  );
  return id;
}
async function context(id: string) {
  return rpc<{ context: LearningContext; token: string }>(
    'learning_path_context',
    [id],
  );
}
async function store(id: string) {
  const snapshot = await context(id);
  const plan = recommendLearningPath(snapshot.context);
  const path = await rpc<string>('learning_path_store', [
    id,
    snapshot.token,
    JSON.stringify(plan),
  ]);
  return { plan, path, snapshot };
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const f of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
}, 30000);
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db.close();
});
describe('independent recommendation rules', () => {
  it('waits for a chosen starting level and never invents skill measurements', () => {
    const c = baseContext();
    c.level = null;
    c.lessons = [lesson()];
    expect(recommendLearningPath(c).items).toEqual([]);
    expect(recommendLearningPath(c).skills).toEqual([]);
  });
  it('prioritizes the CEFR target and then the learning goal', () => {
    const c = baseContext();
    c.goal = 'gaming';
    const general = lesson(),
      gaming = lesson({ goals: ['gaming'] }),
      advanced = lesson({ goals: ['gaming'], level: 'C2' });
    c.lessons = [general, advanced, gaming];
    expect(recommendLearningPath(c).items[0].id).toBe(gaming.id);
  });
  it('requires three different successful lessons and raises difficulty only one level', () => {
    const c = baseContext();
    c.lessons = [lesson({ level: 'A2' }), lesson()];
    c.recentLessons = [
      { lessonId: 'same', level: 'A1', score: 100 },
      { lessonId: 'same', level: 'A1', score: 100 },
      { lessonId: 'same', level: 'A1', score: 100 },
    ];
    expect(recommendLearningPath(c).targetLevel).toBe('A1');
    c.recentLessons = [1, 2, 3].map((n) => ({
      lessonId: String(n),
      level: 'A1' as const,
      score: 90,
    }));
    expect(recommendLearningPath(c).targetLevel).toBe('A2');
    expect(recommendLearningPath(c).items[0].level).toBe('A2');
    expect(recommendLearningPath(c).level).toBe('A1');
  });
  it('recommends foundations after repeated recent failures without downgrading the assessment', () => {
    const c = baseContext();
    c.level = 'B1';
    c.recentLessons = [1, 2].map((n) => ({
      lessonId: String(n),
      level: 'B1' as const,
      score: 40,
    }));
    c.lessons = [lesson({ level: 'A2' }), lesson({ level: 'B1' })];
    const p = recommendLearningPath(c);
    expect(p.targetLevel).toBe('A2');
    expect(p.level).toBe('B1');
    expect(p.items[0].level).toBe('A2');
  });
  it('uses sufficient recent evidence instead of old placement weaknesses', () => {
    const c = baseContext();
    c.assessmentSkills = [{ skill: 'grammar', answered: 5, correct: 1 }];
    c.recentSkills = [{ skill: 'grammar', answered: 8, correct: 8 }];
    expect(recommendLearningPath(c).skills[0]).toMatchObject({
      weak: false,
      source: 'lessons',
    });
    c.recentSkills[0].answered = 2;
    expect(recommendLearningPath(c).skills[0]).toMatchObject({
      weak: true,
      source: 'placement',
    });
  });
  it('bounds corrective practice to two and removes it after success', () => {
    const c = baseContext();
    c.recentSkills = [{ skill: 'grammar', answered: 12, correct: 3 }];
    c.lessons = [1, 2, 3].map(() =>
      lesson({ lastScore: 40, bestScore: 40, recentWrong: 3 }),
    );
    expect(
      recommendLearningPath(c).items.filter((l) => l.reason === 'practice'),
    ).toHaveLength(2);
    c.lessons.forEach((l) => {
      l.lastScore = 100;
      l.bestScore = 100;
      l.recentWrong = 0;
    });
    expect(recommendLearningPath(c).items).toHaveLength(0);
    expect(recommendLearningPath(c).optionalReview).toHaveLength(3);
  });
  it('orders prerequisites and marks upcoming steps without blocking other courses', () => {
    const c = baseContext();
    const a = lesson(),
      b = lesson({ courseId: a.courseId, prerequisites: [a.id] }),
      blocked = lesson({ prerequisites: [randomUUID()] });
    c.lessons = [b, a, blocked];
    const p = recommendLearningPath(c);
    expect(p.items.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(p.items.map((l) => l.ready)).toEqual([true, false]);
    expect(p.courses).toHaveLength(2);
    c.courseId = a.courseId;
    expect(
      recommendLearningPath(c).items.every((l) => l.courseId === a.courseId),
    ).toBe(true);
  });
  it('provides nearest available material, skips mastered lessons and stays deterministic', () => {
    const c = baseContext();
    c.level = 'C2';
    const mastered = lesson({ bestScore: 100, lastScore: 100 }),
      fresh = lesson();
    c.lessons = [mastered, fresh];
    const p = recommendLearningPath(c);
    expect(p.fallback).toBe(true);
    expect(p.items.map((l) => l.id)).toEqual([fresh.id]);
    expect(p).toEqual(recommendLearningPath(c));
  });
  it('limits the plan to twelve and preserves the inputs', () => {
    const c = baseContext();
    c.lessons = Array.from({ length: 20 }, () => lesson());
    const copy = structuredClone(c);
    expect(recommendLearningPath(c).items).toHaveLength(12);
    expect(c).toEqual(copy);
  });
  it('does not jump from A1 to C2 automatically but respects an explicit course choice', () => {
    const c = baseContext();
    const advanced = lesson({ level: 'C2' });
    c.lessons = [advanced];
    expect(recommendLearningPath(c).items).toHaveLength(0);
    c.courseId = advanced.courseId;
    expect(recommendLearningPath(c).items[0].id).toBe(advanced.id);
  });
  it('does not smuggle extra corrective lessons into fresh recommendations', () => {
    const c = baseContext();
    c.recentSkills = [{ skill: 'grammar', answered: 12, correct: 0 }];
    c.lessons = Array.from({ length: 8 }, () =>
      lesson({ lastScore: 20, bestScore: 20, recentWrong: 3 }),
    );
    expect(recommendLearningPath(c).items).toHaveLength(2);
  });
  it('rejects forged actors, scores, unknown goals, course IDs and actions', () => {
    for (const command of [
      { action: 'refresh', userId: randomUUID() },
      { action: 'refresh', score: 100 },
      { action: 'preferences', goal: 'admin', courseId: null },
      { action: 'preferences', goal: 'general', courseId: 'not-a-uuid' },
      { action: 'delete' },
      null,
    ])
      expect(() => learningCommand(command)).toThrow();
    expect(
      learningCommand({
        action: 'preferences',
        goal: 'travel',
        courseId: null,
      }),
    ).toEqual({ action: 'preferences', goal: 'travel', courseId: null });
  });
});
describe('persisted learning plans on PostgreSQL', () => {
  it('supports first entry, beginner A1, actual lessons and idempotent saves', async () => {
    const id = await user();
    expect((await store(id)).plan.level).toBeNull();
    await rpc('placement_beginner', [id]);
    const { plan, path } = await store(id);
    expect(plan.level).toBe('A1');
    expect(plan.items.length).toBeGreaterThan(0);
    const before = (
      await db.query('SELECT * FROM public.learning_paths WHERE id=$1', [path])
    ).rows;
    expect((await store(id)).path).toBe(path);
    expect(
      (
        await db.query('SELECT * FROM public.learning_paths WHERE id=$1', [
          path,
        ])
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          'SELECT * FROM public.learning_path_lessons WHERE path_id=$1',
          [path],
        )
      ).rows.length,
    ).toBe(plan.items.length);
  });
  it('keeps ownership private and does not reuse another user’s preferences or progress', async () => {
    const a = await user(),
      b = await user();
    await rpc('placement_beginner', [a]);
    await rpc('learning_path_preferences', [a, 'gaming', null]);
    await store(a);
    const other = await store(b);
    expect(other.plan.level).toBeNull();
    expect(other.plan.goal).toBe('general');
    expect(other.plan.items).toEqual([]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(
        db.query('SELECT * FROM public.learning_paths'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query('SELECT * FROM public.learning_path_lessons'),
      ).rejects.toThrow(/permission denied/);
      await expect(rpc('learning_path_context', [a])).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        rpc('learning_path_preferences', [a, 'gaming', null]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        rpc('learning_path_store', [a, '0'.repeat(32), '{}']),
      ).rejects.toThrow(/permission denied/);
      await db.exec('RESET ROLE');
    }
  });
  it('detects concurrent preference changes and preserves the latest choice', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    const stale = await context(id);
    const plan = recommendLearningPath(stale.context);
    await rpc('learning_path_preferences', [id, 'study', null]);
    await expect(
      rpc('learning_path_store', [id, stale.token, JSON.stringify(plan)]),
    ).rejects.toThrow(/stale context/);
    expect((await store(id)).plan.goal).toBe('study');
  });
  it('rejects nonexistent courses and lessons atomically', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    await expect(
      rpc('learning_path_preferences', [id, 'general', randomUUID()]),
    ).rejects.toThrow(/invalid course/);
    const saved = await store(id);
    const bad = structuredClone(saved.plan);
    bad.items[0].id = randomUUID();
    await expect(
      rpc('learning_path_store', [
        id,
        saved.snapshot.token,
        JSON.stringify(bad),
      ]),
    ).rejects.toThrow(/invalid lesson/);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.learning_path_lessons WHERE path_id=$1',
          [saved.path],
        )
      ).rows[0].n,
    ).toBe(saved.plan.items.length);
  });
  it('falls back to automatic selection when a selected course is no longer accessible', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    const course = '20000000-0000-0000-0000-000000000001';
    await rpc('learning_path_preferences', [id, 'gaming', course]);
    await db.query('UPDATE public.courses SET published=false WHERE id=$1', [
      course,
    ]);
    try {
      expect((await context(id)).context.courseId).toBeNull();
      await expect(
        rpc('learning_path_preferences', [id, 'gaming', course]),
      ).rejects.toThrow(/invalid course/);
      expect((await store(id)).plan.items).toEqual([]);
    } finally {
      await db.query('UPDATE public.courses SET published=true WHERE id=$1', [
        course,
      ]);
    }
    expect((await store(id)).plan.courseId).toBe(course);
  });
  it('preserves legacy progress and XP through route changes and retest preference resets', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    const l = '40000000-0000-0000-0000-000000000001';
    await db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,100)',
      [id, l],
    );
    const progress = (
      await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
        id,
      ])
    ).rows;
    const xp = (
      await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id])
    ).rows;
    await store(id);
    await rpc('placement_set_route', [id, 'C2']);
    await rpc('learning_path_preferences', [id, 'travel', null]);
    expect((await store(id)).plan.targetLevel).toBe('C2');
    expect(
      (
        await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
          id,
        ])
      ).rows,
    ).toEqual(progress);
    expect(
      (await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id]))
        .rows,
    ).toEqual(xp);
  });
  it('derives errors from real server grading and removes practice after a successful retry without duplicate XP', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    const l = '40000000-0000-0000-0000-000000000002';
    await db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,100)',
      [id, '40000000-0000-0000-0000-000000000001'],
    );
    async function complete(right: boolean) {
      const a = randomUUID();
      await rpc('start_lesson', [id, l, a]);
      const items = (
        await db.query<{
          position: number;
          kind: string;
          payload: { options: { id: string }[] };
          answer_key: {
            value: string | string[];
            accepted: string[];
            pairs: unknown;
          };
        }>(
          'SELECT * FROM public.lesson_attempt_items WHERE attempt_id=$1 ORDER BY position',
          [a],
        )
      ).rows;
      for (const item of items) {
        const key = item.answer_key;
        const answer = right
          ? item.kind === 'gap'
            ? key.accepted[0]
            : item.kind === 'matching'
              ? key.pairs
              : key.value
          : item.kind === 'gap'
            ? 'неверно'
            : item.kind === 'sentence'
              ? Array.isArray(key.value)
                ? [...key.value].reverse()
                : []
              : item.kind === 'matching'
                ? Object.fromEntries(
                    Object.entries(key.pairs as Record<string, string>).map(
                      ([k], i, all) => [
                        k,
                        Object.values(key.pairs as Record<string, string>)[
                          (i + 1) % all.length
                        ],
                      ],
                    ),
                  )
                : item.payload.options.find((o) => o.id !== key.value)!.id;
        await rpc('submit_lesson_answer', [
          id,
          a,
          item.position,
          JSON.stringify(answer),
        ]);
      }
      return a;
    }
    await complete(false);
    const failed = await store(id);
    expect(failed.plan.skills.some((s) => s.weak)).toBe(true);
    expect(failed.plan.items[0]).toMatchObject({ id: l, reason: 'practice' });
    const a = await complete(true);
    const success = await store(id);
    expect(success.plan.items.some((x) => x.id === l)).toBe(false);
    const before = (
      await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id])
    ).rows;
    await store(id);
    await rpc('award_completed_lesson', [a]);
    expect(
      (await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id]))
        .rows,
    ).toEqual(before);
    expect(before).toHaveLength(1);
  });
  it('uses only the latest placement assessment, never an old weakness', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    expect((await context(id)).context.assessmentSkills).toEqual([]);
    async function finish(right: boolean) {
      let state = await rpc<{
        attempt: {
          id: string;
          question: { id: string; options: { id: string }[] };
        } | null;
      }>('placement_start', [id, randomUUID()]);
      while (state.attempt) {
        const a = state.attempt;
        const key = (
          await db.query<{ key: string }>(
            "SELECT current_snapshot->>'correct_option' AS key FROM public.placement_test_attempts WHERE id=$1",
            [a.id],
          )
        ).rows[0].key;
        state = (
          await rpc<{ status: typeof state }>('placement_answer', [
            id,
            a.id,
            a.question.id,
            randomUUID(),
            right ? key : a.question.options.find((o) => o.id !== key)!.id,
          ])
        ).status;
      }
    }
    await finish(false);
    expect(
      (await context(id)).context.assessmentSkills.every(
        (s) => s.correct === 0,
      ),
    ).toBe(true);
    await finish(true);
    const latest = (await context(id)).context.assessmentSkills;
    expect(latest).toHaveLength(3);
    expect(latest.every((s) => s.correct === s.answered)).toBe(true);
  });
  it('reports private tables and RPC permissions ready', async () => {
    expect(await rpc('learning_path_database_status')).toEqual({
      ready: true,
      version: 'rules-v1',
      tables: 2,
    });
  });
});

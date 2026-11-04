import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  scheduleWeek,
  weeklyCommand,
  weeklyStatistics,
  type WeeklySnapshot,
  type WeeklyPlan,
} from '@/lib/learning/weekly';
import type { LearningLesson } from '@/lib/learning/recommend';
function fixture(): WeeklySnapshot {
  const lessons: LearningLesson[] = Array.from({ length: 30 }, (_, i) => ({
    id: `lesson-${i}`,
    title: `Lesson ${i}`,
    unitTitle: 'Unit',
    courseId: 'course',
    courseTitle: 'Course',
    level: 'A1',
    goals: i % 2 ? ['travel'] : ['study'],
    skills: i % 2 ? ['grammar'] : ['reading'],
    prerequisites: [],
    bestScore: null,
    lastScore: null,
    recentWrong: 0,
  }));
  return {
    token: 'test',
    context: {
      level: 'A1',
      goal: 'general',
      courseId: null,
      recentSkills: [],
      assessmentSkills: [],
      recentLessons: [],
      lessons,
    },
    plan: {
      id: 'week',
      start: '2026-11-04',
      today: '2026-11-04',
      timeZone: 'Europe/Moscow',
      goal: 'travel',
      minutes: 10,
      revision: 0,
      days: Array.from({ length: 7 }, (_, i) => ({
        index: i,
        date: `2026-11-${String(4 + i).padStart(2, '0')}`,
        tasks: [],
      })),
    },
  };
}
it('schedules seven days, all four budgets, level and goal without AI or answers', () => {
  for (const minutes of [5, 10, 15, 20] as const) {
    const s = fixture();
    s.plan.minutes = minutes;
    s.context.lessons.unshift({
      ...s.context.lessons[0],
      id: 'advanced',
      level: 'C2',
    });
    const days = scheduleWeek(s);
    expect(days).toHaveLength(7);
    expect(
      days.every((d) => d.tasks.reduce((n, t) => n + t.minutes, 0) <= minutes),
    ).toBe(true);
    expect(
      days.flatMap((d) => d.tasks).some((t) => t.lessonId === 'advanced'),
    ).toBe(false);
    expect(
      s.context.lessons.find((l) => l.id === days[0].tasks[0].lessonId)?.goals,
    ).toContain('travel');
    expect(scheduleWeek(s)).toEqual(days);
  }
});
it('adds weak-topic practice, respects prerequisites and preserves moved dates, completed work and history', () => {
  const s = fixture();
  s.context.recentSkills = [{ skill: 'grammar', answered: 10, correct: 2 }];
  const weak = s.context.lessons[1];
  weak.lastScore = 30;
  weak.recentWrong = 5;
  weak.bestScore = 30;
  s.context.lessons[3].prerequisites = ['unavailable-prerequisite'];
  const days = scheduleWeek(s);
  expect(
    days.some((d) =>
      d.tasks.some((t) => t.kind === 'practice' && t.lessonId === weak.id),
    ),
  ).toBe(true);
  expect(
    days
      .flatMap((d) => d.tasks)
      .some((t) => t.lessonId === s.context.lessons[3].id),
  ).toBe(false);
  days[0].tasks[0].completedAt = '2026-11-04T12:00:00Z';
  [days[1].date, days[2].date] = [days[2].date, days[1].date];
  s.plan.days = days;
  s.plan.today = '2026-11-05';
  s.plan.goal = 'study';
  s.plan.minutes = 5;
  const next = scheduleWeek(s);
  expect(next[0]).toEqual(days[0]);
  expect(next[1].date).toBe(days[1].date);
  expect(weeklyStatistics({ ...s.plan, days: next }).completed).toBe(1);
});
it('rejects forged identity, premium status, completion, budget and ambiguous commands', () => {
  for (const bad of [
    { action: 'refresh', userId: 'other' },
    { action: 'settings', goal: 'travel', minutes: 60 },
    { action: 'settings', goal: '__proto__', minutes: 10 },
    { action: 'refresh', premium: true },
    { action: 'complete' },
    { action: 'move', day: 7, date: '2026-11-04', revision: 0 },
  ])
    expect(() => weeklyCommand(bad)).toThrow();
  expect(
    weeklyCommand({ action: 'settings', goal: 'gaming', minutes: 20 }),
  ).toEqual({ action: 'settings', goal: 'gaming', minutes: 20 });
});

const db = new PGlite();
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
async function user(premium = true) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Weekly learner')",
    [id],
  );
  await rpc('placement_beginner', [id]);
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Isolated weekly test',
    ]);
  return id;
}
async function save(
  id: string,
  goal: string | null = null,
  minutes: number | null = null,
) {
  const snapshot = await rpc<WeeklySnapshot>('weekly_plan_snapshot', [
    id,
    goal,
    minutes,
  ]);
  const days = scheduleWeek(snapshot);
  const plan = await rpc<WeeklyPlan>('weekly_plan_store', [
    id,
    snapshot.plan.id,
    snapshot.plan.revision,
    snapshot.token,
    JSON.stringify(days),
  ]);
  return { snapshot, plan };
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const name of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile('supabase/migrations/' + name, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('requires a real level, respects the central flag and reports private schema readiness', async () => {
  const id = await user();
  await db.query(
    'UPDATE public.users SET english_route_level=NULL WHERE id=$1',
    [id],
  );
  await db.query('DELETE FROM public.user_language_levels WHERE user_id=$1', [
    id,
  ]);
  await expect(rpc('weekly_plan_snapshot', [id])).rejects.toThrow(
    'level required',
  );
  await rpc('placement_beginner', [id]);
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='lesson_review_plan'",
  );
  await expect(rpc('weekly_plan_snapshot', [id])).rejects.toThrow(
    'premium required',
  );
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='lesson_review_plan'",
  );
  await db.exec('SET ROLE service_role');
  expect(await rpc('weekly_plan_database_status')).toEqual({
    version: 'weekly-v1',
    ready: true,
  });
  await db.exec(
    'RESET ROLE;GRANT SELECT ON public.weekly_plans TO authenticated;SET ROLE service_role',
  );
  expect(await rpc('weekly_plan_database_status')).toEqual({
    version: 'weekly-v1',
    ready: false,
  });
  await db.exec(
    'RESET ROLE;REVOKE SELECT ON public.weekly_plans FROM authenticated',
  );
});
it('starts the next seven days without deleting the previous week and uses the saved timezone', async () => {
  const id = await user();
  await db.query(
    "UPDATE public.users SET time_zone='Pacific/Kiritimati' WHERE id=$1",
    [id],
  );
  const before = (await save(id)).plan;
  expect(before.timeZone).toBe('Pacific/Kiritimati');
  expect(before.today).toBe(
    (
      await db.query<{ today: string }>(
        "SELECT ((now() AT TIME ZONE 'Pacific/Kiritimati')::date)::text AS today",
      )
    ).rows[0].today,
  );
  await db.query(
    'UPDATE public.weekly_plans SET starts_on=starts_on-7 WHERE id=$1',
    [before.id],
  );
  await db.query(
    'UPDATE public.weekly_plan_days SET scheduled_on=scheduled_on-7 WHERE plan_id=$1',
    [before.id],
  );
  const next = (await save(id)).plan;
  expect(next.id).not.toBe(before.id);
  expect(next.start).toBe(next.today);
  expect(
    (
      await db.query<{ n: number }>(
        'SELECT count(*) AS n FROM public.weekly_plans WHERE user_id=$1',
        [id],
      )
    ).rows[0].n,
  ).toBe(2);
});
it('persists an isolated calendar, preferences and dates, prevents races, and grants no self-service access', async () => {
  const a = await user(),
    b = await user(false);
  await db.exec('SET ROLE service_role');
  const { plan, snapshot } = await save(a, 'gaming', 15);
  expect(plan.days).toHaveLength(7);
  expect(plan.goal).toBe('gaming');
  expect(plan.minutes).toBe(15);
  expect(await rpc('weekly_plan_view', [plan.id])).toEqual(plan);
  await expect(rpc('weekly_plan_snapshot', [b])).rejects.toThrow(
    'premium required',
  );
  await expect(
    rpc('weekly_plan_store', [
      b,
      plan.id,
      plan.revision,
      snapshot.token,
      JSON.stringify(plan.days),
    ]),
  ).rejects.toThrow('premium required');
  await rpc('weekly_plan_move', [
    a,
    plan.id,
    0,
    plan.days[1].date,
    plan.revision,
  ]);
  await expect(
    rpc('weekly_plan_move', [a, plan.id, 0, plan.days[2].date, plan.revision]),
  ).rejects.toThrow('weekly conflict');
  const next = await save(a);
  expect(next.plan.days[0].date).toBe(plan.days[1].date);
  await expect(
    rpc('weekly_plan_move', [a, plan.id, 0, '2026-02-30', next.plan.revision]),
  ).rejects.toThrow();
  await expect(
    rpc('weekly_plan_move', [a, plan.id, 0, '2099-01-01', next.plan.revision]),
  ).rejects.toThrow('invalid move');
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    for (const table of [
      'weekly_plans',
      'weekly_plan_days',
      'weekly_plan_tasks',
    ])
      await expect(db.query('SELECT * FROM public.' + table)).rejects.toThrow(
        'permission denied',
      );
    await expect(rpc('weekly_plan_view', [plan.id])).rejects.toThrow(
      'permission denied',
    );
    await expect(rpc('weekly_plan_snapshot', [a])).rejects.toThrow(
      'permission denied',
    );
    await expect(
      rpc('weekly_plan_move', [a, plan.id, 0, plan.days[0].date, 0]),
    ).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  }
});
it('uses real successful attempts once, recalculates on new evidence, preserves progress on expiry/reactivation', async () => {
  const id = await user();
  const first = await save(id);
  const task = first.plan.days.flatMap((d) => d.tasks)[0];
  expect(task).toBeDefined();
  const attempt = randomUUID();
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,started_at,status,score,completed_at) VALUES($1,$2,$3,now()-interval '1 minute','completed',90,now())",
    [attempt, id, task.lessonId],
  );
  let persisted = await rpc<WeeklyPlan>('weekly_plan_view', [first.plan.id]);
  expect(weeklyStatistics(persisted).completed).toBe(1);
  await expect(
    rpc('weekly_plan_store', [
      id,
      first.plan.id,
      first.plan.revision,
      first.snapshot.token,
      JSON.stringify(first.plan.days),
    ]),
  ).rejects.toThrow('weekly conflict');
  persisted = (await save(id, 'study', 5)).plan;
  expect(weeklyStatistics(persisted).completed).toBe(1);
  const completeDay = persisted.days.find((d) =>
    d.tasks.some((t) => t.completedAt),
  )!;
  await expect(
    rpc('weekly_plan_move', [
      id,
      persisted.id,
      completeDay.index,
      persisted.days.find((d) => d.index !== completeDay.index)!.date,
      persisted.revision,
    ]),
  ).rejects.toThrow('invalid completed move');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [id],
  );
  await expect(rpc('weekly_plan_snapshot', [id])).rejects.toThrow(
    'premium required',
  );
  await expect(
    rpc('weekly_plan_store', [
      id,
      persisted.id,
      persisted.revision,
      first.snapshot.token,
      JSON.stringify(persisted.days),
    ]),
  ).rejects.toThrow('premium required');
  await rpc('grant_premium_access', [
    id,
    randomUUID(),
    30,
    'Reactivation test',
  ]);
  const restored = (await save(id)).plan;
  expect(restored.id).toBe(first.plan.id);
  expect(weeklyStatistics(restored).completed).toBe(1);
  expect(
    (
      await db.query<{ n: number }>(
        'SELECT count(*) AS n FROM public.lesson_attempts WHERE user_id=$1',
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('rejects stale learning evidence, unknown lessons and forged completed fields without partial writes', async () => {
  const id = await user();
  const { snapshot, plan } = await save(id);
  const old = await rpc<WeeklySnapshot>('weekly_plan_snapshot', [id]);
  await rpc('learning_path_preferences', [id, 'travel', null]);
  await expect(
    rpc('weekly_plan_store', [
      id,
      plan.id,
      plan.revision,
      old.token,
      JSON.stringify(plan.days),
    ]),
  ).rejects.toThrow('weekly conflict');
  const current = await rpc<WeeklySnapshot>('weekly_plan_snapshot', [id]);
  const days = scheduleWeek(current);
  days[0].tasks[0].lessonId = randomUUID();
  await expect(
    rpc('weekly_plan_store', [
      id,
      plan.id,
      current.plan.revision,
      current.token,
      JSON.stringify(days),
    ]),
  ).rejects.toThrow('unavailable lesson');
  expect(await rpc('weekly_plan_view', [plan.id])).toEqual(plan);
  const forged = scheduleWeek(current);
  forged[0].tasks[0].completedAt = new Date().toISOString();
  const saved = await rpc<WeeklyPlan>('weekly_plan_store', [
    id,
    plan.id,
    current.plan.revision,
    current.token,
    JSON.stringify(forged),
  ]);
  expect(weeklyStatistics(saved).completed).toBe(0);
  expect(snapshot.plan.id).toBe(plan.id);
});

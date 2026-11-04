import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  analyticsQuery,
  analyticsSegments,
  accuracyChange,
  difficultTopics,
  analyticsRecommendations,
  type EnglishAnalytics,
} from '@/lib/learning/analytics';
const db = new PGlite();
const lesson = '40000000-0000-0000-0000-000000000001';
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
    "INSERT INTO public.users(id,display_name) VALUES($1,'Analytics learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Isolated analytics test',
    ]);
  return id;
}
async function attempt(
  id: string,
  day: number,
  answers: { kind: string; correct: boolean }[],
  seconds = 600,
  status = 'completed',
  lessonId = lesson,
) {
  const a = randomUUID();
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,started_at) VALUES($1,$2,$3,now()-$4::integer*interval '1 day'-$5::integer*interval '1 second')",
    [a, id, lessonId, day, seconds],
  );
  for (const [i, answer] of answers.entries()) {
    await db.query(
      "INSERT INTO public.lesson_attempt_items(attempt_id,position,exercise_id,kind,prompt,payload,answer_key,explanation) VALUES($1,$2,$3,$4,'Private exercise','{}','{\"private_answer\":\"NEVER_EXPOSE\"}','Private explanation')",
      [a, i + 1, randomUUID(), answer.kind],
    );
    await db.query(
      "INSERT INTO public.exercise_submissions(attempt_id,position,answer,correct,feedback) VALUES($1,$2,'\"PRIVATE_USER_ANSWER\"',$3,'private feedback')",
      [a, i + 1, answer.correct],
    );
  }
  if (status === 'completed')
    await db.query(
      "UPDATE public.lesson_attempts SET status='completed',score=80,completed_at=now()-$2::integer*interval '1 day' WHERE id=$1",
      [a, day],
    );
  else if (status === 'abandoned')
    await db.query(
      "UPDATE public.lesson_attempts SET status='abandoned' WHERE id=$1",
      [a],
    );
  return a;
}
const report = (id: string, days = 7, offset = 0) =>
  rpc<EnglishAnalytics>('english_analytics', [id, days, offset]);
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
it('uses null instead of invented zero metrics and returns complete empty periods', async () => {
  const id = await user();
  for (const days of [7, 30, 90]) {
    const r = await report(id, days);
    expect(r.current).toMatchObject({
      attempts: 0,
      answered: 0,
      accuracy: null,
      elapsedSeconds: null,
    });
    expect(r.daily).toHaveLength(days);
    expect(r.daily.every((d) => d.accuracy === null)).toBe(true);
    expect(r.skills).toHaveLength(4);
    expect(r.history).toEqual([]);
    expect(r.topics).toEqual([]);
  }
});
it('calculates real weighted accuracy, all four skills, unknown exercises and time without leaking answer content', async () => {
  const id = await user();
  await attempt(id, 0, [
    ...Array.from({ length: 5 }, (_, i) => ({
      kind: 'grammar',
      correct: i < 3,
    })),
    { kind: 'translation', correct: true },
    { kind: 'translation', correct: false },
    { kind: 'reading', correct: true },
    { kind: 'dictation', correct: false },
    { kind: 'single_choice', correct: true },
  ]);
  await attempt(
    id,
    8,
    Array.from({ length: 5 }, (_, i) => ({
      kind: 'grammar',
      correct: i === 0,
    })),
    300,
  );
  const r = await report(id);
  expect(r.current).toMatchObject({
    attempts: 1,
    answered: 10,
    correct: 6,
    accuracy: 60,
    elapsedSeconds: 600,
    averageSeconds: 600,
    medianSeconds: 600,
  });
  expect(r.previous).toMatchObject({
    answered: 5,
    correct: 1,
    accuracy: 20,
    elapsedSeconds: 300,
  });
  expect(accuracyChange(r.current, r.previous)).toBe(40);
  expect(r.skills.map((s) => [s.skill, s.accuracy])).toEqual([
    ['grammar', 60],
    ['vocabulary', 50],
    ['reading', 100],
    ['listening', 0],
  ]);
  await db.exec('SET ROLE service_role');
  expect((await report(id)).current.accuracy).toBe(60);
  await db.exec('RESET ROLE');
  expect(r.unclassified).toBe(1);
  expect(r.topics[0]).toMatchObject({ answered: 10, accuracy: 60 });
  expect(JSON.stringify(r)).not.toMatch(
    /NEVER_EXPOSE|PRIVATE_USER_ANSWER|Private explanation|private feedback/,
  );
});
it('keeps period boundaries separate, ignores unfinished attempts, foreign users and non-English courses', async () => {
  const id = await user(),
    other = await user();
  await attempt(id, 6, [{ kind: 'reading', correct: true }]);
  await attempt(id, 7, [{ kind: 'reading', correct: false }]);
  await attempt(id, 14, [{ kind: 'reading', correct: false }]);
  await attempt(id, 0, [{ kind: 'reading', correct: false }], 600, 'started');
  await attempt(id, 0, [{ kind: 'reading', correct: false }], 600, 'abandoned');
  await attempt(other, 0, [{ kind: 'reading', correct: false }]);
  const lang = randomUUID(),
    course = randomUUID(),
    unit = randomUUID(),
    foreign = randomUUID();
  await db.query(
    "INSERT INTO public.languages(id,code,name) VALUES($1,'fr','French')",
    [lang],
  );
  await db.query(
    "INSERT INTO public.courses(id,language_id,slug,title,level) VALUES($1,$2,$3,'French','A1')",
    [course, lang, randomUUID()],
  );
  await db.query(
    "INSERT INTO public.units(id,course_id,title,position) VALUES($1,$2,'French',1)",
    [unit, course],
  );
  await db.query(
    "INSERT INTO public.lessons(id,unit_id,title,position) VALUES($1,$2,'French lesson',1)",
    [foreign, unit],
  );
  await attempt(
    id,
    0,
    [{ kind: 'reading', correct: false }],
    600,
    'completed',
    foreign,
  );
  const r = await report(id);
  expect(r.current).toMatchObject({ answered: 1, accuracy: 100, attempts: 1 });
  expect(r.previous).toMatchObject({ answered: 1, accuracy: 0, attempts: 1 });
  expect(r.historyTotal).toBe(1);
});
it('includes retakes, flags long elapsed attempts, paginates deterministically and uses the profile timezone', async () => {
  const id = await user();
  for (let i = 0; i < 23; i++)
    await attempt(
      id,
      0,
      [{ kind: 'grammar', correct: i % 2 === 0 }],
      i === 0 ? 9000 : 60,
    );
  await db.query(
    "UPDATE public.users SET time_zone='Pacific/Kiritimati' WHERE id=$1",
    [id],
  );
  const first = await report(id),
    second = await report(id, 7, 20);
  expect(first.historyTotal).toBe(23);
  expect(first.current.attempts).toBe(23);
  expect(first.current.lessons).toBe(1);
  expect(first.history).toHaveLength(20);
  expect(second.history).toHaveLength(3);
  expect(
    new Set([...first.history, ...second.history].map((h) => h.attemptId)).size,
  ).toBe(23);
  expect(first.current.longAttempts).toBe(1);
  expect(first.end).toBe(
    (
      await db.query<{ d: string }>(
        "SELECT ((now() AT TIME ZONE 'Pacific/Kiritimati')::date)::text AS d",
      )
    ).rows[0].d,
  );
});
it('requires current Premium and central permissions on every request, while retaining data after expiry', async () => {
  const free = await user(false),
    id = await user();
  await attempt(id, 0, [{ kind: 'tenses', correct: false }]);
  await expect(report(free)).rejects.toThrow('premium required');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='advanced_statistics'",
  );
  await expect(report(id)).rejects.toThrow('premium required');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='advanced_statistics'",
  );
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [id],
  );
  await expect(report(id)).rejects.toThrow('premium required');
  await rpc('grant_premium_access', [
    id,
    randomUUID(),
    30,
    'Analytics reactivation',
  ]);
  expect((await report(id)).current.answered).toBe(1);
  for (const role of ['anon', 'authenticated']) {
    await db.exec('SET ROLE ' + role);
    await expect(report(id)).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  }
  expect(await rpc('english_analytics_database_status')).toEqual({
    version: 'analytics-v1',
    ready: true,
  });
});
it('splits sparse chart observations, requires comparison sample sizes, and rejects forged query parameters', () => {
  const day = {
    date: '2026-11-04',
    answered: 1,
    correct: 1,
    attempts: 1,
    elapsedSeconds: 60,
  };
  expect(
    analyticsSegments([
      { ...day, accuracy: 100 },
      { ...day, accuracy: null },
      { ...day, accuracy: 0 },
    ]),
  ).toHaveLength(2);
  expect(
    accuracyChange(
      { answered: 4, accuracy: 100 },
      { answered: 6, accuracy: 10 },
    ),
  ).toBeNull();
  for (const query of [
    'days=8',
    'days=7&days=30',
    'userId=other',
    'premium=true',
    'offset=-1',
    'offset=100001',
  ])
    expect(() => analyticsQuery(new URLSearchParams(query))).toThrow();
  expect(analyticsQuery(new URLSearchParams('days=90&offset=20'))).toEqual({
    days: 90,
    offset: 20,
  });
  expect(
    difficultTopics([
      {
        lessonId: 'x',
        title: 'x',
        unit: 'x',
        course: 'x',
        answered: 3,
        correct: 0,
        accuracy: 0,
      },
    ]),
  ).toEqual([]);
  expect(
    analyticsRecommendations(
      [{ lessonId: 'weak', title: 'Weak', reason: 'weak_topic' }],
      {
        level: null,
        goal: 'general',
        courseId: null,
        assessmentSkills: [],
        recentSkills: [],
        recentLessons: [],
        lessons: [],
      },
    ),
  ).toHaveLength(1);
});

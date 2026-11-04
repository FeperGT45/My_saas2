import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildLearningMap } from '@/lib/learning/map';
import type { LearningContext, LearningLesson } from '@/lib/learning/recommend';
const lesson = (
  id: string,
  extra: Partial<LearningLesson> = {},
): LearningLesson => ({
  id,
  title: id,
  unitTitle: 'Глава 1',
  courseId: 'course',
  courseTitle: 'Курс',
  level: 'A1',
  goals: ['general'],
  skills: ['grammar'],
  prerequisites: [],
  bestScore: null,
  lastScore: null,
  recentWrong: 0,
  ...extra,
});
const context = (lessons: LearningLesson[]): LearningContext => ({
  level: 'A1',
  goal: 'general',
  courseId: null,
  assessmentSkills: [],
  recentSkills: [],
  recentLessons: [],
  lessons,
});
it('maps real progress and prerequisites without locking manual lesson access', () => {
  const c = context([
    lesson('done', { bestScore: 60 }),
    lesson('next', { prerequisites: ['done'] }),
    lesson('later', { prerequisites: ['next'] }),
  ]);
  const map = buildLearningMap(c, ['later']);
  expect(map.courses[0].chapters[0]).toMatchObject({
    completed: 1,
    total: 3,
    progress: 33,
  });
  expect(map.next?.id).toBe('next');
  expect(map.courses[0].chapters[0].lessons.map((l) => l.state)).toEqual([
    'completed',
    'recommended',
    'foundation',
  ]);
  expect(map.courses[0].chapters[0].lessons[2]).toMatchObject({
    id: 'later',
    checkpoint: true,
  });
});
it('recalculates the next step after completion and respects the chosen course', () => {
  const c = context([
    lesson('one', { bestScore: 80 }),
    lesson('two'),
    lesson('other', { courseId: 'other' }),
  ]);
  c.courseId = 'other';
  expect(buildLearningMap(c).next?.id).toBe('other');
  c.courseId = null;
  c.lessons[1].bestScore = 80;
  expect(buildLearningMap(c).courses[0].chapters[0].progress).toBe(100);
});
it('does not fabricate progress, skill evidence or recommendations before assessment', () => {
  const c = context([]);
  c.level = null;
  expect(buildLearningMap(c)).toMatchObject({
    next: null,
    courses: [],
    plan: { skills: [], mastered: 0 },
  });
});
const db = new PGlite(),
  a = randomUUID(),
  b = randomUUID();
async function stats(id: string) {
  return (
    await db.query<{ data: Record<string, unknown> }>(
      'select public.learner_statistics($1) data',
      [id],
    )
  ).rows[0].data;
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  );
  for (const f of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
  await db.exec(
    await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
  );
  await db.query('insert into auth.users values($1),($2)', [a, b]);
  await db.query(
    "insert into public.users(id,display_name) values($1,'Learner'),($2,'Other')",
    [a, b],
  );
}, 30000);
afterAll(() => db.close());
it('returns honest empty statistics without changing progress or rewards', async () => {
  expect(await stats(a)).toMatchObject({
    passedLessons: 0,
    answered: 0,
    accuracy: null,
    attemptMinutes: null,
    words: 0,
    dueWords: 0,
    reviews: 0,
  });
});
it('isolates real words, accuracy, passed lessons and attempt duration by user', async () => {
  const id = (
    await db.query<{ id: string }>('select id from public.lessons limit 1')
  ).rows[0].id;
  await db.query(
    `update public.lessons set lexicon='[{"en":"Apple","ru":"яблоко"},{"en":"apple","ru":"яблоко"}]' where id=$1`,
    [id],
  );
  await db.query(
    'insert into public.user_progress(user_id,lesson_id,best_score) values($1,$3,80),($2,$3,20)',
    [a, b, id],
  );
  const attempt = randomUUID();
  await db.query(
    "insert into public.lesson_attempts(id,user_id,lesson_id,status,score,started_at,completed_at) values($1,$2,$3,'completed',67,now()-interval '10 minutes',now())",
    [attempt, a, id],
  );
  for (let n = 1; n <= 3; n++) {
    await db.query(
      "insert into public.lesson_attempt_items(attempt_id,position,exercise_id,kind,prompt,payload,answer_key,explanation) values($1,$2,$3,'gap','Test','{}','{}','Explanation')",
      [attempt, n, randomUUID()],
    );
    await db.query(
      "insert into public.exercise_submissions(attempt_id,position,answer,correct,feedback) values($1,$2,'\"word\"',$3,'Feedback')",
      [attempt, n, n <= 2],
    );
  }
  expect(await stats(a)).toMatchObject({
    passedLessons: 1,
    completedAttempts: 1,
    words: 1,
    dueWords: 1,
    answered: 3,
    correct: 2,
    accuracy: 67,
    attemptMinutes: 10,
  });
  expect(await stats(b)).toMatchObject({
    passedLessons: 0,
    words: 0,
    answered: 0,
    accuracy: null,
  });
  const before = (await db.query('select count(*) n from public.xp_events'))
    .rows;
  await stats(a);
  expect(
    (await db.query('select count(*) n from public.xp_events')).rows,
  ).toEqual(before);
});
it('counts future reviews correctly and denies client RPC access', async () => {
  await db.query('select public.word_review_queue($1)', [a]);
  await db.query(
    "update public.word_reviews set due_at=now()+interval '1 day' where user_id=$1",
    [a],
  );
  expect(await stats(a)).toMatchObject({ words: 1, dueWords: 0 });
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    try {
      await expect(stats(a)).rejects.toThrow('permission denied');
    } finally {
      await db.exec('reset role');
    }
  }
});

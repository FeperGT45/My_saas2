import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { weakTopics, weakLesson } from '../helpers/weak-fixture';
import {
  challengeCommand,
  challengeQuery,
  type Challenges,
  type SprintState,
  type SprintFeedback,
} from '@/lib/learning/challenges';
const db = new PGlite();
let topics: string[];
async function rpc<T = unknown>(fn: string, args: unknown[] = []): Promise<T> {
  return (
    await db.query<{ v: T }>(
      `SELECT public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS v`,
      args,
    )
  ).rows[0].v;
}
const command = <T = Challenges>(u: string, b: unknown) =>
  rpc<T>('challenge_command', [u, JSON.stringify(b)]);
const dashboard = (u: string) => rpc<Challenges>('challenge_dashboard', [u]);
async function user(premium = true) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Challenger')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Challenge isolated test',
    ]);
  return id;
}
async function enroll(u: string, code: string, requestId = randomUUID()) {
  return (
    await command(u, { action: 'enroll', code, requestId })
  ).enrollments.find((e) => e.code === code)!;
}
async function review(u: string, front: string, rating = 4) {
  const key = randomUUID();
  await db.query(
    "INSERT INTO public.word_reviews(user_id,word_key,front,back) VALUES($1,$2,$3,'перевод')",
    [u, key, front],
  );
  await rpc('word_review_answer', [u, randomUUID(), key, 0, rating]);
  return key;
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const f of (await readdir('supabase/migrations')).sort()) {
    try {
      await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
    } catch (e) {
      throw Error(f + ': ' + (e as Error).message);
    }
  }
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.exec(await readFile('supabase/stories-seed.sql', 'utf8'));
  topics = await weakTopics(db);
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('offers weekly themes, six modest optional goals and full seven-day windows without client progress', async () => {
  const u = await user();
  const d = await dashboard(u);
  expect(d.templates).toHaveLength(6);
  expect(d.templates.filter((t) => t.featured)).toHaveLength(3);
  const request = randomUUID(),
    e = await enroll(u, 'new-words', request);
  expect(new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()).toBe(
    7 * 86400000,
  );
  expect((await enroll(u, 'new-words', request)).id).toBe(e.id);
  expect((await enroll(u, 'new-words')).id).toBe(e.id);
  expect(() =>
    challengeCommand({ action: 'claim', enrollmentId: e.id, progress: 20 }),
  ).toThrow();
  expect(() => challengeQuery(new URLSearchParams('userId=x'))).toThrow();
  expect(await rpc('challenge_database_status')).toMatchObject({ ready: true });
});
it('counts first successful English words and distinct reviews, preserves history after deletion and cannot farm synonyms/case', async () => {
  const u = await user();
  await review(u, 'already');
  const a = await enroll(u, 'new-words'),
    b = await enroll(u, 'word-review');
  await review(u, 'ALREADY');
  for (let i = 0; i < 30; i++) await review(u, 'word ' + i, i < 20 ? 4 : 0);
  await review(u, 'WORD 0');
  let d = await dashboard(u);
  expect(d.enrollments.find((e) => e.id === a.id)).toMatchObject({
    progress: 20,
  });
  expect(d.enrollments.find((e) => e.id === b.id)).toMatchObject({
    progress: 30,
  });
  expect(d.enrollments.every((e) => e.completed_at !== null)).toBe(true);
  await db.query('DELETE FROM public.word_reviews WHERE user_id=$1', [u]);
  d = await dashboard(u);
  expect(d.enrollments.find((e) => e.id === a.id)?.progress).toBe(20);
  const claim = await command<{ awarded: boolean; dashboard: Challenges }>(u, {
    action: 'claim',
    enrollmentId: a.id,
  });
  expect(claim.awarded).toBe(true);
  expect(
    (
      await command<{ awarded: boolean }>(u, {
        action: 'claim',
        enrollmentId: a.id,
      })
    ).awarded,
  ).toBe(false);
  expect((await rpc<{ xp: number }>('game_summary', [u])).xp).toBe(0);
});
it('counts distinct passed lessons, completed stories and grammar topics from trusted source transitions', async () => {
  const u = await user();
  const lessons = await enroll(u, 'five-lessons'),
    grammar = await enroll(u, 'grammar-marathon'),
    story = await enroll(u, 'one-story');
  await weakLesson(db, u, topics[0], 0);
  await weakLesson(db, u, topics[0], 0);
  await weakLesson(db, u, topics[1], 5);
  expect(
    (await dashboard(u)).enrollments.find((e) => e.id === lessons.id)?.progress,
  ).toBe(1);
  let s = await rpc<{ id: string; version: number; status: string }>(
    'story_start',
    [u, 'first-school-day', randomUUID()],
  );
  while (s.status === 'active')
    s = await rpc('story_choose', [u, s.id, randomUUID(), s.version, 'a']);
  expect(
    (await dashboard(u)).enrollments.find((e) => e.id === story.id)?.progress,
  ).toBe(1);
  await weakLesson(db, u, topics[0], 3, 8);
  await weakLesson(db, u, topics[1], 0, 8);
  const run = await rpc<{ id: string; exercise: { position: number } | null }>(
    'weak_start',
    [u, topics[0], randomUUID()],
  );
  let w = run;
  while (w.exercise) {
    const result = await rpc<{ state: typeof w }>('weak_answer', [
      u,
      w.id,
      randomUUID(),
      w.exercise.position,
      '"a"',
    ]);
    w = result.state;
  }
  expect(
    (await dashboard(u)).enrollments.find((e) => e.id === grammar.id)?.progress,
  ).toBe(1);
  for (let j = 0; j < 3; j++) {
    const topic = randomUUID();
    await db.query(
      "INSERT INTO public.lessons(id,unit_id,title,position,published,cefr_level) VALUES($1,'30000000-0000-0000-0000-000000000001',$2,$3,true,'A1')",
      [topic, 'Грамматика ' + j, 70 + j],
    );
    await db.query(
      'INSERT INTO public.exercises(id,lesson_id,kind,prompt,explanation,position,public_payload,answer_key) SELECT gen_random_uuid(),$1,kind,prompt,explanation,position,public_payload,answer_key FROM public.exercises WHERE lesson_id=$2',
      [topic, topics[0]],
    );
    await weakLesson(db, u, topic, 3, 5);
    let practice = await rpc<{
      id: string;
      exercise: { position: number } | null;
    }>('weak_start', [u, topic, randomUUID()]);
    while (practice.exercise)
      practice = (
        await rpc<{ state: typeof practice }>('weak_answer', [
          u,
          practice.id,
          randomUUID(),
          practice.exercise.position,
          '"a"',
        ])
      ).state;
    await weakLesson(db, u, topic, 0, 5);
  }
  const before = await rpc<{ xp: number; coins: number }>('game_summary', [u]);
  for (const entry of [lessons, grammar, story])
    expect(
      (
        await command<{ awarded: boolean }>(u, {
          action: 'claim',
          enrollmentId: entry.id,
        })
      ).awarded,
    ).toBe(true);
  expect(await rpc('game_summary', [u])).toMatchObject({
    xp: before.xp,
    coins: before.coins,
  });
});
it('enforces personal boundaries and permits delayed collection without erasing expired progress', async () => {
  const u = await user(),
    e = await enroll(u, 'one-story');
  const start = new Date(e.starts_at).getTime(),
    end = new Date(e.ends_at).getTime();
  await db.query(
    "INSERT INTO public.challenge_facts VALUES($1,'story','old','old',$2),($1,'story','end','end',$3)",
    [u, new Date(start - 1).toISOString(), new Date(end).toISOString()],
  );
  expect((await dashboard(u)).enrollments[0].progress).toBe(0);
  await db.query(
    "INSERT INTO public.challenge_facts VALUES($1,'story','inside','inside',$2)",
    [u, new Date(start + 1).toISOString()],
  );
  expect((await dashboard(u)).enrollments[0].completed_at).not.toBeNull();
  await db.query(
    "UPDATE public.challenge_enrollments SET starts_at=starts_at-interval '14 days',ends_at=ends_at-interval '14 days',completed_at=completed_at-interval '14 days' WHERE id=$1",
    [e.id],
  );
  expect(
    (
      await command<{ awarded: boolean }>(u, {
        action: 'claim',
        enrollmentId: e.id,
      })
    ).awarded,
  ).toBe(true);
});
it('prevents incomplete/foreign claims and equipping unowned assets, while preserving owned styles after Premium expiry', async () => {
  const u = await user(),
    other = await user(),
    e = await enroll(u, 'one-story');
  await expect(
    command(u, { action: 'claim', enrollmentId: e.id }),
  ).rejects.toThrow('incomplete');
  await expect(
    command(other, { action: 'claim', enrollmentId: e.id }),
  ).rejects.toThrow('unavailable');
  await expect(
    command(u, {
      action: 'equip',
      slot: 'badge',
      code: 'story-star',
      version: 0,
    }),
  ).rejects.toThrow('unavailable');
  await db.query(
    "INSERT INTO public.challenge_facts VALUES($1,'story','test','story',now())",
    [u],
  );
  await command(u, { action: 'claim', enrollmentId: e.id });
  let d = await command(u, {
    action: 'equip',
    slot: 'badge',
    code: 'story-star',
    version: 0,
  });
  expect(d.showcase.equipped[0].code).toBe('story-star');
  await expect(
    command(u, {
      action: 'equip',
      slot: 'frame',
      code: 'story-star',
      version: 1,
    }),
  ).rejects.toThrow('unavailable');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  await expect(enroll(u, 'five-lessons')).rejects.toThrow('premium required');
  await expect(
    command(u, { action: 'claim', enrollmentId: e.id }),
  ).rejects.toThrow('premium required');
  d = await command(u, {
    action: 'equip',
    slot: 'badge',
    code: null,
    version: 1,
  });
  expect(d.showcase.equipped).toEqual([]);
  expect(d.cosmetics.find((c) => c.code === 'story-star')?.owned).toBe(true);
});
it('serves only real level-appropriate sprint exercises and rewards slow/wrong practice equally, without XP', async () => {
  const u = await user(),
    e = await enroll(u, 'gentle-sprint');
  let s = await command<SprintState>(u, {
    action: 'sprint_start',
    enrollmentId: e.id,
    requestId: randomUUID(),
  });
  expect(s.total).toBe(5);
  expect(JSON.stringify(s)).not.toContain('answer_key');
  await db.query(
    "UPDATE public.challenge_sprints SET created_at=now()-interval '20 minutes' WHERE id=$1",
    [s.id],
  );
  while (s.exercise) {
    const item = (
      await db.query<{ payload: { options: { id: string }[] }; kind: string }>(
        'SELECT kind,payload FROM public.challenge_sprint_items WHERE run_id=$1 AND position=$2',
        [s.id, s.exercise.position],
      )
    ).rows[0];
    const answer = item.payload.options?.at(-1)?.id ?? 'test';
    const body = {
      action: 'sprint_answer',
      runId: s.id,
      requestId: randomUUID(),
      position: s.exercise.position,
      answer,
    };
    const f = await command<SprintFeedback>(u, body);
    expect(await command(u, body)).toMatchObject({
      correct: f.correct,
      explanation: f.explanation,
      state: { id: f.state.id, answered: f.state.answered },
    });
    s = f.state;
  }
  expect(s.elapsedSeconds).toBeGreaterThanOrEqual(1200);
  expect(
    (await dashboard(u)).enrollments.find((v) => v.id === e.id)?.completed_at,
  ).not.toBeNull();
  expect(
    (
      await command<{ awarded: boolean }>(u, {
        action: 'claim',
        enrollmentId: e.id,
      })
    ).awarded,
  ).toBe(true);
  expect((await rpc<{ xp: number }>('game_summary', [u])).xp).toBe(0);
});
it('Free retains basic achievements; client roles cannot write progress, issue cosmetics or read sprint answer keys', async () => {
  const u = await user(false);
  expect((await dashboard(u)).premium).toBe(false);
  await expect(enroll(u, 'one-story')).rejects.toThrow('premium required');
  expect(
    (await rpc<{ achievements: unknown[] }>('game_summary', [u])).achievements
      .length,
  ).toBeGreaterThan(0);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [u]);
  await db.exec('SET ROLE authenticated');
  await expect(
    command(u, {
      action: 'enroll',
      code: 'one-story',
      requestId: randomUUID(),
    }),
  ).rejects.toThrow('permission');
  await expect(
    db.query('SELECT * FROM public.challenge_sprint_items'),
  ).rejects.toThrow('permission');
  await expect(
    db.query(
      'INSERT INTO public.challenge_owned(user_id,cosmetic_code,source_id) VALUES($1,$2,$3)',
      [u, 'story-star', randomUUID()],
    ),
  ).rejects.toThrow('permission');
  await expect(
    db.query('UPDATE public.challenge_enrollments SET progress=30'),
  ).rejects.toThrow('permission');
  expect((await db.query('SELECT * FROM public.challenge_owned')).rows).toEqual(
    [],
  );
});
it('blocks missing materials, foreign sprint access, stale answers and disabled Premium features', async () => {
  const u = await user(),
    other = await user(),
    e = await enroll(u, 'gentle-sprint');
  await db.exec('UPDATE public.languages SET active=false');
  await expect(
    command(u, {
      action: 'sprint_start',
      enrollmentId: e.id,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow('materials unavailable');
  await db.exec('UPDATE public.languages SET active=true');
  const s = await command<SprintState>(u, {
    action: 'sprint_start',
    enrollmentId: e.id,
    requestId: randomUUID(),
  });
  await expect(rpc('challenge_sprint_state', [other, s.id])).rejects.toThrow(
    'unavailable',
  );
  await expect(
    command(u, {
      action: 'sprint_answer',
      runId: s.id,
      requestId: randomUUID(),
      position: 5,
      answer: 'a',
    }),
  ).rejects.toThrow('conflict');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='extra_exercises'",
  );
  expect(await rpc('challenge_sprint_state', [u, s.id])).toMatchObject({
    accessible: false,
    exercise: null,
  });
  await expect(
    command(u, {
      action: 'sprint_answer',
      runId: s.id,
      requestId: randomUUID(),
      position: 1,
      answer: 'a',
    }),
  ).rejects.toThrow('premium required');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='extra_exercises'",
  );
  expect(() =>
    challengeCommand({
      action: 'sprint_answer',
      runId: s.id,
      requestId: randomUUID(),
      position: 1,
      answer: 'a',
      elapsedSeconds: 0,
    }),
  ).toThrow();
});
it('records repeated weekly completions without creating duplicate cosmetics', async () => {
  const u = await user(),
    first = await enroll(u, 'one-story');
  await db.query(
    "INSERT INTO public.challenge_facts VALUES($1,'story','first-week','story',now())",
    [u],
  );
  await command(u, { action: 'claim', enrollmentId: first.id });
  await db.query(
    'UPDATE public.challenge_enrollments SET edition=edition-7 WHERE id=$1',
    [first.id],
  );
  const second = await enroll(u, 'one-story');
  expect(second.id).not.toBe(first.id);
  await db.query(
    "INSERT INTO public.challenge_facts VALUES($1,'story','next-week','story',now())",
    [u],
  );
  await command(u, { action: 'claim', enrollmentId: second.id });
  expect((await dashboard(u)).cosmetics.filter((c) => c.owned)).toHaveLength(1);
  expect(
    (await dashboard(u)).enrollments.filter((e) => e.claimed_at),
  ).toHaveLength(2);
});

it('keeps already counted progress when a later reconciliation sees fewer records', async () => {
  const u = await user(),
    e = await enroll(u, 'word-review');
  await review(u, 'retain');
  expect(
    (await dashboard(u)).enrollments.find((v) => v.id === e.id)?.progress,
  ).toBe(1);
  await db.query(
    "DELETE FROM public.challenge_facts WHERE user_id=$1 AND kind='word_review'",
    [u],
  );
  expect(
    (await dashboard(u)).enrollments.find((v) => v.id === e.id)?.progress,
  ).toBe(1);
  await expect(
    command(u, { action: 'claim', enrollmentId: e.id }),
  ).rejects.toThrow('incomplete');
});

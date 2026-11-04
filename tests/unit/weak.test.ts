import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { weakTopics, weakLesson } from '../helpers/weak-fixture';
import {
  weakCommand,
  weakQuery,
  type WeakState,
  type WeakFeedback,
  type WeakDashboard,
} from '@/lib/learning/weak';
const db = new PGlite();
let topics: string[];
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
async function user(premium = true, history = true) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Weak learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Weak test grant',
    ]);
  if (history) {
    await weakLesson(db, id, topics[0]);
    await weakLesson(db, id, topics[1], 0);
  }
  return id;
}
const dashboard = (u: string) => rpc<WeakDashboard>('weak_dashboard', [u]);
const start = (
  u: string,
  topic: string | null = null,
  id: string = randomUUID(),
) => rpc<WeakState>('weak_start', [u, topic, id]);
const state = (u: string, id: string) => rpc<WeakState>('weak_state', [u, id]);
const answer = (
  u: string,
  s: WeakState,
  a: unknown = 'a',
  request: string = randomUUID(),
) =>
  rpc<WeakFeedback>('weak_answer', [
    u,
    s.id,
    request,
    s.exercise?.position ?? 1,
    JSON.stringify(a),
  ]);
async function finish(u: string, s: WeakState) {
  while (s.exercise) s = (await answer(u, s)).state;
  return s;
}
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const file of (await readdir('supabase/migrations')).sort()) {
    const sql = await readFile('supabase/migrations/' + file, 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      throw Error(file + ': ' + (e as Error).message);
    }
  }
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  topics = await weakTopics(db);
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('requires real sufficient history and deduplicates repetitions of the same exercise', async () => {
  const u = await user(true, false);
  expect((await dashboard(u)).enough).toBe(false);
  await expect(start(u)).rejects.toThrow('insufficient');
  for (let i = 0; i < 4; i++) await weakLesson(db, u, topics[0]);
  expect((await dashboard(u)).enough).toBe(false);
  await weakLesson(db, u, topics[1], 0);
  const d = await dashboard(u);
  expect(d.enough).toBe(true);
  expect(d.topics.find((t) => t.id === topics[0])).toMatchObject({
    answered: 5,
    wrong: 3,
    accuracy: 40,
    status: 'weak',
  });
  expect(d.topics.find((t) => t.id === topics[1])?.status).toBe('mastered');
});
it('selects only actual failed and unseen exercises of the same topic/level without exposing keys', async () => {
  const u = await user();
  await db.exec('SET ROLE service_role');
  const s = await start(u);
  expect(s).toMatchObject({
    topicId: topics[0],
    total: 6,
    before: 40,
    level: 'A1',
  });
  expect(JSON.stringify(s)).not.toContain('answer_key');
  expect(JSON.stringify(s)).not.toContain('С I используется');
  const rows = (
    await db.query<{
      baseline_wrong: boolean;
      is_new: boolean;
      exercise_id: string;
    }>('SELECT * FROM public.weak_items WHERE run_id=$1', [s.id])
  ).rows;
  expect(rows.filter((r) => r.baseline_wrong)).toHaveLength(3);
  expect(rows.filter((r) => r.is_new)).toHaveLength(3);
  expect(new Set(rows.map((r) => r.exercise_id)).size).toBe(6);
  await expect(start(u, topics[1])).rejects.toThrow('no eligible');
  expect((await rpc<{ ready: boolean }>('weak_database_status')).ready).toBe(
    true,
  );
});
it('awards 5 XP once per corrected exercise, updates mastery, totals and excludes training from daily lesson quests', async () => {
  const u = await user();
  let s = await start(u);
  const before = await rpc<{ xp: number; daily: { progress: number }[] }>(
    'game_summary',
    [u],
  );
  s = await finish(u, s);
  expect(s).toMatchObject({
    status: 'completed',
    recovered: 3,
    xp: 15,
    before: 40,
    after: 100,
    score: 100,
  });
  const game = await rpc<{ xp: number; daily: { progress: number }[] }>(
    'game_summary',
    [u],
  );
  expect(game.xp - before.xp).toBe(15);
  expect(game.daily.map((v) => v.progress)).toEqual(
    before.daily.map((v) => v.progress),
  );
  expect(
    (await dashboard(u)).topics.find((t) => t.id === topics[0])?.status,
  ).toBe('mastered');
  await expect(start(u, topics[0])).rejects.toThrow('no eligible');
  await weakLesson(db, u, topics[0], 3, 8);
  s = await start(u, topics[0]);
  s = await finish(u, s);
  expect(s.xp).toBe(0);
  expect((await dashboard(u)).history).toHaveLength(2);
  expect((await rpc<{ xp: number }>('game_summary', [u])).xp).toBe(game.xp);
  const ordinary = (
    await db.query<{ id: string }>(
      'SELECT id FROM public.lesson_attempts WHERE user_id=$1 AND lesson_id=$2 ORDER BY completed_at DESC LIMIT 1',
      [u, topics[1]],
    )
  ).rows[0].id;
  await rpc('award_completed_lesson', [ordinary]);
  const daily = await rpc<{ daily: { target: number; progress: number }[] }>(
    'game_summary',
    [u],
  );
  expect(daily.daily.find((q) => q.target === 3)?.progress).toBe(1);
});
it('does not pay for wrong answers, unseen questions or unfinished/abandoned runs', async () => {
  const u = await user();
  let s = await start(u);
  s = (await answer(u, s)).state;
  expect(s.xp).toBe(0);
  const old = s;
  s = await start(u);
  expect((await state(u, old.id)).status).toBe('abandoned');
  while (s.exercise) s = (await answer(u, s, 'b')).state;
  expect(s).toMatchObject({ xp: 0, correct: 0, recovered: 0 });
  expect((await rpc<{ xp: number }>('game_summary', [u])).xp).toBe(0);
});
it('persists and replays exact requests safely, rejects changed answers and out-of-order positions', async () => {
  const u = await user(),
    id = randomUUID();
  const s = await start(u, topics[0], id);
  expect((await start(u, topics[0], id)).id).toBe(id);
  const request = randomUUID(),
    a = await answer(u, s, 'a', request);
  expect(await answer(u, s, 'a', request)).toEqual(a);
  await expect(answer(u, s, 'b', request)).rejects.toThrow('conflict');
  await expect(answer(u, s)).rejects.toThrow('conflict');
  await expect(
    rpc('weak_answer', [u, s.id, randomUUID(), 6, '"a"']),
  ).rejects.toThrow('conflict');
  expect((await state(u, s.id)).answered).toBe(1);
});
it('enforces Premium at every mutation, feature switch, expiry/reactivation, ownership and private RLS', async () => {
  const free = await user(false);
  expect((await dashboard(free)).premium).toBe(false);
  await expect(start(free)).rejects.toThrow('premium required');
  const u = await user(),
    other = await user();
  const s = await start(u);
  await expect(state(other, s.id)).rejects.toThrow('unavailable');
  await expect(answer(other, s)).rejects.toThrow('unavailable');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  expect(await state(u, s.id)).toMatchObject({
    accessible: false,
    exercise: null,
  });
  await expect(answer(u, s)).rejects.toThrow('premium required');
  await rpc('grant_premium_access', [
    u,
    randomUUID(),
    30,
    'Reactivated weak training',
  ]);
  expect((await state(u, s.id)).exercise).not.toBeNull();
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='extra_exercises'",
  );
  await expect(answer(u, s)).rejects.toThrow('premium required');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='extra_exercises'",
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec('SET ROLE authenticated');
  expect(
    (await db.query('SELECT id FROM public.weak_runs WHERE id=$1', [s.id]))
      .rows,
  ).toEqual([]);
  await expect(db.query('SELECT * FROM public.weak_items')).rejects.toThrow(
    'permission',
  );
  await expect(
    db.query("UPDATE public.weak_runs SET status='completed'"),
  ).rejects.toThrow('permission');
  await expect(start(u)).rejects.toThrow('permission');
  await expect(
    db.query(
      'INSERT INTO public.xp_events(user_id,training_exercise_id,weak_run_id,amount) VALUES($1,$2,$3,5)',
      [other, randomUUID(), s.id],
    ),
  ).rejects.toThrow('permission');
});
it('respects difficulty, current content and retired audio and refuses invented exercises', async () => {
  const u = await user();
  await db.query("UPDATE public.lessons SET cefr_level='B2' WHERE id=$1", [
    topics[0],
  ]);
  expect((await dashboard(u)).topics.some((t) => t.id === topics[0])).toBe(
    false,
  );
  await expect(start(u, topics[0])).rejects.toThrow('insufficient');
  await db.query("UPDATE public.lessons SET cefr_level='A1' WHERE id=$1", [
    topics[0],
  ]);
  const s = await start(u);
  await db.query('UPDATE public.lessons SET published=false WHERE id=$1', [
    topics[0],
  ]);
  expect((await state(u, s.id)).exercise).toBeNull();
  await expect(answer(u, s)).rejects.toThrow('unavailable');
  await db.query('UPDATE public.lessons SET published=true WHERE id=$1', [
    topics[0],
  ]);
  await expect(start(u, randomUUID())).rejects.toThrow('no eligible');
});
it('rejects forged entitlement/owner commands and malformed queries', () => {
  expect(() =>
    weakCommand({
      action: 'start',
      topicId: null,
      requestId: randomUUID(),
      premium: true,
    }),
  ).toThrow();
  expect(() => weakQuery(new URLSearchParams('run=x'))).toThrow();
  expect(() => weakQuery(new URLSearchParams('userId=x'))).toThrow();
  expect(() =>
    weakCommand({
      action: 'answer',
      runId: randomUUID(),
      requestId: randomUUID(),
      position: 7,
      answer: 'a',
    }),
  ).toThrow();
});

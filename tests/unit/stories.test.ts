import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stories } from '../../content/stories/originals';
import {
  validateStory,
  storyCommand,
  storyAttemptParam,
  type StoryState,
  type StoryCatalog,
} from '@/lib/stories/types';
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
async function user(premium = false) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Story learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Isolated stories test',
    ]);
  return id;
}
const start = (u: string, slug: string, id: string = randomUUID()) =>
  rpc<StoryState>('story_start', [u, slug, id]);
const state = (u: string, id: string) =>
  rpc<StoryState>('story_state', [u, id]);
const choose = (
  u: string,
  s: StoryState,
  c: string,
  id: string = randomUUID(),
) => rpc<StoryState>('story_choose', [u, s.id, id, s.version, c]);
beforeAll(async () => {
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const f of [
    ...(await readdir('supabase/migrations'))
      .sort()
      .map((f) => 'supabase/migrations/' + f),
    'supabase/stories-seed.sql',
  ]) {
    const sql = await readFile(f, 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      const error = e as Error & { position?: string };
      throw Error(
        f +
          ': ' +
          error.message +
          ' near ' +
          sql.slice(
            Math.max(0, Number(error.position) - 90),
            Number(error.position) + 90,
          ),
      );
    }
  }
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());

it('validates all original content, generated seed and rejects malformed client commands and graphs', async () => {
  for (const s of stories) {
    validateStory(s);
    const saved = (
      await db.query<{ document: unknown }>(
        'SELECT document FROM public.interactive_stories WHERE slug=$1 AND revision=$2',
        [s.slug, s.revision],
      )
    ).rows[0];
    expect(saved.document).toEqual(s.document);
    expect(Object.keys(s.document.nodes).length).toBeGreaterThanOrEqual(15);
  }
  const bad = structuredClone(stories[0]);
  bad.document.nodes.n2.choices[0].next = 'n1';
  expect(() => validateStory(bad)).toThrow('cycle');
  await expect(
    db.query(
      'INSERT INTO public.interactive_stories SELECT $1,2,title,subtitle,description,level,minutes,false,false,$2::jsonb FROM public.interactive_stories LIMIT 1',
      ['broken', JSON.stringify(bad.document)],
    ),
  ).rejects.toThrow('cycle');
  await expect(
    db.query(
      "UPDATE public.interactive_stories SET document=jsonb_set(document,'{start}','\"n2\"') WHERE slug=$1",
      [stories[0].slug],
    ),
  ).rejects.toThrow('immutable');
  expect(() =>
    storyCommand({
      action: 'start',
      slug: 'first-school-day',
      requestId: randomUUID(),
      userId: randomUUID(),
    }),
  ).toThrow();
  expect(() =>
    storyCommand({
      action: 'choose',
      attemptId: randomUUID(),
      requestId: randomUUID(),
      version: -1,
      choiceId: 'a',
    }),
  ).toThrow();
  expect(() => storyAttemptParam(new URLSearchParams('attempt=x'))).toThrow();
  expect(() =>
    storyAttemptParam(new URLSearchParams('premium=true')),
  ).toThrow();
  expect(await rpc('story_database_status')).toMatchObject({
    ready: true,
    published: 5,
  });
});

for (const story of stories)
  it(
    'executes every transition and ending of ' + story.slug,
    async () => {
      const u = await user(true);
      await db.exec('SET ROLE service_role');
      // A shortest valid prefix to each node covers every edge without exponential path expansion.
      const prefixes = new Map<string, string[]>([[story.document.start, []]]),
        queue = [story.document.start];
      while (queue.length) {
        const id = queue.shift()!;
        for (const c of story.document.nodes[id].choices)
          if (!prefixes.has(c.next)) {
            prefixes.set(c.next, [...prefixes.get(id)!, c.id]);
            queue.push(c.next);
          }
      }
      const covered = new Set<string>();
      for (const [nodeId, prefix] of prefixes)
        for (const c of story.document.nodes[nodeId].choices) {
          let s = await start(u, story.slug);
          for (const step of prefix) s = await choose(u, s, step);
          expect(s.nodeId).toBe(nodeId);
          expect(
            s.node?.choices.every(
              (v) => Object.keys(v).sort().join() === 'id,text',
            ),
          ).toBe(true);
          const next = await choose(u, s, c.id);
          expect(next.nodeId).toBe(c.next);
          expect(next.version).toBe(s.version + 1);
          expect(next.transcript.at(-1)?.choice).toBe(c.text);
          expect(next.transcript.at(-1)?.text).toBe(
            story.document.nodes[nodeId].text,
          );
          if (story.document.nodes[nodeId].question)
            expect(next.feedback).toEqual({
              correct: c.correct,
              explanation: story.document.nodes[nodeId].explanation,
            });
          else expect(next.feedback).toBeNull();
          if (story.document.nodes[c.next].ending) {
            expect(next.status).toBe('completed');
            expect(next.reward).toBe(
              story.document.nodes[c.next].ending?.reward,
            );
            expect((await state(u, next.id)).nodeId).toBe(c.next);
          }
          covered.add(nodeId + ':' + c.id);
        }
      expect(covered.size).toBe(
        Object.values(story.document.nodes).reduce(
          (n, v) => n + v.choices.length,
          0,
        ),
      );
      const catalog = await rpc<StoryCatalog>('story_catalog', [u]);
      expect(catalog.endings.filter((e) => e.slug === story.slug)).toHaveLength(
        3,
      );
    },
    60000,
  );

it('persists, rejects stale/out-of-order choices, replays idempotently and cannot farm rewards', async () => {
  const u = await user(),
    request = randomUUID();
  let s = await start(u, stories[0].slug, request);
  expect((await start(u, stories[0].slug, request)).id).toBe(s.id);
  const choiceId = randomUUID(),
    next = await choose(u, s, 'a', choiceId);
  expect(await choose(u, s, 'a', choiceId)).toEqual(next);
  await expect(choose(u, s, 'b', choiceId)).rejects.toThrow('conflict');
  await expect(choose(u, s, 'a')).rejects.toThrow('conflict');
  await expect(choose(u, next, 'invented')).rejects.toThrow('invalid');
  expect((await state(u, next.id)).nodeId).toBe(next.nodeId);
  s = next;
  while (s.status === 'active') s = await choose(u, s, 'a');
  expect(s).toMatchObject({
    status: 'completed',
    newEnding: true,
    correct: 2,
    answered: 2,
  });
  const original = s;
  await expect(choose(u, s, 'a')).rejects.toThrow('conflict');
  s = await start(u, stories[0].slug);
  while (s.status === 'active') s = await choose(u, s, 'a');
  expect(s.newEnding).toBe(false);
  expect((await rpc<StoryCatalog>('story_catalog', [u])).endings).toHaveLength(
    1,
  );
  expect((await state(u, original.id)).status).toBe('completed');
  const active = await start(u, stories[0].slug),
    replacement = await start(u, stories[0].slug);
  expect((await state(u, active.id)).status).toBe('abandoned');
  await expect(choose(u, active, 'a')).rejects.toThrow('conflict');
  expect(replacement.status).toBe('active');
});

it('enforces Free/Premium, expiry and reactivation on server and retains private progress and rewards', async () => {
  const u = await user(),
    other = await user(true);
  const free = await rpc<StoryCatalog>('story_catalog', [u]);
  expect(free.stories.filter((s) => s.accessible)).toHaveLength(1);
  await expect(start(u, stories[1].slug)).rejects.toThrow('premium required');
  await rpc('grant_premium_access', [
    u,
    randomUUID(),
    30,
    'Stories access test',
  ]);
  let s = await start(u, stories[1].slug);
  s = await choose(u, s, 'b');
  await expect(state(other, s.id)).rejects.toThrow('unavailable');
  await expect(choose(other, s, 'a')).rejects.toThrow('unavailable');
  await expect(start(other, stories[1].slug, s.id)).rejects.toThrow('conflict');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  expect(await state(u, s.id)).toMatchObject({
    node: null,
    transcript: [],
    accessible: false,
    version: 1,
  });
  await expect(choose(u, s, 'a')).rejects.toThrow('premium required');
  await rpc('grant_premium_access', [
    u,
    randomUUID(),
    30,
    'Stories reactivation test',
  ]);
  s = await state(u, s.id);
  expect(s).toMatchObject({ accessible: true, nodeId: 'n3', version: 1 });
  await db.exec(
    "UPDATE public.subscription_features SET enabled=false WHERE key='extra_exercises'",
  );
  await expect(choose(u, s, 'a')).rejects.toThrow('premium required');
  await db.exec(
    "UPDATE public.subscription_features SET enabled=true WHERE key='extra_exercises'",
  );
  while (s.status === 'active') s = await choose(u, s, 'a');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  expect((await rpc<StoryCatalog>('story_catalog', [u])).endings).toHaveLength(
    1,
  );
  expect((await state(u, s.id)).status).toBe('completed');
});

it('RLS isolates owners and client roles cannot read paid graphs, edit progress, award badges or call engine RPCs', async () => {
  const u = await user(),
    other = await user(),
    s = await start(u, stories[0].slug);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec('SET ROLE authenticated');
  expect((await db.query('SELECT * FROM public.story_attempts')).rows).toEqual(
    [],
  );
  await expect(
    db.query('SELECT document FROM public.interactive_stories'),
  ).rejects.toThrow('permission');
  await expect(
    rpc('story_start', [u, stories[1].slug, randomUUID()]),
  ).rejects.toThrow('permission');
  await expect(
    db.query(
      "UPDATE public.story_attempts SET status='completed' WHERE id=$1",
      [s.id],
    ),
  ).rejects.toThrow('permission');
  await expect(
    db.query('SELECT * FROM public.story_choice_events'),
  ).rejects.toThrow('permission');
  await expect(
    db.query(
      "INSERT INTO public.story_endings(user_id,story_slug,story_revision,ending_id,title,reward) VALUES($1,$2,1,'n17','fake','fake')",
      [other, stories[0].slug],
    ),
  ).rejects.toThrow('permission');
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [u]);
  await db.exec('SET ROLE authenticated');
  expect((await db.query('SELECT id FROM public.story_attempts')).rows).toEqual(
    [{ id: s.id }],
  );
  await db.exec('RESET ROLE; SET ROLE anon');
  await expect(
    db.query('SELECT title FROM public.interactive_stories'),
  ).rejects.toThrow('permission');
});

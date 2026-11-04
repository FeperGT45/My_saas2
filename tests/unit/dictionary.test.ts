import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  dictionaryCommand,
  dictionaryQuery,
  type DictionaryData,
  type DictionaryQueue,
} from '@/lib/learning/dictionary';
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
    "INSERT INTO public.users(id,display_name) VALUES($1,'Dictionary learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Dictionary isolated test',
    ]);
  return id;
}
const read = (
  id: string,
  source = 'own',
  collection: string | null = null,
  search = '',
) =>
  rpc<DictionaryData>('dictionary_read', [id, source, collection, search, 0]);
const mutate = (
  id: string,
  action: string,
  data: unknown,
  request = randomUUID(),
) =>
  rpc<{ id: string }>('dictionary_mutate', [
    id,
    request,
    action,
    JSON.stringify(data),
  ]);
const word = (front = 'travel', collectionId: string | null = null) => ({
  id: null,
  version: 0,
  front,
  back: 'путешествие',
  example: 'I travel every summer.',
  collectionId,
});
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
it('creates, edits, searches and filters words and collections with optimistic versions and idempotency', async () => {
  const id = await user();
  await db.exec('SET ROLE service_role');
  const c = await mutate(id, 'save_collection', {
    id: null,
    version: 0,
    title: 'Путешествия',
  });
  const request = randomUUID(),
    payload = word('travel', c.id),
    w = await mutate(id, 'save_word', payload, request);
  expect(await mutate(id, 'save_word', payload, request)).toEqual(w);
  await expect(
    mutate(id, 'save_word', { ...payload, front: 'other' }, request),
  ).rejects.toThrow('dictionary conflict');
  expect((await read(id, 'own', c.id, 'trav')).total).toBe(1);
  expect((await read(id, 'own', null, 'пут')).total).toBe(1);
  expect((await read(id, 'own', null, 'summer')).total).toBe(1);
  expect((await read(id, 'own', null, "' OR true --")).total).toBe(0);
  await mutate(id, 'save_collection', {
    id: c.id,
    version: 0,
    title: 'Travel',
  });
  expect((await read(id)).collections[0].title).toBe('Travel');
  await mutate(id, 'save_word', {
    ...payload,
    id: w.id,
    version: 0,
    front: 'journey',
  });
  await expect(
    mutate(id, 'save_word', { ...payload, id: w.id, version: 0 }),
  ).rejects.toThrow('dictionary conflict');
  expect((await read(id)).words[0].front).toBe('journey');
  await mutate(id, 'delete_collection', { id: c.id, version: 1 });
  const r = await read(id);
  expect(r.words).toHaveLength(1);
  expect(r.words[0].collectionId).toBeNull();
  await mutate(id, 'delete_word', { id: w.id, version: r.words[0].version });
  expect((await read(id)).total).toBe(0);
  expect((await rpc<{ total: number }>('word_review_queue', [id])).total).toBe(
    0,
  );
});
it('shares SM-2 scheduling with basic reviews, enforces due/version/rating, and never counts a retry twice', async () => {
  const id = await user();
  await mutate(id, 'save_word', word());
  let q = await rpc<DictionaryQueue>('dictionary_train', [id, null]);
  const card = q.cards[0],
    request = randomUUID();
  const first = await rpc('dictionary_answer', [
    id,
    card.id,
    request,
    card.key,
    card.version,
    4,
  ]);
  expect(first).toMatchObject({ intervalDays: 1 });
  expect(
    await rpc('dictionary_answer', [
      id,
      card.id,
      request,
      card.key,
      card.version,
      4,
    ]),
  ).toEqual(first);
  await expect(
    rpc('dictionary_answer', [
      id,
      card.id,
      randomUUID(),
      card.key,
      card.version,
      4,
    ]),
  ).rejects.toThrow('review conflict');
  await expect(
    rpc('dictionary_answer', [
      id,
      card.id,
      randomUUID(),
      card.key,
      card.version,
      5,
    ]),
  ).rejects.toThrow('unavailable card');
  for (const interval of [6, 15]) {
    await db.query(
      "UPDATE public.word_reviews SET due_at=now()-interval '1 second' WHERE user_id=$1",
      [id],
    );
    q = await rpc('dictionary_train', [id, null]);
    const c = q.cards[0];
    expect(
      await rpc('word_review_answer', [id, randomUUID(), c.key, c.version, 4]),
    ).toMatchObject({ intervalDays: interval });
  }
  await db.query(
    "UPDATE public.word_reviews SET due_at=now()-interval '1 second' WHERE user_id=$1",
    [id],
  );
  q = await rpc('dictionary_train', [id, null]);
  expect(
    await rpc('dictionary_answer', [
      id,
      q.cards[0].id,
      randomUUID(),
      card.key,
      q.cards[0].version,
      0,
    ]),
  ).toMatchObject({ intervalDays: 1 });
  const r = await read(id);
  expect(r.statistics).toMatchObject({
    known: 3,
    repeats: 1,
    established: 0,
    reviewed: 1,
  });
});
it('retains words on expiry, permits basic repetition and owner deletion, and closes advanced functions', async () => {
  const id = await user();
  const w = await mutate(id, 'save_word', word());
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [id],
  );
  const r = await read(id);
  expect(r.words).toHaveLength(1);
  expect(r.canManage).toBe(false);
  expect(r.statistics).toBeNull();
  await expect(mutate(id, 'save_word', word('new'))).rejects.toThrow(
    'premium required',
  );
  await expect(rpc('dictionary_train', [id, null])).rejects.toThrow(
    'premium required',
  );
  const q = await rpc<{ cards: { key: string; version: number }[] }>(
    'word_review_queue',
    [id],
  );
  expect(q.cards).toHaveLength(1);
  expect(
    await rpc('word_review_answer', [
      id,
      randomUUID(),
      q.cards[0].key,
      q.cards[0].version,
      4,
    ]),
  ).toMatchObject({ intervalDays: 1 });
  await rpc('grant_premium_access', [
    id,
    randomUUID(),
    30,
    'Dictionary reactivation',
  ]);
  expect((await read(id)).statistics?.known).toBe(1);
  await mutate(id, 'delete_word', { id: w.id, version: 0 });
  expect((await read(id)).total).toBe(0);
});
it('isolates data in RPCs, composite ownership foreign keys and read-only owner RLS', async () => {
  const a = await user(),
    b = await user();
  const c = await mutate(a, 'save_collection', {
      id: null,
      version: 0,
      title: 'Private',
    }),
    w = await mutate(a, 'save_word', word('secret', c.id));
  expect((await read(b)).words).toEqual([]);
  await expect(read(b, 'own', c.id)).rejects.toThrow('unavailable');
  await expect(mutate(b, 'save_word', word('steal', c.id))).rejects.toThrow(
    'unavailable',
  );
  await expect(
    mutate(b, 'delete_word', { id: w.id, version: 0 }),
  ).rejects.toThrow('conflict');
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [b]);
  expect(
    (await db.query('SELECT id,front FROM public.dictionary_words')).rows,
  ).toEqual([]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [a]);
  expect(
    (await db.query('SELECT id,front FROM public.dictionary_words')).rows,
  ).toHaveLength(1);
  await expect(
    db.query("UPDATE public.dictionary_words SET back='hacked'"),
  ).rejects.toThrow('permission denied');
  await expect(read(a)).rejects.toThrow('permission denied');
  await db.exec('RESET ROLE;SET ROLE anon');
  await expect(
    db.query('SELECT id FROM public.dictionary_words'),
  ).rejects.toThrow('permission denied');
});
it('imports only own completed English lessons, preserves shared review progress and avoids duplicates', async () => {
  const id = await user(),
    other = await user();
  const lesson = '40000000-0000-0000-0000-000000000002';
  await db.query(
    'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,80)',
    [id, lesson],
  );
  await db.query(
    `UPDATE public.lessons SET lexicon='[{"en":"cat","ru":"кот","example":"A cat sleeps."},{"en":"dog","ru":"собака"}]'::jsonb WHERE id=$1`,
    [lesson],
  );
  const source = await read(id, 'lessons');
  expect(source.words.length).toBeGreaterThan(0);
  expect((await read(other, 'lessons')).total).toBe(0);
  const q = await rpc<{ cards: { key: string; version: number }[] }>(
    'word_review_queue',
    [id],
  );
  const card = q.cards[0];
  await rpc('word_review_answer', [
    id,
    randomUUID(),
    card.key,
    card.version,
    4,
  ]);
  await mutate(id, 'import', { key: card.key, collectionId: null });
  await mutate(id, 'import', { key: card.key, collectionId: null });
  expect((await read(id)).total).toBe(1);
  expect((await read(id)).statistics?.known).toBe(1);
  await expect(
    mutate(other, 'import', { key: card.key, collectionId: null }),
  ).rejects.toThrow('unavailable word');
  const imported = (await read(id)).words[0];
  await mutate(id, 'delete_word', {
    id: imported.id,
    version: imported.version,
  });
  expect((await rpc<{ total: number }>('word_review_queue', [id])).total).toBe(
    source.total,
  );
});
it('archives audio lessons without deleting historical progress and blocks pending audio attempts', async () => {
  expect(await rpc('dictionary_database_status')).toMatchObject({
    ready: true,
    publishedAudio: 0,
  });
  const audio = '40000000-0000-0000-0000-000000000002';
  expect(
    (
      await db.query<{ published: boolean; retired_audio: boolean }>(
        'SELECT published,retired_audio FROM public.lessons WHERE id=$1',
        [audio],
      )
    ).rows[0],
  ).toEqual({ published: false, retired_audio: true });
  await db.query(
    'UPDATE public.lessons SET published=true,retired_audio=false WHERE id=$1',
    [audio],
  );
  expect(
    (
      await db.query<{ published: boolean }>(
        'SELECT published FROM public.lessons WHERE id=$1',
        [audio],
      )
    ).rows[0].published,
  ).toBe(false);
  const id = await user(),
    started = randomUUID();
  await db.query(
    'INSERT INTO public.lesson_attempts(id,user_id,lesson_id) VALUES($1,$2,$3)',
    [started, id, audio],
  );
  await expect(rpc('lesson_state', [id, started])).rejects.toThrow(
    'audio lesson unavailable',
  );
  const archived = (
    await db.query('SELECT id FROM public.lessons WHERE retired_audio')
  ).rows;
  expect(archived.length).toBeGreaterThan(0);
});
it('rejects client identity, malformed commands and missing manual translations', () => {
  for (const bad of [
    { action: 'train', collectionId: null, userId: randomUUID() },
    {
      action: 'save_word',
      requestId: randomUUID(),
      data: { ...word(), back: '' },
    },
    {
      action: 'answer',
      id: randomUUID(),
      requestId: randomUUID(),
      key: '0'.repeat(32),
      version: 0,
      rating: 5,
    },
  ])
    expect(() => dictionaryCommand(bad)).toThrow();
  expect(() => dictionaryQuery(new URLSearchParams('userId=other'))).toThrow();
  expect(() =>
    dictionaryQuery(new URLSearchParams('source=own&source=lessons')),
  ).toThrow();
  expect(dictionaryQuery(new URLSearchParams('search=travel'))).toMatchObject({
    search: 'travel',
  });
});

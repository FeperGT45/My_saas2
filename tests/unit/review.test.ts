import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
const user = randomUUID(),
  other = randomUUID();
async function rpc(name: string, args: unknown[]) {
  return (
    await db.query<{ v: unknown }>(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`,
      args,
    )
  ).rows[0].v;
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
  await db.query('insert into auth.users values($1),($2)', [user, other]);
  await db.query(
    "insert into public.users(id,display_name) values($1,'Review learner'),($2,'Other')",
    [user, other],
  );
}, 30000);
afterAll(() => db.close());
it('does not add words without a passed lesson', async () => {
  expect(await rpc('word_review_queue', [user])).toMatchObject({
    total: 0,
    due: 0,
    cards: [],
  });
});
it('imports unique snapshots from passed lesson lexicon and preserves scheduling on sync', async () => {
  const lesson = (
    await db.query<{ id: string }>('select id from public.lessons limit 1')
  ).rows[0].id;
  await db.query(
    `update public.lessons set lexicon='[{"en":"apple","ru":"яблоко"},{"en":"apple","ru":"яблоко"}]' where id=$1`,
    [lesson],
  );
  await db.query(
    'insert into public.user_progress(user_id,lesson_id,best_score) values($1,$2,60)',
    [user, lesson],
  );
  expect(await rpc('word_review_queue', [user])).toMatchObject({
    total: 1,
    due: 1,
  });
  expect(await rpc('word_review_queue', [user])).toMatchObject({
    total: 1,
    due: 1,
  });
  expect(await rpc('word_review_queue', [other])).toMatchObject({ total: 0 });
});
it('applies SM-2 1/6/15-day intervals, rejects premature and stale answers, and replays requests', async () => {
  const card = (
    await db.query<{ word_key: string }>(
      'select word_key from public.word_reviews where user_id=$1',
      [user],
    )
  ).rows[0];
  for (const [version, days] of [
    [0, 1],
    [1, 6],
    [2, 16],
  ]) {
    if (version)
      await db.query(
        "update public.word_reviews set due_at=now()-interval '1 second' where user_id=$1",
        [user],
      );
    const req = randomUUID();
    const args = [user, req, card.word_key, version, 5];
    const result = await rpc('word_review_answer', args);
    expect(result).toMatchObject({ intervalDays: days });
    expect(await rpc('word_review_answer', args)).toEqual(result);
    await expect(
      rpc('word_review_answer', [user, req, card.word_key, version, 0]),
    ).rejects.toThrow('conflict');
    await expect(
      rpc('word_review_answer', [
        user,
        randomUUID(),
        card.word_key,
        version + 1,
        5,
      ]),
    ).rejects.toThrow('conflict');
  }
  expect(
    (
      await db.query(
        'select successes from public.word_reviews where user_id=$1',
        [user],
      )
    ).rows[0],
  ).toMatchObject({ successes: 3 });
});
it('resets repetitions after a lapse, tracks errors and leaves XP unchanged', async () => {
  await db.query(
    "update public.word_reviews set due_at=now()-interval '1 second' where user_id=$1",
    [user],
  );
  const row = (
    await db.query<{ word_key: string; version: number }>(
      'select word_key,version from public.word_reviews where user_id=$1',
      [user],
    )
  ).rows[0];
  const xp = (await db.query('select count(*) n from public.xp_events')).rows;
  expect(
    await rpc('word_review_answer', [
      user,
      randomUUID(),
      row.word_key,
      row.version,
      0,
    ]),
  ).toMatchObject({ intervalDays: 1 });
  expect(
    (
      await db.query(
        'select repetitions,errors,ease from public.word_reviews where user_id=$1',
        [user],
      )
    ).rows[0],
  ).toMatchObject({ repetitions: 0, errors: 1 });
  expect(
    (await db.query('select count(*) n from public.xp_events')).rows,
  ).toEqual(xp);
});
it('rejects another user card and invalid ratings', async () => {
  const row = (
    await db.query<{ word_key: string }>(
      'select word_key from public.word_reviews where user_id=$1',
      [user],
    )
  ).rows[0];
  await expect(
    rpc('word_review_answer', [other, randomUUID(), row.word_key, 0, 5]),
  ).rejects.toThrow('unavailable');
  await expect(
    rpc('word_review_answer', [user, randomUUID(), row.word_key, 0, 6]),
  ).rejects.toThrow('invalid');
});
it('denies client roles direct access to state and scheduling RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    try {
      await expect(
        db.query('select * from public.word_reviews'),
      ).rejects.toThrow('permission denied');
      await expect(rpc('word_review_queue', [user])).rejects.toThrow(
        'permission denied',
      );
    } finally {
      await db.exec('reset role');
    }
  }
});

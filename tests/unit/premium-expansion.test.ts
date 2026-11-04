import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  defaultAppearance,
  appearanceValid,
  themes,
} from '@/lib/premium/appearance';
import type { AppearanceData } from '@/lib/premium/appearance';
import type { ExtendedData } from '@/lib/placement/extended';
const db = new PGlite();
async function rpc<T = unknown>(f: string, a: unknown[] = []): Promise<T> {
  return (
    await db.query<{ v: T }>(
      `SELECT public.${f}(${a.map((_, i) => '$' + (i + 1)).join(',')}) AS v`,
      a,
    )
  ).rows[0].v;
}
async function user(premium = true) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Appearance learner')",
    [id],
  );
  if (premium)
    await rpc('grant_premium_access', [
      id,
      randomUUID(),
      30,
      'Premium expansion isolated',
    ]);
  return id;
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
  await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
}, 60000);
afterEach(() => db.exec('RESET ROLE'));
afterAll(() => db.close());
it('preserves free themes, protects Premium settings, persists previews and falls back after expiry without deleting choices', async () => {
  const free = await user(false);
  expect(Object.values(themes).filter((t) => !t.premium)).toHaveLength(3);
  expect(Object.values(themes).filter((t) => t.premium)).toHaveLength(5);
  expect(appearanceValid({ ...defaultAppearance, theme: 'unknown' })).toBe(
    false,
  );
  await db.exec('SET ROLE service_role');
  let d = await rpc<AppearanceData>('appearance_save', [
    free,
    JSON.stringify({ ...defaultAppearance, theme: 'slate' }),
    0,
  ]);
  expect(d.effective.theme).toBe('slate');
  await expect(
    rpc('appearance_save', [
      free,
      JSON.stringify({ ...defaultAppearance, theme: 'sakura' }),
      d.version,
    ]),
  ).rejects.toThrow('premium required');
  await db.exec('RESET ROLE');
  const u = await user();
  const paid = {
    theme: 'sakura',
    frame: 'orbit',
    badge: 'star',
    effect: 'spark',
    decoration: 'dots',
  };
  d = await rpc('appearance_save', [u, JSON.stringify(paid), 0]);
  expect(d.saved).toEqual(paid);
  await expect(
    rpc('appearance_save', [u, JSON.stringify(paid), 0]),
  ).rejects.toThrow('conflict');
  await db.query(
    "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
    [u],
  );
  d = await rpc('appearance_read', [u]);
  expect(d.saved).toEqual(paid);
  expect(d.effective).toEqual(defaultAppearance);
  await rpc('grant_premium_access', [
    u,
    randomUUID(),
    30,
    'Restore appearance',
  ]);
  expect((await rpc<AppearanceData>('appearance_read', [u])).effective).toEqual(
    paid,
  );
});
async function complete(u: string, correct: boolean) {
  let d = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  const diffs: number[] = [];
  while (d.question) {
    const q = d.question;
    const raw = (
      await db.query<{ current: { level: string; correct_option: string } }>(
        'SELECT current FROM public.extended_attempts WHERE id=$1',
        [d.id],
      )
    ).rows[0].current;
    diffs.push(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(raw.level));
    const option = correct
        ? raw.correct_option
        : q.options.find((o) => o.id !== raw.correct_option)!.id,
      request = randomUUID();
    d = await rpc('extended_answer', [u, d.id, request, q.id, option]);
    expect(
      await rpc('extended_answer', [u, d.id, request, q.id, option]),
    ).toEqual(d);
  }
  return { d, diffs };
}
it('adapts difficulty up/down, saves 36 unique balanced questions and exposes review only at completion', async () => {
  const u = await user();
  await db.exec('SET ROLE service_role');
  const first = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  expect(first.review).toEqual([]);
  expect(JSON.stringify(first.question)).not.toContain('correct_option');
  const { d, diffs } = await complete(u, true);
  expect(d.answered).toBe(36);
  expect(d.review).toHaveLength(36);
  expect(new Set(d.review.map((q) => q.prompt)).size).toBe(36);
  expect(Object.values(d.result!.categories).map((s) => s.answered)).toEqual([
    12, 12, 12,
  ]);
  expect(diffs.at(-1)).toBeGreaterThan(diffs[0]);
  expect(d.result!.level).toMatch(/B2|C1|C2/);
  expect((await rpc<ExtendedData>('extended_read', [u, d.id])).result).toEqual(
    d.result,
  );
  const down = await complete(u, false);
  expect(down.d.result!.level).toBe('A1');
  expect(down.d.history).toHaveLength(2);
  expect(down.diffs.filter((n) => n === 0).length).toBeGreaterThan(0);
  expect(down.diffs.every((n) => n <= 1)).toBe(true);
  expect(
    (await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [u]))
      .rows,
  ).toEqual([]);
}, 30000);
it('rejects Free, чужие attempts, out-of-order answers and direct client mutation', async () => {
  const free = await user(false);
  await expect(rpc('extended_start', [free, randomUUID()])).rejects.toThrow(
    'premium required',
  );
  const u = await user(),
    other = await user(),
    d = await rpc<ExtendedData>('extended_start', [u, randomUUID()]);
  await expect(rpc('extended_read', [other, d.id])).rejects.toThrow(
    'unavailable',
  );
  await expect(
    rpc('extended_answer', [u, d.id, randomUUID(), randomUUID(), 'a']),
  ).rejects.toThrow('conflict');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec('SET ROLE authenticated');
  expect(
    (
      await db.query(
        'SELECT * FROM public.appearance_settings WHERE user_id=$1',
        [u],
      )
    ).rows,
  ).toEqual([]);
  await expect(
    rpc('appearance_save', [u, JSON.stringify(defaultAppearance), 0]),
  ).rejects.toThrow('permission');
  await expect(
    db.query('SELECT * FROM public.extended_answers'),
  ).rejects.toThrow('permission');
  await expect(rpc('extended_start', [u, randomUUID()])).rejects.toThrow(
    'permission',
  );
});
it('preserves public leaderboard privacy while returning only effective cosmetics', async () => {
  const u = await user();
  await rpc('appearance_save', [
    u,
    JSON.stringify({ ...defaultAppearance, frame: 'pulse', badge: 'leaf' }),
    0,
  ]);
  await db.query(
    "UPDATE public.users SET leaderboard_visible=true,public_alias='Learner' WHERE id=$1",
    [u],
  );
  const a = randomUUID(),
    lesson = '40000000-0000-0000-0000-000000000001';
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,completed_at,score) VALUES($1,$2,$3,'completed',now(),100)",
    [a, u, lesson],
  );
  await db.query(
    'INSERT INTO public.xp_events(user_id,lesson_id,attempt_id,amount) VALUES($1,$2,$3,10)',
    [u, lesson, a],
  );
  const s = await rpc<{ entries: { appearance: { frame: string } }[] }>(
    'social_summary',
    [u, 'global', 0],
  );
  expect(s.entries[0].appearance.frame).toBe('pulse');
  expect(JSON.stringify(s.entries)).not.toContain(u);
  expect(JSON.stringify(s.entries)).not.toContain('telegram');
});

import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const db = new PGlite();
const user = 'a0000000-0000-0000-0000-000000000001';
const other = 'a0000000-0000-0000-0000-000000000002';
const lesson = '40000000-0000-0000-0000-000000000001';
const attempt = '60000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`);
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [user, other]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'A'),($2,'B')",
    [user, other],
  );
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,completed_at) VALUES($1,$2,$3,'completed',100,now())",
    [attempt, user, lesson],
  );
}, 30000);
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db.close();
});
describe('PostgreSQL security regressions', () => {
  it('replayed completion cannot mint XP or coins twice', async () => {
    await db.query('SELECT public.award_completed_lesson($1)', [attempt]);
    const before = (
      await db.query('SELECT public.game_summary($1) AS data', [user])
    ).rows[0];
    await db.query('SELECT public.award_completed_lesson($1)', [attempt]);
    expect(
      (await db.query('SELECT public.game_summary($1) AS data', [user]))
        .rows[0],
    ).toEqual(before);
    expect(
      (
        await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [
          user,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('a valid user cannot access another user’s lesson attempt', async () => {
    await db.exec('SET ROLE service_role');
    await expect(
      db.query('SELECT public.lesson_state($1,$2)', [other, attempt]),
    ).rejects.toThrow();
    await expect(
      db.query('SELECT public.submit_lesson_answer($1,$2,1,$3::jsonb)', [
        other,
        attempt,
        JSON.stringify('forged'),
      ]),
    ).rejects.toThrow();
  });
  it('search and authored text remain literal values, including SQL and HTML metacharacters', async () => {
    await db.exec('SET ROLE service_role');
    const attack = "'); DROP TABLE public.users; -- <script>alert(1)</script>";
    await db.query("SELECT public.admin_read('users',NULL,$1,0)", [attack]);
    const course = 'b0000000-0000-0000-0000-000000000001';
    const language = (
      await db.query<{ id: string }>('SELECT id FROM public.languages LIMIT 1')
    ).rows[0].id;
    const data = {
      id: course,
      version: 0,
      language_id: language,
      title: attack,
      slug: 'audit-course',
      level: 'A1',
      published: false,
      access_tier: 'free',
    };
    await db.query(
      "SELECT public.admin_save_content($1,'b0000000-0000-0000-0000-000000000002','course',$2::jsonb,$3)",
      [user, JSON.stringify(data), `SAVE:course:${course}`],
    );
    expect(
      (await db.query('SELECT title FROM public.courses WHERE id=$1', [course]))
        .rows[0],
    ).toEqual({ title: attack });
    expect((await db.query('SELECT id FROM public.users')).rows).toHaveLength(
      2,
    );
  });
  it.each(['anon', 'authenticated'])(
    '%s cannot mutate rewards/subscriptions or read answers/admin data',
    async (role) => {
      await db.exec(`SET ROLE ${role}`);
      for (const query of [
        'UPDATE public.xp_events SET amount=999',
        "UPDATE public.subscriptions SET status='active'",
        'SELECT answer_key FROM public.exercises',
        'SELECT * FROM public.admin_audit_events',
        "SELECT public.admin_read('users',NULL,'',0)",
      ])
        await expect(db.exec(query)).rejects.toThrow();
    },
  );
});

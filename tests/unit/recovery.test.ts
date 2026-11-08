import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadLibrary, libraryPayload } from '../../scripts/content/library';

it('restores an isolated database with completed progress, XP, private keys, RLS and all FK indexes intact', async () => {
  let db: PGlite | undefined = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
    );
    for (const f of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
    await db.exec(await readFile('supabase/seed.sql', 'utf8'));
    const payload = libraryPayload(await loadLibrary());
    await db.query('SELECT public.import_curriculum_package($1::jsonb)', [
      JSON.stringify(payload),
    ]);
    const user = randomUUID(),
      attempt = randomUUID(),
      lesson = payload.lessons[0];
    await db.query('INSERT INTO auth.users VALUES($1)', [user]);
    await db.query(
      "INSERT INTO public.users(id,display_name) VALUES($1,'Isolated recovery fixture')",
      [user],
    );
    await db.query('SELECT public.start_lesson($1,$2,$3)', [
      user,
      lesson.id,
      attempt,
    ]);
    for (const e of payload.exercises.filter((e) => e.lesson_id === lesson.id))
      await db.query('SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb)', [
        user,
        attempt,
        e.position,
        JSON.stringify(e.reference_answer),
      ]);
    const tables = [
      'user_progress',
      'xp_events',
      'lesson_attempts',
      'exercise_submissions',
      'curriculum_packages',
    ];
    const before = Object.fromEntries(
      await Promise.all(
        tables.map(async (t) => [
          t,
          (
            await db!.query(
              `SELECT * FROM public.${t} ORDER BY to_jsonb(${t})::text`,
            )
          ).rows,
        ]),
      ),
    );
    expect(before.user_progress).toHaveLength(1);
    expect(before.xp_events).toHaveLength(1);
    const backup = await db.dumpDataDir('gzip');
    expect(backup.size).toBeGreaterThan(1000);
    await db.close();
    db = undefined;
    db = new PGlite({ loadDataDir: backup });
    await db.waitReady;
    for (const table of tables)
      expect(
        (
          await db.query(
            `SELECT * FROM public.${table} ORDER BY to_jsonb(${table})::text`,
          )
        ).rows,
      ).toEqual(before[table]);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM public.lessons WHERE published AND (SELECT count(*) FROM public.exercises WHERE lesson_id=lessons.id)>=8',
        )
      ).rows[0].n,
    ).toBe(300);
    const missing = await db.query(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND (i.indpred IS NULL OR pg_get_expr(i.indpred,i.indrelid)='('||(SELECT quote_ident(attname) FROM pg_attribute WHERE attrelid=c.conrelid AND attnum=c.conkey[1])||' IS NOT NULL)') AND (SELECT array_agg(k ORDER BY ord) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY a(k,ord) WHERE ord<=cardinality(c.conkey))=c.conkey)`,
    );
    expect(missing.rows).toEqual([]);
    await db.exec('SET ROLE anon');
    await expect(
      db.query('SELECT public.import_curriculum_package($1::jsonb)', [
        JSON.stringify(payload),
      ]),
    ).rejects.toThrow();
    await expect(
      db.query('SELECT answer_key FROM public.exercises'),
    ).rejects.toThrow();
    await db.exec('RESET ROLE');
  } finally {
    if (db && !db.closed) await db.close();
  }
}, 60000);

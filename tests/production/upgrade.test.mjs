import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { upgradeSql } from '../../scripts/prepare-upgrade.mjs';

test('manual upgrade preserves content, records history and safely repeats on 010', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const files = (await readdir('supabase/migrations')).sort();
    for (const file of files.filter(
      (file) => file.slice(0, 12) <= '202611020008',
    ))
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    await db.exec(await readFile('supabase/seed.sql', 'utf8'));
    const before = (
      await db.query('SELECT id,title FROM public.lessons ORDER BY id')
    ).rows;
    const sql = await upgradeSql();
    assert.equal(
      sql,
      await readFile('supabase/manual-upgrade-008-010.sql', 'utf8'),
    );
    for (let run = 0; run < 2; run++) {
      await db.exec(sql);
      const status = (
        await db.query('SELECT public.voklumi_database_status() AS data')
      ).rows[0].data;
      assert.equal(status.schemaVersion, '202611020010');
      assert.equal(status.ready, true);
      assert.equal(status.tables.length, 22);
      assert.deepEqual(
        (await db.query('SELECT id,title FROM public.lessons ORDER BY id'))
          .rows,
        before,
      );
      assert.equal(
        (await db.query('SELECT * FROM supabase_migrations.schema_migrations'))
          .rows.length,
        2,
      );
    }
  } finally {
    await db.close();
  }
});

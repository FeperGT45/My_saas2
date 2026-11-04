import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(
    await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
  );
  const actor = randomUUID(),
    other = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [actor, other]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Admin'),($2,'Student')",
    [actor, other],
  );
  const save = async (
    entity,
    data,
    request = randomUUID(),
    confirmation = `SAVE:${entity}:${data.id}`,
    by = actor,
  ) =>
    (
      await db.query(
        'SELECT public.admin_save_content($1,$2,$3,$4::jsonb,$5) AS data',
        [by, request, entity, JSON.stringify(data), confirmation],
      )
    ).rows[0].data;
  const read = async (view, parent = null, offset = 0, search = '') =>
    (
      await db.query('SELECT public.admin_read($1,$2,$3,$4) AS data', [
        view,
        parent,
        search,
        offset,
      ])
    ).rows[0].data;
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(read('users'));
    await assert.rejects(db.exec('SELECT * FROM public.admin_audit_events'));
    await assert.rejects(save('course', { id: randomUUID(), version: 0 }));
    await assert.rejects(
      db.exec("UPDATE public.users SET display_name='Admin'"),
    );
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  const language = (await read('languages')).items[0].id;
  const course = {
    id: randomUUID(),
    version: 0,
    language_id: language,
    slug: 'admin-course',
    title: 'Admin Course',
    level: 'A1',
    published: false,
    access_tier: 'free',
  };
  const key = randomUUID();
  await assert.rejects(save('course', course, key, ''), /confirmation/);
  assert.equal((await save('course', course, key)).version, 1);
  assert.deepEqual(await save('course', course, key), {
    id: course.id,
    version: 1,
    entity: 'course',
  });
  await assert.rejects(
    save('course', { ...course, title: 'Changed' }, key),
    /request conflict/,
  );
  await assert.rejects(
    save('course', course, key, `SAVE:course:${course.id}`, other),
    /request conflict/,
  );
  await assert.rejects(save('course', course), /version conflict/);
  await assert.rejects(
    save('course', { ...course, version: 1, published: true }),
    /empty publication/,
  );
  const unit = {
    id: randomUUID(),
    version: 0,
    course_id: course.id,
    title: 'Section',
    position: 1,
  };
  await save('unit', unit);
  const lesson = {
    id: randomUUID(),
    version: 0,
    unit_id: unit.id,
    title: 'Lesson',
    position: 1,
    xp_reward: 20,
    published: false,
    free_preview: false,
  };
  await save('lesson', lesson);
  const seed = (await read('exercises', '40000000-0000-0000-0000-000000000002'))
    .items;
  for (const [i, row] of seed.entries()) {
    const exercise = {
      id: randomUUID(),
      version: 0,
      lesson_id: lesson.id,
      position: i + 1,
      kind: row.kind,
      prompt: row.prompt,
      explanation: row.explanation,
      premium_only: false,
      public_payload: row.public_payload,
      answer_key: row.answer_key,
    };
    assert.equal((await save('exercise', exercise)).version, 1);
    if (i === 0) {
      await assert.rejects(
        save('exercise', {
          ...exercise,
          version: 1,
          answer_key: { value: 'wrong-id' },
        }),
        /invalid exercise/,
      );
      assert.equal(
        (await read('exercises', lesson.id)).items[0].admin_version,
        1,
      );
    }
  }
  await save('lesson', { ...lesson, version: 1, published: true });
  await save('course', { ...course, version: 1, published: true });
  const start = randomUUID();
  await db.query('SELECT public.start_lesson($1,$2,$3)', [
    other,
    lesson.id,
    start,
  ]);
  await save('lesson', {
    ...lesson,
    version: 2,
    title: 'Revised lesson',
    published: true,
    xp_reward: 50,
  });
  assert.equal(
    (
      await db.query(
        'SELECT xp_reward_snapshot FROM public.lesson_attempts WHERE id=$1',
        [start],
      )
    ).rows[0].xp_reward_snapshot,
    20,
  );
  assert.equal((await read('lessons', unit.id)).items[0].attempts, 1);
  assert.equal((await read('activity')).items[0].display_name, 'Student');
  assert.equal((await read('overview')).summary.users, 2);
  const userReport = JSON.stringify(await read('users'));
  for (const privateName of [
    'telegram_id',
    'token_hash',
    'init_hash',
    'telegram_username',
    'referral_code',
  ])
    assert.ok(!userReport.includes(privateName));
  assert.equal((await read('users', null, 0, 'not found')).total, 0);
  assert.equal((await read('users', null, 25)).items.length, 0);
  // A duplicate position rolls back without leaving an audit entry.
  const auditBefore = (await read('audit')).total;
  await assert.rejects(save('unit', { ...unit, id: randomUUID(), version: 0 }));
  assert.equal((await read('audit')).total, auditBefore);
  await save('course', {
    ...course,
    version: 2,
    published: false,
    access_tier: 'premium',
  });
  await db.exec('RESET ROLE;SET ROLE anon');
  assert.equal(
    (await db.query('SELECT id FROM public.courses WHERE id=$1', [course.id]))
      .rows.length,
    0,
  );
  await assert.rejects(db.exec('SELECT answer_key FROM public.exercises'));
  await db.exec('RESET ROLE;SET ROLE service_role');
  // Subscription reports do not reveal payment identifiers.
  await db.query(
    "INSERT INTO public.subscriptions(user_id,plan,status,starts_at,ends_at,provider_reference) VALUES($1,'plus','active',now()-interval '31 days',now()-interval '1 day','PRIVATE_CHARGE')",
    [other],
  );
  const subs = await read('subscriptions');
  assert.equal(subs.items[0].status, 'expired');
  assert.ok(!JSON.stringify(subs).includes('PRIVATE_CHARGE'));
  assert.equal((await read('courses', null, 0, 'Admin Course')).total, 1);
  await assert.rejects(read('users', null, -1));
  console.log(
    'PASS: admin RPC ACL/RLS, course/unit/lesson CRUD, six exercise formats, confirmation, optimistic locking, idempotency, audit/rollback, draft visibility, immutable attempts, statistics and private-data minimization.',
  );
} finally {
  await db.close();
}

import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { contentId } from './content/catalog.mjs';
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
  const users = ['buyer', 'other', 'early-refund'].map((k) =>
    contentId(`pay/${k}`),
  );
  for (const [i, id] of users.entries()) {
    await db.query('INSERT INTO auth.users VALUES($1)', [id]);
    await db.query(
      'INSERT INTO public.users(id,display_name,telegram_id) VALUES($1,$2,$3)',
      [id, `Buyer ${i}`, 100 + i],
    );
  }
  const order = async (i = 0, key = 'one') =>
    (
      await db.query('SELECT public.create_star_order($1,$2,99) AS data', [
        users[i],
        contentId(`order/${i}/${key}`),
      ])
    ).rows[0].data;
  const checkout = async (
    o,
    tg = 100,
    currency = 'XTR',
    amount = 99,
    id = 'q1',
  ) =>
    (
      await db.query(
        'SELECT public.check_star_checkout($1,$2,$3,$4,$5) AS ok',
        [o.payload, tg, currency, amount, id],
      )
    ).rows[0].ok;
  const event = async (
    o,
    refund = false,
    tg = 100,
    currency = 'XTR',
    amount = 99,
    charge = 'charge-1',
  ) =>
    (
      await db.query(
        'SELECT public.apply_star_event($1,$2,$3,$4,$5,$6) AS state',
        [o.payload, tg, currency, amount, charge, refund],
      )
    ).rows[0].state;
  const has = async (i = 0) =>
    (await db.query('SELECT public.has_premium($1) AS ok', [users[i]])).rows[0]
      .ok;
  const o = await order();
  assert.deepEqual(await order(), o);
  assert.equal((await order(0, 'parallel')).id, o.id);
  assert.equal(await has(), false);
  assert.equal(await checkout(o, 101), false);
  assert.equal(await checkout(o, 100, 'USD'), false);
  assert.equal(await checkout(o, 100, 'XTR', 100), false);
  await assert.rejects(event(o));
  assert.equal(await checkout(o), true);
  assert.equal(await checkout(o), true);
  assert.equal(await checkout(o, 100, 'XTR', 99, 'second-query'), false);
  assert.equal(await has(), false);
  for (const args of [
    [false, 101, 'XTR', 99],
    [false, 100, 'USD', 99],
    [false, 100, 'XTR', 100],
  ])
    await assert.rejects(event(o, ...args));
  assert.equal(await event(o), 'paid');
  assert.equal(await has(), true);
  assert.equal(await event(o), 'paid');
  const expires = (
    await db.query(
      'SELECT ends_at FROM public.subscriptions WHERE user_id=$1',
      [users[0]],
    )
  ).rows[0].ends_at;
  await event(o);
  assert.deepEqual(
    (
      await db.query(
        'SELECT ends_at FROM public.subscriptions WHERE user_id=$1',
        [users[0]],
      )
    ).rows[0].ends_at,
    expires,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM public.subscriptions'))
      .rows[0].n,
    1,
  );
  await assert.rejects(order(0, 'after-paid'));
  const lesson = '40000000-0000-0000-0000-000000000002';
  await db.exec(
    `UPDATE public.courses SET access_tier='premium';UPDATE public.lessons SET free_preview=true WHERE id='40000000-0000-0000-0000-000000000001';`,
  );
  const start = async (i, id = lesson, key = 'access') =>
    (
      await db.query('SELECT public.start_lesson($1,$2,$3) AS data', [
        users[i],
        id,
        contentId(`start/${i}/${key}`),
      ])
    ).rows[0].data;
  await assert.rejects(start(1));
  assert.equal(
    (await start(1, '40000000-0000-0000-0000-000000000001')).total,
    1,
  );
  assert.equal((await start(0)).total, 6);
  const features = (
    await db.query('SELECT public.premium_features($1) AS data', [users[0]])
  ).rows[0].data;
  assert.equal(features.accuracy, 0);
  await assert.rejects(
    db.query('SELECT public.premium_features($1)', [users[1]]),
  );
  // Extra questions are filtered into snapshots only for active Premium.
  await db.exec(
    `UPDATE public.courses SET access_tier='free';INSERT INTO public.exercises(lesson_id,kind,prompt,position,public_payload,answer_key,explanation,premium_only) VALUES('${lesson}','grammar','Extra',7,'{"options":[{"id":"a","label":"I am"},{"id":"b","label":"I is"}]}','{"value":"a"}','I am is correct.',true);`,
  );
  assert.equal((await start(1, lesson, 'no-extra')).total, 6);
  const extra = await start(0, lesson, 'with-extra');
  assert.equal(extra.total, 7);
  await db.exec(`SET ROLE anon`);
  await assert.rejects(db.exec('SELECT * FROM public.star_orders'));
  await assert.rejects(db.exec('SELECT * FROM public.star_events'));
  await assert.rejects(
    db.query("SELECT public.apply_star_event($1,100,'XTR',99,'forged',false)", [
      o.payload,
    ]),
  );
  assert.equal(
    (
      await db.query(`SELECT id FROM public.exercises WHERE lesson_id=$1`, [
        lesson,
      ])
    ).rows.length,
    6,
  );
  await db.exec('RESET ROLE');
  // Finish ordinary questions; the next snapshot item requires a live entitlement.
  const answers = [
    'hello',
    ['i', 'like', 'reading'],
    'am',
    { cat: 'cat_ru', dog: 'dog_ru' },
    'speaks',
    'morning',
  ];
  for (const [i, answer] of answers.entries()) {
    await db.query('SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb)', [
      users[0],
      extra.attemptId,
      i + 1,
      JSON.stringify(answer),
    ]);
  }
  // Refund confirmation revokes access immediately; pending refund keeps paid access.
  await db.query('SELECT public.prepare_star_refund($1)', [o.id]);
  assert.equal(await has(), true);
  assert.equal(await event(o, true), 'refunded');
  assert.equal(await has(), false);
  await event(o, true);
  await event(o);
  assert.equal(await has(), false);
  await assert.rejects(
    db.query('SELECT public.lesson_state($1,$2)', [users[0], extra.attemptId]),
    /premium required/,
  );
  await assert.rejects(
    db.query('SELECT public.submit_lesson_answer($1,$2,7,$3::jsonb)', [
      users[0],
      extra.attemptId,
      JSON.stringify('a'),
    ]),
    /premium required/,
  );
  // Refund arriving before success creates a tombstone: late receipt cannot reactivate.
  const early = await order(2);
  await event(early, true, 102, 'XTR', 99, 'early-charge');
  await event(early, false, 102, 'XTR', 99, 'early-charge');
  assert.equal(await has(2), false);
  const expired = await order(1);
  await db.query(
    `UPDATE public.star_orders SET expires_at=now()-interval '1 minute' WHERE id=$1`,
    [expired.id],
  );
  assert.equal(await checkout(expired, 101), false);
  assert.equal((await order(1)).state, 'expired');
  const fresh = await order(1, 'fresh');
  assert.equal(await checkout(fresh, 101, 'XTR', 99, 'q-other'), true);
  await event(fresh, false, 101, 'XTR', 99, 'other-charge');
  assert.equal(await has(1), true);
  // Dates, not just a stale 'active' label, control entitlement.
  await db.query(
    `UPDATE public.subscriptions SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 second' WHERE user_id=$1`,
    [users[1]],
  );
  assert.equal(await has(1), false);
  assert.equal(
    (await db.query('SELECT public.premium_status($1) AS data', [users[1]]))
      .rows[0].data.status,
    'expired',
  );
  // Distinct approved invoices may settle late; retain each actual charge once.
  const delayed = await order(0, 'delayed');
  assert.equal(await checkout(delayed, 100, 'XTR', 99, 'q-delayed'), true);
  await db.query(
    "UPDATE public.star_orders SET expires_at=now()-interval '1 second' WHERE id=$1",
    [delayed.id],
  );
  const newer = await order(0, 'newer');
  assert.equal(await checkout(newer, 100, 'XTR', 99, 'q-newer'), true);
  await event(delayed, false, 100, 'XTR', 99, 'delayed-charge');
  await event(newer, false, 100, 'XTR', 99, 'newer-charge');
  const windows = (
    await db.query(
      'SELECT starts_at,ends_at FROM public.subscriptions WHERE star_order_id IN ($1,$2) ORDER BY starts_at',
      [delayed.id, newer.id],
    )
  ).rows;
  assert.equal(windows.length, 2);
  assert.equal(
    new Date(windows[0].ends_at).getTime(),
    new Date(windows[1].starts_at).getTime(),
  );
  assert.equal(
    new Date(windows[1].ends_at).getTime() -
      new Date(windows[0].starts_at).getTime(),
    60 * 86400000,
  );
  await event(delayed, true, 100, 'XTR', 99, 'delayed-charge');
  assert.equal(await has(), true);
  const remaining = (
    await db.query(
      'SELECT starts_at,ends_at FROM public.subscriptions WHERE star_order_id=$1',
      [newer.id],
    )
  ).rows[0];
  assert.equal(
    new Date(remaining.ends_at).getTime() -
      new Date(remaining.starts_at).getTime(),
    30 * 86400000,
  );
  await event(delayed, true, 100, 'XTR', 99, 'delayed-charge');
  assert.deepEqual(
    (
      await db.query(
        'SELECT starts_at,ends_at FROM public.subscriptions WHERE star_order_id=$1',
        [newer.id],
      )
    ).rows[0],
    remaining,
  );
  // The review schedule follows the latest completed attempt, not the first.
  const preview = '40000000-0000-0000-0000-000000000001';
  const completedAttempt = await start(0, preview, 'completed-preview');
  await db.query('SELECT public.submit_lesson_answer($1,$2,1,$3::jsonb)', [
    users[0],
    completedAttempt.attemptId,
    JSON.stringify(
      (
        await db.query(
          'SELECT id::text FROM public.exercise_options WHERE is_correct AND exercise_id=(SELECT id FROM public.exercises WHERE lesson_id=$1)',
          [preview],
        )
      ).rows[0].id,
    ),
  ]);
  await db.query(
    "UPDATE public.user_progress SET completed_at=now()-interval '20 days' WHERE user_id=$1",
    [users[0]],
  );
  const review = (
    await db.query('SELECT public.premium_features($1) AS data', [users[0]])
  ).rows[0].data;
  assert.equal(review.completedAttempts, 1);
  assert.equal(review.accuracy, 100);
  const lastCompletion = (
    await db.query(
      'SELECT completed_at FROM public.lesson_attempts WHERE id=$1',
      [completedAttempt.attemptId],
    )
  ).rows[0].completed_at;
  assert.equal(
    new Date(review.reviewPlan[0].reviewAfter).getTime() -
      new Date(lastCompletion).getTime(),
    7 * 86400000,
  );
  await event(newer, true, 100, 'XTR', 99, 'newer-charge');
  assert.equal(await has(), false);
  // A failure while issuing access rolls back both receipt and order state.
  const rollback = await order(2, 'rollback');
  assert.equal(await checkout(rollback, 102, 'XTR', 99, 'q-rollback'), true);
  await assert.rejects(event(rollback, false, 102, 'XTR', 99, 'newer-charge'));
  await db.exec(
    `CREATE FUNCTION public.test_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test access failure'; END $$;CREATE TRIGGER test_fail_payment BEFORE INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.test_fail_payment();`,
  );
  await assert.rejects(
    event(rollback, false, 102, 'XTR', 99, 'rollback-charge'),
    /test access failure/,
  );
  assert.equal(await has(2), false);
  assert.equal(
    (
      await db.query('SELECT state FROM public.star_orders WHERE id=$1', [
        rollback.id,
      ])
    ).rows[0].state,
    'approved',
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.star_events WHERE event_key='paid:rollback-charge'",
      )
    ).rows[0].n,
    0,
  );
  await db.exec(
    'DROP TRIGGER test_fail_payment ON public.subscriptions;DROP FUNCTION public.test_fail_payment();',
  );
  await event(rollback, false, 102, 'XTR', 99, 'rollback-charge');
  assert.equal(await has(2), true);
  console.log(
    'PASS: Stars invoice idempotency/expiry, exact payer/currency/amount, pre-checkout vs confirmed receipt, replay, distinct late charges, refund/tombstone ordering, atomic rollback, access revocation mid-lesson, RLS, course/preview rights, review plans and extra-task filtering.',
  );
} finally {
  await db.close();
}

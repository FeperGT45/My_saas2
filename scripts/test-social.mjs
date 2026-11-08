import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  let sequence = 100;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  async function register(key, ref = null) {
    const id = contentId('social/' + key);
    await db.query('INSERT INTO auth.users VALUES($1)', [id]);
    const telegram = ++sequence;
    await session(id, telegram, key, ref);
    return { id, telegram };
  }
  async function session(id, tg, key, ref) {
    return db.query(
      `SELECT public.create_social_telegram_session($1,$2,'PRIVATE NAME',NULL,'https://private.invalid/avatar',$3,$4,$5) AS id`,
      [id, tg, hash('token/' + key), hash('init/' + key), ref],
    );
  }
  const code = async (user) =>
    (
      await db.query('SELECT referral_code FROM public.users WHERE id=$1', [
        user.id,
      ])
    ).rows[0].referral_code;
  const summary = async (user, scope = 'global', offset = 0) =>
    (
      await db.query('SELECT public.social_summary($1,$2,$3) AS data', [
        user.id,
        scope,
        offset,
      ])
    ).rows[0].data;
  const parent = await register('parent'),
    other = await register('other');
  const pcode = await code(parent),
    ocode = await code(other);
  const friend = await register('friend', pcode);
  assert.equal((await summary(parent)).invitations.invited, 1);
  assert.equal((await summary(parent)).invitations.coins, 0);
  await session(friend.id, friend.telegram, 'repeat-login', ocode);
  assert.equal((await summary(other)).invitations.invited, 0);
  assert.equal((await summary(parent)).invitations.invited, 1);
  await assert.rejects(
    session(friend.id, friend.telegram, 'repeat-login', ocode),
  );
  await assert.rejects(
    db.query(
      'INSERT INTO public.referrals(referrer_id,referred_id) VALUES($1,$1)',
      [parent.id],
    ),
  );
  await session(parent.id, parent.telegram, 'self', pcode);
  assert.equal((await summary(parent)).invitations.invited, 1);
  // Late attribution on a signup without a link is ignored.
  const late = await register('late');
  await session(late.id, late.telegram, 'late-link', pcode);
  assert.equal((await summary(parent)).invitations.invited, 1);
  const lesson = '40000000-0000-0000-0000-000000000001';
  async function complete(user, key, score = 100, reward = null) {
    const id = contentId('social-attempt/' + key);
    await db.query(
      `INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,started_at,completed_at,xp_reward_snapshot) VALUES($1,$2,$3,'completed',$4,now()-interval '5 minutes',now(),$5)`,
      [id, user.id, lesson, score, reward],
    );
    return id;
  }
  const award = async (id) =>
    (await db.query('SELECT public.award_completed_lesson($1) AS ok', [id]))
      .rows[0].ok;
  await award(await complete(friend, 'low', 59));
  assert.equal((await summary(parent)).invitations.qualified, 0);
  const first = await complete(friend, 'pass');
  await Promise.all([award(first), award(first)]);
  assert.equal((await summary(parent)).invitations.coins, 25);
  assert.equal((await summary(parent)).myXp, 0);
  await award(await complete(friend, 'new-attempt'));
  assert.equal((await summary(parent)).invitations.coins, 25);
  for (let i = 0; i < 11; i++) {
    const invited = await register(`cap-${i}`, pcode);
    await award(await complete(invited, `cap-${i}`));
  }
  const stats = (await summary(parent)).invitations;
  assert.equal(stats.invited, 12);
  assert.equal(stats.qualified, 12);
  assert.equal(stats.rewarded, 10);
  assert.equal(stats.coins, 250);
  // Failure in referral credit must roll back the invited user's entire completion reward.
  const failFriend = await register('rollback', ocode);
  const failing = await complete(failFriend, 'rollback');
  await db.exec(
    `CREATE FUNCTION public.fail_referral() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='referral' THEN RAISE EXCEPTION 'test'; END IF;RETURN NEW;END $$;CREATE TRIGGER fail_referral BEFORE INSERT ON public.coin_events FOR EACH ROW EXECUTE FUNCTION public.fail_referral();`,
  );
  await assert.rejects(award(failing));
  assert.equal((await summary(other)).invitations.qualified, 0);
  assert.equal((await summary(failFriend)).myXp, 0);
  await db.exec(
    'DROP TRIGGER fail_referral ON public.coin_events;DROP FUNCTION public.fail_referral()',
  );
  await award(failing);
  assert.equal((await summary(other)).invitations.coins, 25);
  // Explicit consent + independent public aliases; no Telegram data, IDs, links or referral identities.
  await award(await complete(parent, 'rank-parent'));
  await award(await complete(other, 'rank-other'));
  assert.equal((await summary(parent)).entries.length, 0);
  for (const [user, alias] of [
    [parent, 'Alpha'],
    [other, 'Beta'],
  ])
    await db.query('SELECT public.set_social_privacy($1,true,$2)', [
      user.id,
      alias,
    ]);
  const global = await summary(parent);
  assert.equal(global.entries.length, 2);
  assert.equal(
    global.entries.every((e) => e.rank === 1),
    true,
  );
  assert.equal(global.myPosition, 1);
  for (const row of global.entries) {
    assert.deepEqual(Object.keys(row).sort(), [
      'alias',
      'appearance',
      'isMe',
      'rank',
      'xp',
    ]);
    assert.deepEqual(row.appearance, {
      theme: 'base',
      frame: 'plain',
      badge: 'none',
      effect: 'none',
      decoration: 'none',
    });
  }
  assert.equal(JSON.stringify(global).includes('PRIVATE NAME'), false);
  assert.equal(JSON.stringify(global).includes('private.invalid'), false);
  assert.equal(JSON.stringify(global).includes(friend.id), false);
  assert.equal((await summary(friend)).myPosition, null);
  await db.query(
    `UPDATE public.xp_events SET created_at=(date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second' WHERE user_id=$1`,
    [other.id],
  );
  assert.equal((await summary(parent, 'weekly')).entries.length, 1);
  assert.equal((await summary(parent, 'weekly')).myXp, 10);
  assert.equal((await summary(parent, 'global')).entries.length, 2);
  await db.query(
    `UPDATE public.xp_events SET created_at=(date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '7 days' WHERE user_id=$1`,
    [other.id],
  );
  assert.equal((await summary(parent, 'weekly')).entries.length, 1);
  for (let i = 0; i < 25; i++) {
    const user = await register(`rank-${i}`);
    await award(await complete(user, `rank-${i}`, 100, 100 + i));
    await db.query('SELECT public.set_social_privacy($1,true,$2)', [
      user.id,
      `Player ${i}`,
    ]);
  }
  const page = await summary(parent);
  assert.equal(page.entries.length, 20);
  assert.equal(
    page.entries.some((e) => e.isMe),
    false,
  );
  assert.equal(page.myPosition, 26);
  assert.equal(
    (await summary(parent, 'global', 20)).entries.some((e) => e.isMe),
    true,
  );
  await db.query('SELECT public.set_social_privacy($1,false,$2)', [
    parent.id,
    'Alpha',
  ]);
  assert.equal((await summary(parent)).myPosition, null);
  assert.equal(
    (await summary(other)).entries.some((e) => e.alias === 'Alpha'),
    false,
  );
  await assert.rejects(summary(parent, 'bad'));
  await assert.rejects(summary(parent, 'global', -1));
  await db.exec(
    `SET ROLE authenticated;SET request.jwt.claim.sub='${parent.id}'`,
  );
  for (const sql of [
    'SELECT * FROM public.referrals',
    'SELECT attempt_id FROM public.coin_events',
    `SELECT public.social_summary('${other.id}','global',0)`,
    `SELECT public.set_social_privacy('${parent.id}',true,'Forged')`,
    'UPDATE public.users SET leaderboard_visible=true',
  ])
    await assert.rejects(db.exec(sql));
  await db.exec('RESET ROLE');
  // Account removal cannot reopen the inviter's lifetime payout cap.
  await db.query('DELETE FROM auth.users WHERE id=$1', [friend.id]);
  assert.equal((await summary(parent)).invitations.rewarded, 10);
  const afterDeletion = await register('after-deletion', pcode);
  await award(await complete(afterDeletion, 'after-deletion'));
  assert.equal((await summary(parent)).invitations.coins, 250);
  // Rollout compatibility: an account created through the old login RPC cannot claim later.
  const oldId = contentId('social/old-rpc');
  await db.query('INSERT INTO auth.users VALUES($1)', [oldId]);
  await db.query(
    `SELECT public.create_telegram_session($1,99999,'Old',NULL,NULL,$2,$3)`,
    [oldId, hash('old-token'), hash('old-init')],
  );
  const beforeLate = (await summary(other)).invitations.invited;
  await session(oldId, 99999, 'old-claim', ocode);
  assert.equal((await summary(other)).invitations.invited, beforeLate);
  console.log(
    'PASS: signed-signup attribution contract, no self/late/duplicate referrals, first qualifying action, lifetime payout cap, atomic rollback, repeat requests, opt-in rankings, UTC boundaries, ties, pagination/own rank and private DTOs/RLS.',
  );
} finally {
  await db.close();
}

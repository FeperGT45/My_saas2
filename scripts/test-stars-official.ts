// Real Telegram Test Server only. No Supabase connection and no production Bot API.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { invoiceParameters } from '../src/lib/billing/config';
import { premiumPlans } from '../src/lib/billing/plans';
import {
  parseStarsUpdate,
  processStarsUpdate,
  type Receipt,
} from '../src/lib/billing/events';

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const allowed = new Set([
  'getMe',
  'getWebhookInfo',
  'getUpdates',
  'sendInvoice',
  'answerPreCheckoutQuery',
  'refundStarPayment',
]);
const prepare = process.argv.includes('--prepare');
const token = process.env.TELEGRAM_TEST_BOT_TOKEN ?? '';
async function api(method: string, body: unknown = {}): Promise<unknown> {
  assert(allowed.has(method));
  assert(
    /^\d+:[A-Za-z0-9_-]{20,}$/.test(token),
    'Configure TELEGRAM_TEST_BOT_TOKEN in .env.stars-test.local',
  );
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/test/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(28000),
      },
    );
    const data = record(await r.json());
    if (!r.ok || data.ok !== true) throw Error();
    return data.result;
  } catch {
    throw Error(`Telegram Test Server ${method} failed; details redacted.`);
  }
}

const db = new PGlite();
async function rpc<T>(sql: string, args: unknown[] = []) {
  return (await db.query<{ value: T }>(`SELECT public.${sql} AS value`, args))
    .rows[0].value;
}
async function main() {
  // Reject absent credentials before doing expensive work. Never fall back to the live token.
  if (!prepare)
    assert(
      /^\d+:[A-Za-z0-9_-]{20,}$/.test(token),
      'Set TELEGRAM_TEST_BOT_TOKEN in ignored .env.stars-test.local, never in chat.',
    );
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
  );
  for (const file of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  if (prepare) {
    console.log(
      'PASS: isolated application schema prepared. No Telegram requests or payments performed.',
    );
    return;
  }
  const bot = record(await api('getMe'));
  assert.equal(bot.is_bot, true);
  assert.equal(typeof bot.username, 'string');
  assert(
    !record(await api('getWebhookInfo')).url,
    'Use a fresh dedicated test bot without a webhook; existing webhook was not changed.',
  );
  const nonce = 'stars_test_' + randomBytes(12).toString('hex');
  let offset = 0;
  async function updates() {
    const data = await api('getUpdates', {
      offset,
      timeout: 20,
      allowed_updates: ['message', 'pre_checkout_query'],
    });
    assert(Array.isArray(data));
    return data.map(record);
  }
  function ack(u: Record<string, unknown>) {
    assert(Number.isSafeInteger(u.update_id));
    offset = Number(u.update_id) + 1;
  }
  console.log(
    `TEST SERVER ONLY: open @${bot.username} in Test DC and send /start ${nonce}`,
  );
  const deadline = Date.now() + 15 * 60000;
  let tg = 0;
  while (!tg && Date.now() < deadline) {
    for (const u of await updates()) {
      const m = record(u.message),
        chat = record(m.chat),
        from = record(m.from);
      if (
        m.text === '/start ' + nonce &&
        chat.type === 'private' &&
        chat.id === from.id &&
        Number.isSafeInteger(chat.id) &&
        Number(chat.id) > 0
      )
        tg = Number(chat.id);
      ack(u);
    }
  }
  assert(tg, 'Timed out waiting for the private test start command.');
  const user = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [user]);
  await db.query(
    'INSERT INTO public.users(id,display_name,telegram_id) VALUES($1,$2,$3)',
    [user, 'Official Stars test fixture', tg],
  );
  const evidence = [];
  for (const plan of premiumPlans) {
    const order = await rpc<{ payload: string; amount: number; days: number }>(
      'create_star_plan_order($1,$2,$3)',
      [user, randomUUID(), plan.id],
    );
    assert.equal(order.amount, plan.amount);
    assert.equal(order.days, plan.days);
    const sent = record(
      await api('sendInvoice', {
        chat_id: tg,
        ...invoiceParameters(order.payload, plan.amount, plan.days),
        start_parameter: 'official-stars-test',
      }),
    );
    assert(Number.isSafeInteger(sent.message_id));
    console.log(
      `Official Test Server invoice sent: ${plan.amount} TEST Stars / ${plan.days} days. Confirm only in Test DC.`,
    );
    let paid: Receipt | null = null;
    const deps = {
      enabled: true,
      check: async (q: {
        payload: string;
        telegramId: number;
        currency: string;
        amount: number;
        id: string;
      }) =>
        rpc<boolean>('check_star_checkout($1,$2,$3,$4,$5)', [
          q.payload,
          q.telegramId,
          q.currency,
          q.amount,
          q.id,
        ]),
      answer: async (id: string, ok: boolean) => {
        await api('answerPreCheckoutQuery', {
          pre_checkout_query_id: id,
          ok,
          ...(!ok ? { error_message: 'Test invoice rejected' } : {}),
        });
      },
      apply: async (e: Receipt) => {
        await rpc('apply_star_event($1,$2,$3,$4,$5,$6)', [
          e.payload,
          e.telegramId,
          e.currency,
          e.amount,
          e.chargeId,
          e.kind === 'refund',
        ]);
      },
    };
    const paymentDeadline = Date.now() + 10 * 60000;
    while (!paid && Date.now() < paymentDeadline) {
      for (const u of await updates()) {
        const event = parseStarsUpdate(u);
        if (event?.payload === order.payload && event.telegramId === tg) {
          await processStarsUpdate(u, deps);
          if (event.kind === 'paid') paid = event;
        } else if (event?.kind === 'checkout')
          await deps.answer(event.id, false);
        ack(u);
      }
    }
    assert(
      paid,
      'No official successful_payment received; payment is NOT verified.',
    );
    assert.equal(await rpc('has_premium($1)', [user]), true);
    const before = (
      await db.query(
        'SELECT id,status,starts_at,ends_at FROM public.subscriptions WHERE user_id=$1 ORDER BY id',
        [user],
      )
    ).rows;
    await deps.apply(paid);
    assert.deepEqual(
      (
        await db.query(
          'SELECT id,status,starts_at,ends_at FROM public.subscriptions WHERE user_id=$1 ORDER BY id',
          [user],
        )
      ).rows,
      before,
      'Duplicate receipt changed access',
    );
    const duration = await db.query<{ days: number }>(
      "SELECT extract(epoch FROM (ends_at-starts_at))/86400 AS days FROM public.subscriptions WHERE user_id=$1 AND status='active'",
      [user],
    );
    assert.equal(Number(duration.rows[0].days), plan.days);
    assert.equal(
      await api('refundStarPayment', {
        user_id: tg,
        telegram_payment_charge_id: paid.chargeId,
      }),
      true,
    );
    await deps.apply({ ...paid, kind: 'refund' });
    assert.equal(await rpc('has_premium($1)', [user]), false);
    evidence.push({
      plan: plan.id,
      testStars: plan.amount,
      days: plan.days,
      officialReceipt: true,
      duplicateSafe: true,
      officialRefund: true,
      accessRevoked: true,
    });
    console.log(
      `PASS: ${plan.id} official receipt, Premium duration, replay and refund verified on isolated application SQL.`,
    );
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/stars-official-result.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        environment: 'Telegram Test Server',
        database: 'isolated PGlite',
        realStarsSpent: false,
        tests: evidence,
        limits:
          'Bot API polling and application SQL, not deployed Mini App or production webhook delivery.',
      },
      null,
      2,
    ),
  );
}
try {
  await main();
} catch (e) {
  console.error(
    e instanceof assert.AssertionError
      ? e.message
      : 'Official test stopped. No credentials or receipts logged; inspect test bot before retrying.',
  );
  process.exitCode = 1;
} finally {
  await db.close();
}

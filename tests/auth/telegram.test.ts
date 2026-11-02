import { readBodyText } from '../../src/lib/auth/body';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateInitData } from '../../src/lib/telegram/validate';
import {
  localAuthAllowed,
  signLocalSession,
  validLocalSession,
  assertSameOrigin,
  equalSecret,
} from '../../src/lib/auth/security';
import { miniAppUrl, startMessage } from '../../src/lib/telegram/bot';
const token = '123456:unit-test-token-not-a-real-secret';
const now = 1800000000;
function signed(overrides: Record<string, string> = {}) {
  const p = new URLSearchParams({
    auth_date: String(now),
    query_id: 'fixture',
    user: JSON.stringify({
      id: 12345,
      first_name: 'Алекс',
      last_name: 'Тест',
      photo_url: 'https://example.com/avatar.jpg',
    }),
    ...overrides,
  });
  const text = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(text).digest('hex'));
  return p.toString();
}
test('valid signature produces identity from signed payload, preserving unicode', () => {
  const user = validateInitData(signed(), token, now);
  assert.equal(user.id, 12345);
  assert.equal(user.firstName, 'Алекс');
  assert.equal(user.photoUrl, 'https://example.com/avatar.jpg');
});
test('reject tampering, wrong token, missing hash, malformed hash and duplicate fields', () => {
  const raw = signed();
  const p = new URLSearchParams(raw);
  p.set('user', JSON.stringify({ id: 999, first_name: 'Forged' }));
  for (const candidate of [
    p.toString(),
    '',
    raw + '&auth_date=' + now,
    raw.replace(/hash=[^&]+/, 'hash=bad'),
  ])
    assert.throws(() => validateInitData(candidate, token, now));
  assert.throws(() => validateInitData(raw, 'wrong', now));
});
test('reject stale, future, invalid timestamps and bad signed user shape', () => {
  for (const date of [String(now - 301), String(now + 31), 'NaN', '1.5'])
    assert.throws(() =>
      validateInitData(signed({ auth_date: date }), token, now),
    );
  for (const user of [
    'null',
    '{broken',
    JSON.stringify({ id: -1, first_name: 'X' }),
    JSON.stringify({ id: 1, first_name: '' }),
  ])
    assert.throws(() => validateInitData(signed({ user }), token, now));
  assert.throws(() => validateInitData('x'.repeat(17000), token, now));
});
test('unsafe avatar protocol is discarded', () => {
  assert.equal(
    validateInitData(
      signed({
        user: JSON.stringify({
          id: 1,
          first_name: 'A',
          photo_url: 'javascript:alert(1)',
        }),
      }),
      token,
      now,
    ).photoUrl,
    undefined,
  );
});
test('local sessions expire and cannot be forged or used in production', () => {
  const value = signLocalSession('local-test-secret', 1000001);
  assert.equal(validLocalSession(value, 'local-test-secret', 1), true);
  assert.equal(validLocalSession(value, 'other', 1), false);
  assert.equal(validLocalSession(value, 'local-test-secret', 1000002), false);
  const old = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ENABLE_LOCAL_AUTH: 'true',
    });
    assert.equal(localAuthAllowed(new Request('http://localhost')), false);
    Object.assign(process.env, { NODE_ENV: 'development' });
    assert.equal(localAuthAllowed(new Request('http://localhost')), true);
    assert.equal(
      localAuthAllowed(new Request('https://public.example')),
      false,
    );
    process.env.ENABLE_LOCAL_AUTH = 'false';
    assert.equal(localAuthAllowed(new Request('http://localhost')), false);
  } finally {
    process.env = old;
  }
});
test('origin guard and bot command/url validation', () => {
  const old = { ...process.env };
  try {
    process.env.APP_URL = 'https://app.example';
    assert.doesNotThrow(() =>
      assertSameOrigin(
        new Request('https://app.example', {
          headers: { origin: 'https://app.example' },
        }),
      ),
    );
    assert.throws(() =>
      assertSameOrigin(
        new Request('https://app.example', {
          headers: { origin: 'https://evil.example' },
        }),
      ),
    );
    assert.throws(() => assertSameOrigin(new Request('https://app.example')));
  } finally {
    process.env = old;
  }
  assert.equal(equalSecret('secret', 'secret'), true);
  assert.equal(equalSecret('secret', 'other'), false);
  assert.equal(startMessage('/start invite', 'Voklumi67'), true);
  assert.equal(startMessage('/start@Voklumi67', 'Voklumi67'), true);
  assert.equal(startMessage('/start@otherbot', 'Voklumi67'), false);
  assert.equal(startMessage('/starter', 'Voklumi67'), false);
  assert.equal(miniAppUrl('https://app.example'), 'https://app.example/');
  assert.throws(() => miniAppUrl('http://app.example'));
  assert.throws(() => miniAppUrl('https://user:pass@app.example'));
});

test('bounded request reader rejects oversized streaming bodies', async () => {
  assert.equal(
    await readBodyText(
      new Request('https://example.com', { method: 'POST', body: 'hello' }),
      5,
    ),
    'hello',
  );
  await assert.rejects(
    readBodyText(
      new Request('https://example.com', {
        method: 'POST',
        body: 'too much data',
      }),
      3,
    ),
  );
});

test('referral attribution is extracted only from signed start_param', () => {
  const code = 'a'.repeat(32);
  const raw = signed({ start_param: `r_${code}` });
  assert.equal(validateInitData(raw, token, now).referralCode, code);
  assert.throws(() =>
    validateInitData(raw.replace(code, 'b'.repeat(32)), token, now),
  );
  assert.equal(
    validateInitData(signed({ start_param: 'r_notvalid' }), token, now)
      .referralCode,
    undefined,
  );
});

test('Telegram invitation URLs are restricted to own code and configured bot', async () => {
  const { telegramInviteUrl } = await import('../../src/lib/social/invite');
  const code = 'a'.repeat(32);
  assert.equal(
    telegramInviteUrl(code),
    'https://t.me/Voklumi_bot?startapp=r_' + code,
  );
  assert.equal(
    telegramInviteUrl(code, 'Voklumi_bot', 'learn'),
    'https://t.me/Voklumi_bot/learn?startapp=r_' + code,
  );
  assert.throws(() => telegramInviteUrl('bad'));
  assert.throws(() => telegramInviteUrl(code, 'evil.example/path'));
});

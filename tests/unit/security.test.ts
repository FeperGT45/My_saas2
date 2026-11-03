import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { validateInitData } from '@/lib/telegram/validate';
import { assertSameOrigin, localAuthAllowed } from '@/lib/auth/security';
import { readBodyText } from '@/lib/auth/body';
import { isAdmin } from '@/lib/admin/access';
import { parseAdminQuery } from '@/lib/admin/validation';
import { validatePublicKey } from '@/lib/supabase/config';
import { billingConfiguration } from '@/lib/billing/config';
import { fetchWithTimeout, readJson } from '@/lib/http/client';

const token = 'fixture-token';
const now = 1800000000;
function signed(user: object, date = now) {
  const p = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(date),
  });
  const text = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  p.set(
    'hash',
    createHmac(
      'sha256',
      createHmac('sha256', 'WebAppData').update(token).digest(),
    )
      .update(text)
      .digest('hex'),
  );
  return p.toString();
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('Telegram trust boundary', () => {
  it.each([
    'not a URL',
    'javascript:alert(1)',
    'http://example.com/avatar',
    'https://user:pass@example.com/a',
  ])(
    'discards invalid optional avatar %s without rejecting a signed identity',
    (photo_url) => {
      const identity = validateInitData(
        signed({ id: 123, first_name: 'Алекс', photo_url }),
        token,
        now,
      );
      expect(identity.id).toBe(123);
      expect(identity.photoUrl).toBeUndefined();
    },
  );
  it.each([now - 301, now + 31])(
    'rejects timestamps outside the window: %s',
    (date) => {
      expect(() =>
        validateInitData(
          signed({ id: 123, first_name: 'Test' }, date),
          token,
          now,
        ),
      ).toThrow();
    },
  );
  it('rejects forged identity, duplicate fields, wrong token and excessive input', () => {
    const raw = signed({ id: 123, first_name: 'Test' });
    for (const candidate of [
      raw.replace('123', '999'),
      raw + '&auth_date=' + now,
      'x'.repeat(17000),
    ])
      expect(() => validateInitData(candidate, token, now)).toThrow();
    expect(() => validateInitData(raw, 'wrong-token', now)).toThrow();
  });
  it('production rejects local auth and cross-origin writes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_LOCAL_AUTH', 'true');
    vi.stubEnv('APP_URL', 'https://app.example.com');
    expect(localAuthAllowed(new Request('http://localhost'))).toBe(false);
    for (const origin of [
      '',
      'null',
      'https://evil.example',
      'https://app.example.com.evil.example',
    ])
      expect(() =>
        assertSameOrigin(
          new Request('https://app.example.com/api/game', {
            headers: { origin },
          }),
        ),
      ).toThrow();
  });
});
describe('privileges and untrusted input', () => {
  it('a username, local identity or malformed configuration cannot grant admin access', () => {
    const user = {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'admin',
      telegramId: '123',
      mode: 'telegram' as const,
      avatarUrl: null,
    };
    expect(isAdmin(user, user.id)).toBe(true);
    for (const config of ['admin', '123', `${user.id},invalid`, ''])
      expect(isAdmin(user, config)).toBe(false);
    expect(isAdmin({ ...user, mode: 'local' }, user.id)).toBe(false);
  });
  it('query selectors cannot inject SQL, select foreign users or arbitrary relations', () => {
    for (const query of [
      'view=users;DROP TABLE users',
      'view=pg_authid',
      'view=users&userId=other',
      'view=users&offset=-1',
    ])
      expect(() =>
        parseAdminQuery('https://app.example/api/admin?' + query),
      ).toThrow();
  });
  it('public client keys reject both modern secrets and legacy service-role JWTs', () => {
    expect(() => validatePublicKey('sb_secret_fixture')).toThrow();
    const payload = Buffer.from(
      JSON.stringify({ role: 'service_role' }),
    ).toString('base64url');
    expect(() => validatePublicKey(`header.${payload}.signature`)).toThrow();
  });
  it('payments cannot activate without every owner-controlled prerequisite', () => {
    const configured = {
      TELEGRAM_STARS_PAYMENTS_ENABLED: 'true',
      TELEGRAM_STARS_OWNER_REVIEWED: 'true',
      TELEGRAM_BOT_TOKEN: 'fixture',
      TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
      TELEGRAM_STARS_PREMIUM_PRICE: '99',
      PREMIUM_TERMS_URL: 'https://example.com/terms',
      PAYMENT_SUPPORT_URL: 'https://example.com/support',
    };
    expect(billingConfiguration(configured).enabled).toBe(true);
    for (const name of Object.keys(configured))
      expect(billingConfiguration({ ...configured, [name]: '' }).enabled).toBe(
        false,
      );
  });
  it('streaming body limit counts UTF-8 bytes and rejects invalid encoding', async () => {
    await expect(
      readBodyText(
        new Request('https://app.example', { method: 'POST', body: '🙂🙂' }),
        7,
      ),
    ).rejects.toThrow();
    await expect(
      readBodyText(
        new Request('https://app.example', {
          method: 'POST',
          body: new Uint8Array([255]),
        }),
        8,
      ),
    ).rejects.toThrow();
  });
});
describe('bounded client failures', () => {
  it('a response body that stops streaming cannot hold the loading UI indefinitely', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream());
    const assertion = expect(readJson(response)).rejects.toThrow(
      'Повтори попытку позже',
    );
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
  });
  it('aborts hung requests and presents a useful, redacted error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new Error('upstream private detail')),
            ),
          ),
      ),
    );
    const request = fetchWithTimeout('/api/premium', undefined, 20);
    const assertion = expect(request).rejects.toThrow('Проверь интернет');
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
  });
  it('cancellation on navigation is preserved', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        expect(init.signal.aborted).toBe(true);
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }),
    );
    controller.abort();
    await expect(
      fetchWithTimeout('/api/game', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('proxy HTML errors never become JSON parser diagnostics in the UI', async () => {
    await expect(
      readJson(
        new Response('<html>private proxy internals</html>', { status: 502 }),
      ),
    ).rejects.toThrow('Сервер вернул некорректный ответ');
  });
});

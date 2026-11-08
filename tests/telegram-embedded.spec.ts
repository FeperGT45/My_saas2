import { test, expect } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';
import { adminServer } from './helpers/admin-server';

function signedLaunch(id: number, query: string) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: query,
    user: JSON.stringify({ id, first_name: 'Student' }),
  });
  const text = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData')
    .update('test-token-never-used-for-network')
    .digest();
  p.set('hash', createHmac('sha256', key).update(text).digest('hex'));
  return p.toString();
}

test('signed Telegram login persists across cross-site iframe reloads and logout revokes it', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer({ secureOrigin: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    // Only this isolated context may reach the local HTTPS fixture from the stubbed page.
    await context.grantPermissions(['local-network-access'], {
      origin: 'https://web.telegram.org',
    });
    // Local HTML at the real embedding origin: no requests or messages to Telegram.
    // This also exercises the application's actual frame-ancestors policy.
    const fixtureUrl = 'https://web.telegram.org/voklumi-test-fixture';
    await context.route(fixtureUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<iframe title="Mini App" src="${server.origin}/premium"></iframe>`,
      }),
    );
    const page = await context.newPage();
    await page.goto(fixtureUrl);
    const frame =
      page.frames().find((f) => f.url().startsWith(server.origin)) ??
      (await page.waitForEvent('framenavigated', {
        predicate: (f) => f.url().startsWith(server.origin),
        timeout: 10000,
      }));
    const p = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'embedded-login',
      user: JSON.stringify({ id: 456, first_name: 'Student' }),
    });
    const text = [...p.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const key = createHmac('sha256', 'WebAppData')
      .update('test-token-never-used-for-network')
      .digest();
    p.set('hash', createHmac('sha256', key).update(text).digest('hex'));
    const login = await frame!.evaluate(async (raw) => {
      const r = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: raw }),
      });
      return r.status;
    }, p.toString());
    expect(login).toBe(200);
    const cookies = await context.cookies(server.origin),
      session = cookies.find((c) => c.name === '__Host-voklumi_session_v2');
    expect(session).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    });
    expect(
      (session as unknown as { partitionKey?: string }).partitionKey,
    ).toBeTruthy();
    const status = () =>
      page
        .frames()
        .find((f) => f.url().startsWith(server.origin))!
        .evaluate(async () => {
          const r = await fetch('/api/auth/session');
          return { status: r.status, body: await r.json() };
        });
    expect(await status()).toMatchObject({
      status: 200,
      body: { user: { id: server.student } },
    });
    await page.reload();
    await expect
      .poll(async () => {
        try {
          return (await status()).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    const denied = await context.request.post(
      server.origin + '/api/auth/logout',
      { headers: { Origin: 'https://evil.example' } },
    );
    expect(denied.status()).toBe(403);
    expect((await status()).status).toBe(200);
    const out = await page
      .frames()
      .find((f) => f.url().startsWith(server.origin))!
      .evaluate(async () => {
        const r = await fetch('/api/auth/logout', { method: 'POST' });
        return r.status;
      });
    expect(out).toBe(200);
    expect((await status()).status).toBe(401);
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM public.telegram_sessions WHERE user_id=$1 AND init_hash=$2',
          [server.student, p.get('hash')],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await context.close().catch(() => {});
    await server.close();
  }
});

test('new sessions take precedence over legacy cookies after switching accounts and logout revokes both', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer({ secureOrigin: true }),
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.admin,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto(server.origin + '/premium');
    const current = () =>
      page.evaluate(async () => {
        const r = await fetch('/api/auth/session');
        return { status: r.status, body: await r.json() };
      });
    expect(await current()).toMatchObject({
      status: 200,
      body: { user: { id: server.admin } },
    });
    const raw = signedLaunch(456, 'switch-account');
    const status = await page.evaluate(
      async (raw) =>
        (
          await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: raw }),
          })
        ).status,
      raw,
    );
    expect(status).toBe(200);
    expect(await current()).toMatchObject({
      status: 200,
      body: { user: { id: server.student } },
    });
    await page.reload();
    expect(await current()).toMatchObject({
      status: 200,
      body: { user: { id: server.student } },
    });
    expect(
      (await context.cookies(server.origin)).some(
        (c) => c.name === '__Host-voklumi_session_v2',
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        async () =>
          (await fetch('/api/auth/logout', { method: 'POST' })).status,
      ),
    ).toBe(200);
    expect((await current()).status).toBe(401);
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM public.telegram_sessions WHERE token_hash=$1 OR init_hash=$2',
          [
            createHash('sha256').update(server.tokens.admin).digest('hex'),
            new URLSearchParams(raw).get('hash'),
          ],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await context.close().catch(() => {});
    await server.close();
  }
});

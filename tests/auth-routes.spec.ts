import { test, expect } from '@playwright/test';
test('production auth routes reject unauthenticated and cross-origin requests', async ({
  request,
}) => {
  expect((await request.post('/api/auth/local')).status()).toBe(404);
  expect((await request.get('/api/auth/session')).status()).toBe(401);
  expect(
    (
      await request.post('/api/auth/telegram', {
        headers: { origin: 'https://evil.example' },
        data: { initData: 'forged' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/auth/logout', {
        headers: { origin: 'https://evil.example' },
      })
    ).status(),
  ).toBe(403);
});

test('database health is disabled by default and never exposes schema details anonymously', async ({
  request,
}) => {
  const response = await request.get('/api/health/database');
  expect([401, 404]).toContain(response.status());
  expect(await response.text()).not.toContain('tables');
});

test('all personal APIs refuse anonymous requests and forged role headers', async ({
  request,
}) => {
  for (const path of [
    '/api/game',
    '/api/social',
    '/api/premium',
    '/api/premium/features',
    '/api/admin?view=users',
    '/api/lessons/60000000-0000-0000-0000-000000000001',
  ]) {
    const response = await request.get(path, {
      headers: {
        'x-user-id': 'a0000000-0000-0000-0000-000000000001',
        'x-role': 'admin',
      },
    });
    expect(response.status(), path).toBe(401);
    expect(response.headers()['cache-control']).toContain('no-store');
    const text = await response.text();
    expect(text).not.toMatch(
      /answer_key|token_hash|service_role|stack|SELECT /,
    );
  }
  for (const path of [
    '/api/lessons/start',
    '/api/game/timezone',
    '/api/social/privacy',
    '/api/admin',
  ]) {
    const response = await request.post(path, {
      headers: { origin: 'https://evil.example' },
      data: { userId: 'forged', xp: 999999, role: 'admin' },
    });
    expect(response.status(), path).toBe(403);
  }
});

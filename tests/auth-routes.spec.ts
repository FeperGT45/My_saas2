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

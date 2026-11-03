import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  '/',
  '/learn',
  '/courses',
  '/library',
  '/lesson',
  '/placement',
  '/learning-plan',
  '/leaderboard',
  '/achievements',
  '/profile',
  '/friends',
  '/premium',
  '/admin',
  '/settings',
];
test('public mobile screens meet automated WCAG 2 A/AA checks and keyboard navigation', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 780 });
  for (const path of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      path,
    ).toEqual([]);
  }
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
});

const user = {
  id: 'a0000000-0000-0000-0000-000000000001',
  name: '<img src=x onerror=alert(1)>',
  mode: 'telegram',
  telegramId: '123',
  avatarUrl: null,
};
test('logout hides account data even when the session refresh fails', async ({
  page,
}) => {
  let loggedOut = false;
  await page.route('**/api/auth/session', (route) =>
    loggedOut ? route.abort() : route.fulfill({ json: { user } }),
  );
  await page.route('**/api/auth/logout', (route) => {
    loggedOut = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/game', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Сервис временно недоступен.' },
    }),
  );
  await page.goto('/profile');
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByText(user.name, { exact: true })).toHaveCount(0);
});

test('Premium loading, failure and retry never invent subscription access', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user } }),
  );
  let mode = 'loading';
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/premium$/, async (route) => {
    if (mode === 'loading') await wait;
    if (mode !== 'ready')
      return route.fulfill({
        status: 503,
        json: { error: 'Подписки временно недоступны.' },
      });
    return route.fulfill({
      json: {
        premium: false,
        expiresAt: null,
        autoRenew: false,
        status: 'free',
        enabled: false,
        amount: null,
        termsUrl: null,
        supportUrl: null,
      },
    });
  });
  await page.goto('/premium');
  await expect(page.getByText('Проверяем подписку…')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Открыть оплату Telegram Stars' }),
  ).toBeDisabled();
  mode = 'error';
  release();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Подписки временно недоступны.',
  );
  mode = 'ready';
  await page.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(
    page.getByRole('status', { name: 'Статус Premium' }),
  ).toContainText('Текущий доступ: Free');
});

test('long signed names fit mobile screens with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user: { ...user, name: 'W'.repeat(80) } } }),
  );
  await page.route('**/api/game', (route) =>
    route.fulfill({ status: 503, json: { error: 'Временно недоступно' } }),
  );
  await page.goto('/profile');
  await expect(page.getByText('W'.repeat(80), { exact: true })).toBeVisible();
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('local demo identity cannot get stuck checking a real subscription', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: { ...user, id: 'local-demo', mode: 'local' } },
    }),
  );
  await page.goto('/premium');
  await expect(
    page
      .getByText('Войди через Telegram, чтобы проверить свой статус.')
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText('Проверяем подписку…')).toHaveCount(0);
});

test('security headers allow Telegram frames and protect content types', async ({
  request,
}) => {
  const response = await request.get('/');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['content-security-policy']).toContain(
    'https://*.telegram.org',
  );
  expect(response.headers()['referrer-policy']).toBe(
    'strict-origin-when-cross-origin',
  );
});

test('speech synthesis device errors fall back to text without crashing the lesson', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak() {
          throw new Error('Device unavailable');
        },
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {},
    });
  });
  await page.route('**/api/lessons/start', (route) =>
    route.fulfill({
      json: {
        attemptId: '60000000-0000-0000-0000-000000000001',
        lessonId: '40000000-0000-0000-0000-000000000002',
        status: 'started',
        total: 1,
        answered: 0,
        correct: 0,
        score: null,
        xp: 0,
        exercise: {
          position: 1,
          kind: 'listening',
          prompt: 'Выбери услышанное слово',
          payload: {
            text: 'Hello',
            lang: 'en-US',
            options: [
              { id: 'a', label: 'Hello' },
              { id: 'b', label: 'Goodbye' },
            ],
          },
        },
      },
    }),
  );
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await page.getByRole('button', { name: 'Прослушать фразу' }).click();
  await expect(page.getByText('Текстовый режим:')).toBeVisible();
  expect(errors).toEqual([]);
});

test('record local production navigation cost and honor reduced motion', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText(/Обзор в браузере/)).toBeVisible();
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming;
    const scripts = (
      performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    ).filter((entry) => entry.initiatorType === 'script');
    const probe = document.createElement('span');
    probe.className = 'animate-pulse';
    document.body.appendChild(probe);
    const iterations = getComputedStyle(probe).animationIterationCount;
    probe.remove();
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      loadMs: navigation.loadEventEnd,
      scriptCount: scripts.length,
      scriptEncodedBytes: scripts.reduce(
        (sum, entry) => sum + entry.encodedBodySize,
        0,
      ),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      iterations,
    };
  });
  expect(metrics.reducedMotion).toBe(true);
  expect(metrics.iterations).toBe('1');
  await test.info().attach('local-production-performance.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
});

import { test, expect } from '@playwright/test';
const routes = [
  '/',
  '/learn',
  '/courses',
  '/library',
  '/lesson',
  '/placement',
  '/learning-plan',
  '/review',
  '/leaderboard',
  '/achievements',
  '/profile',
  '/friends',
  '/premium',
  '/premium/terms',
  '/analytics',
  '/dictionary',
  '/stories',
  '/weak-training',
  '/challenges',
  '/appearance',
  '/extended-test',
  '/admin',
  '/settings',
];
for (const width of [320, 390, 768]) {
  test(`screens fit ${width}px without client errors`, async ({ context }) => {
    test.setTimeout(90000);
    for (const route of routes) {
      // Independent direct entries: do not cancel Next prefetch by replacing a live document.
      // Client-side navigation is covered separately below.
      const screen = await context.newPage();
      const errors: string[] = [];
      screen.on('pageerror', (e) => errors.push(e.message));
      try {
        await screen.setViewportSize({ width, height: 844 });
        await screen.goto(route);
        await expect(
          screen.getByText('Обзор в браузере', { exact: false }),
        ).toBeVisible();
        await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(
          screen.getByRole('navigation', { name: 'Основная навигация' }),
        ).toBeVisible();
        expect(
          await screen.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          route,
        ).toBe(true);
        expect(errors, route).toEqual([]);
      } finally {
        await screen.close();
      }
    }
  });
}
test('navigation follows the real catalog, learning plan and profile screens', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation');
  for (const [label, path] of [
    ['Мои уроки', '/learn'],
    ['Все уроки', '/courses'],
    ['Повторение', '/review'],
    ['Premium', '/premium'],
    ['Профиль', '/profile'],
    ['Главная', '/'],
  ]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(
      nav.getByRole('link', { name: label, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  }
  await page.goto('/courses');
  await expect(
    page.getByRole('textbox', { name: 'Поиск уроков' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Мой учебный план', exact: true })
    .click();
  await expect(page).toHaveURL('/learning-plan');
  await page.goto('/leaderboard');
  await page
    .getByRole('link', { name: 'Друзья и приглашения', exact: true })
    .click();
  await expect(page).toHaveURL('/friends');
  await expect(
    page.getByText(/Войди через Telegram, чтобы увидеть рейтинг/),
  ).toBeVisible();
  await page.goto('/profile');
  await page.getByRole('link', { name: /Мои достижения/ }).click();
  await expect(page).toHaveURL('/achievements');
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await expect(page).toHaveURL('/settings');
});
test('settings switches reset and missing route', async ({ page }) => {
  await page.goto('/settings');
  const sound = page.getByRole('switch', { name: 'Звуки', exact: true });
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await page
    .getByRole('button', { name: 'Сбросить настройки', exact: true })
    .click();
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Страница не найдена' }),
  ).toBeVisible();
});

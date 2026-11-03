import { test, expect } from '@playwright/test';
const routes = [
  '/',
  '/learn',
  '/courses',
  '/lesson',
  '/placement',
  '/leaderboard',
  '/achievements',
  '/profile',
  '/friends',
  '/premium',
  '/admin',
  '/settings',
];
for (const width of [320, 390, 768]) {
  test(`screens fit ${width}px without client errors`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Основная навигация' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
test('navigation, course search and empty states', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation');
  for (const [label, path] of [
    ['Карта', '/learn'],
    ['Курсы', '/courses'],
    ['Рейтинг', '/leaderboard'],
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
  await page.getByRole('textbox', { name: 'Поиск курсов' }).fill('японский');
  await expect(page.getByText('Такого курса пока нет')).toBeVisible();
  await page.getByRole('textbox').fill('английский');
  await page.getByRole('link', { name: 'Продолжить путь' }).click();
  await expect(page).toHaveURL('/learn');
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
  await page.getByRole('button', { name: 'Сбросить настройки демо' }).click();
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Страница не найдена' }),
  ).toBeVisible();
});

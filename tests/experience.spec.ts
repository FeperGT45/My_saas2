import { test, expect } from '@playwright/test';
test('device preferences persist across navigation and reload, reset and sync across tabs', async ({
  page,
  context,
}) => {
  await page.goto('/settings');
  const effects = page.getByRole('switch', { name: 'Эффекты', exact: true });
  const haptics = page.getByRole('switch', {
    name: 'Виброотклик',
    exact: true,
  });
  await expect(effects).toHaveAttribute('aria-checked', 'true');
  await effects.click();
  await haptics.click();
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'off');
  await page.reload();
  await expect(effects).toHaveAttribute('aria-checked', 'false');
  await expect(haptics).toHaveAttribute('aria-checked', 'true');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Главная', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'off');
  const second = await context.newPage();
  await second.goto('/settings');
  await second
    .getByRole('button', { name: 'Сбросить настройки', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'on');
  await page.goto('/settings');
  await expect(haptics).toHaveAttribute('aria-checked', 'false');
});
test('disabled effects stop CSS animations and system reduced motion still wins', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/settings');
  await page.getByRole('switch', { name: 'Эффекты', exact: true }).click();
  const animation = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'finish-effect';
    document.body.append(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  expect(animation).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('switch', { name: 'Эффекты', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'finish-effect';
      document.body.append(el);
      const time = getComputedStyle(el).animationDuration;
      el.remove();
      return parseFloat(time);
    }),
  ).toBeLessThanOrEqual(0.001);
});
test('current device viewport and rotation retain access to settings and navigation', async ({
  page,
}) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const initial = page.viewportSize()!;
  for (const viewport of [
    initial,
    { width: initial.height, height: initial.width },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('switch', { name: 'Эффекты', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Premium', exact: true })
      .click();
    await expect(page).toHaveURL('/premium');
    await page.goto('/settings');
  }
});

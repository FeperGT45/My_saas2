import { test, expect } from '@playwright/test';
async function signedAccount(
  page: import('@playwright/test').Page,
  enabled: boolean,
) {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        user: {
          id: 'copy-review',
          name: 'Ученик',
          mode: 'telegram',
          telegramId: '123',
          avatarUrl: null,
        },
      },
    }),
  );
  await page.route(/\/api\/premium$/, (r) =>
    r.fulfill({
      json: {
        version: 'permissions-v1',
        plan: 'free',
        premium: false,
        status: 'free',
        startsAt: null,
        expiresAt: null,
        serverTime: new Date().toISOString(),
        autoRenew: false,
        features: {
          premium_courses: false,
          extra_exercises: false,
          advanced_statistics: false,
          lesson_review_plan: false,
        },
        enabled,
        amount: 149,
        termsUrl: 'https://example.com/premium/terms',
        supportUrl: 'https://t.me/Voklumi_bot',
      },
    }),
  );
}
test('weekly upsell offers the existing Premium plan without claiming payments are disabled', async ({
  page,
}) => {
  await signedAccount(page, true);
  await page.route('**/api/weekly-plan', (r) =>
    r.fulfill({ status: 403, json: { error: 'Нужен Premium' } }),
  );
  await page.route('**/api/learning-plan', (r) =>
    r.fulfill({
      status: 503,
      json: { error: 'Не удалось загрузить рекомендации' },
    }),
  );
  await page.goto('/learning-plan');
  await expect(
    page.getByRole('link', { name: 'Мой Premium', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Персональный план на неделю входит в Premium.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /платежи.*выключены|деморежим|на этом этапе/i,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const enabled of [true, false])
  test(`Premium reflects actual checkout availability (${enabled})`, async ({
    page,
  }) => {
    await signedAccount(page, enabled);
    await page.goto('/premium');
    await expect(
      page.getByText('Текущий доступ: Free', { exact: true }),
    ).toBeVisible();
    const pay = page.getByRole('button', {
      name: 'Открыть оплату Telegram Stars',
    });
    if (enabled) {
      await expect(
        page.getByText('Оплата временно недоступна.', { exact: false }),
      ).toHaveCount(0);
      await page.getByRole('checkbox').check();
      await expect(pay).toBeEnabled();
    } else {
      await expect(
        page.getByText('Оплата временно недоступна.', { exact: false }),
      ).toBeVisible();
      await expect(pay).toBeDisabled();
    }
    await expect(page.locator('body')).not.toContainText(
      /ожидает проверки|разрешения владельца|деморежим|вымышленного пользователя/,
    );
  });

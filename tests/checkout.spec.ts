import { test, expect, type Page } from '@playwright/test';
const user = {
  id: 'a0000000-0000-0000-0000-000000000001',
  telegramId: '123',
  name: 'Test buyer',
  avatarUrl: null,
  mode: 'telegram',
};
async function launch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, payload: string) => void;
      };
      Telegram?: {
        WebView?: { receiveEvent?: (event: string, data: unknown) => void };
      };
      outcome: string;
    };
    const params = new URLSearchParams({
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'android',
      tgWebAppThemeParams: '{}',
      tgWebAppData: new URLSearchParams({
        user: JSON.stringify({ id: 123, first_name: 'Test buyer' }),
        auth_date: String(Math.floor(Date.now() / 1000)),
        hash: 'isolated-fixture-not-a-signature',
        signature: 'isolated-fixture-not-a-signature',
      }).toString(),
    });
    window.location.hash = params.toString();
    w.outcome = 'paid';
    w.TelegramWebviewProxy = {
      postEvent(event, payload) {
        const emit = (type: string, data: unknown) =>
          queueMicrotask(() => w.Telegram?.WebView?.receiveEvent?.(type, data));
        if (event === 'web_app_request_viewport')
          emit('viewport_changed', {
            width: 390,
            height: 844,
            is_expanded: true,
            is_state_stable: true,
          });
        if (event === 'web_app_request_theme')
          emit('theme_changed', { theme_params: {} });
        if (event === 'web_app_request_safe_area')
          emit('safe_area_changed', { top: 0, bottom: 0, left: 0, right: 0 });
        if (event === 'web_app_request_content_safe_area')
          emit('content_safe_area_changed', {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          });
        if (event === 'web_app_open_invoice')
          emit('invoice_closed', {
            slug: JSON.parse(payload).slug,
            status: w.outcome,
          });
      },
    };
  });
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user } }));
  await page.route('**/api/auth/telegram', (r) =>
    r.fulfill({ json: { user } }),
  );
  await page.route('**/api/premium/features', (r) =>
    r.fulfill({ json: { completedAttempts: 0, accuracy: 0, reviewPlan: [] } }),
  );
}
function access(premium: boolean) {
  return {
    version: 'permissions-v1',
    plan: premium ? 'premium' : 'free',
    premium,
    status: premium ? 'active' : 'free',
    startsAt: premium ? new Date(Date.now() - 1000).toISOString() : null,
    expiresAt: premium
      ? new Date(Date.now() + 7 * 86400000).toISOString()
      : null,
    serverTime: new Date().toISOString(),
    autoRenew: false,
    features: {
      premium_courses: premium,
      extra_exercises: premium,
      advanced_statistics: premium,
      lesson_review_plan: premium,
    },
    enabled: true,
    amount: 149,
    termsUrl: 'https://example.com/terms',
    supportUrl: 'https://t.me/feper145',
  };
}
test('paid SDK callback waits for server confirmation, retries a transient failure and sends only plan/consent/idempotency key', async ({
  page,
}) => {
  await launch(page);
  let invoiced = false,
    checks = 0;
  await page.route(/\/api\/premium$/, (r) => {
    if (!invoiced) return r.fulfill({ json: access(false) });
    checks++;
    return checks === 1
      ? r.fulfill({ status: 503, json: { error: 'Временная ошибка' } })
      : r.fulfill({ json: access(checks >= 3) });
  });
  await page.route('**/api/premium/invoice', (r) => {
    expect(r.request().postDataJSON()).toEqual({
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      acceptTerms: true,
      plan: 'week',
    });
    invoiced = true;
    return r.fulfill({
      json: { invoiceUrl: 'https://t.me/$isolated_fixture' },
    });
  });
  await page.goto('/premium');
  await expect(
    page.getByText('Telegram · вход выполнен', { exact: false }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Неделя/ }).check();
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Открыть оплату Telegram Stars', exact: true })
    .click();
  await expect(
    page.getByText('Telegram сообщил об оплате.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Ожидаем подтверждение сервера',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole('status', { name: 'Статус Premium' }),
  ).not.toHaveText('Premium активен');
  await expect(
    page.getByText('Оплата подтверждена сервером. Premium активен!', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(checks).toBeGreaterThanOrEqual(3);
});
test('cancelled invoice can be retried with the same request ID and never grants Premium', async ({
  page,
}) => {
  await launch(page);
  await page.route(/\/api\/premium$/, (r) =>
    r.fulfill({ json: access(false) }),
  );
  const requests: string[] = [];
  await page.route('**/api/premium/invoice', (r) => {
    requests.push(r.request().postDataJSON().requestId);
    return r.fulfill({
      json: { invoiceUrl: 'https://t.me/$isolated_fixture' },
    });
  });
  await page.goto('/premium');
  await expect(
    page.getByText('Telegram · вход выполнен', { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { outcome: string }).outcome = 'cancelled';
  });
  await page.getByRole('checkbox').check();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('button', {
        name: 'Открыть оплату Telegram Stars',
        exact: true,
      })
      .click();
    await expect(
      page.getByText('Окно оплаты закрыто.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Открыть оплату Telegram Stars',
        exact: true,
      }),
    ).toBeEnabled();
  }
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  await expect(page.getByRole('status', { name: 'Статус Premium' })).toHaveText(
    'Текущий доступ: Free',
  );
});
test('delayed confirmation blocks duplicate purchase, stops fast polling and can be recovered manually', async ({
  page,
}) => {
  await launch(page);
  await page.clock.install();
  let confirmed = false;
  await page.route(/\/api\/premium$/, (r) =>
    r.fulfill({ json: access(confirmed) }),
  );
  let invoices = 0;
  await page.route('**/api/premium/invoice', (r) => {
    invoices++;
    return r.fulfill({
      json: { invoiceUrl: 'https://t.me/$isolated_fixture' },
    });
  });
  await page.goto('/premium');
  await expect(
    page.getByText('Telegram · вход выполнен', { exact: false }),
  ).toBeVisible();
  await page.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Открыть оплату Telegram Stars', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Ожидаем подтверждение сервера',
      exact: true,
    }),
  ).toBeDisabled();
  await page.clock.fastForward(31000);
  await expect(
    page.getByText('Подтверждение задерживается.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Ожидаем подтверждение сервера',
      exact: true,
    }),
  ).toBeDisabled();
  expect(invoices).toBe(1);
  confirmed = true;
  await page
    .getByRole('button', { name: 'Проверить статус', exact: true })
    .click();
  await page.clock.runFor(20);
  await expect(page.getByRole('status', { name: 'Статус Premium' })).toHaveText(
    'Premium активен',
  );
  expect(invoices).toBe(1);
});

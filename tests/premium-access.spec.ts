import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';

test('real APIs enforce Free/Premium, expiry, feature switches and reactivation while the hook keeps payments disabled', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
  });
  const page = await context.newPage();
  try {
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.student,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const api = (path: string) => context.request.get(server.origin + path);
    expect((await api('/api/premium/features')).status()).toBe(403);
    expect(
      (
        await context.request.post(server.origin + '/api/premium', {
          headers: { Origin: server.origin },
          data: { premium: true, plan: 'premium', userId: server.student },
        })
      ).status(),
    ).toBe(405);
    expect(
      (
        await context.request.get(server.origin + '/api/premium/features', {
          headers: {
            'x-premium': 'true',
            'x-user-id': server.admin,
            'x-role': 'admin',
          },
        })
      ).status(),
    ).toBe(403);
    expect((await api('/api/premium?userId=' + server.admin)).status()).toBe(
      400,
    );
    await page.goto(server.origin + '/premium');
    await expect(
      page.getByText('Текущий доступ: Free', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Открыть оплату Telegram Stars' }),
    ).toBeDisabled();
    const lesson = '40000000-0000-0000-0000-000000000001';
    await server.db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,80)',
      [server.student, lesson],
    );
    const before = (
      await server.db.query(
        'SELECT * FROM public.user_progress WHERE user_id=$1',
        [server.student],
      )
    ).rows;
    const id = randomUUID();
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      id,
      'Stage 1 isolated test',
    ]);
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page.getByRole('status', { name: 'Статус Premium' }),
    ).toHaveText('Premium активен');
    await expect(
      page.getByRole('heading', { name: 'Твой учебный ритм' }),
    ).toBeVisible();
    expect((await api('/api/premium/features')).status()).toBe(200);
    await server.db.exec(
      "UPDATE public.subscription_features SET enabled=false WHERE key='advanced_statistics'",
    );
    expect((await api('/api/premium/features')).status()).toBe(403);
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page.getByRole('heading', { name: 'Твой учебный ритм' }),
    ).toHaveCount(0);
    await server.db.exec(
      'UPDATE public.subscription_features SET enabled=true',
    );
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '1 day',ends_at=now()+interval '4 seconds' WHERE id=$1",
      [id],
    );
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page.getByRole('status', { name: 'Статус Premium' }),
    ).toHaveText('Premium активен');
    await expect(
      page.getByRole('status', { name: 'Статус Premium' }),
    ).toHaveText('Период завершён · Free', { timeout: 15000 });
    await expect(page.getByText(/Прогресс сохранён/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Твой учебный ритм' }),
    ).toHaveCount(0);
    expect((await api('/api/premium/features')).status()).toBe(403);
    expect(
      (
        await server.db.query(
          'SELECT * FROM public.user_progress WHERE user_id=$1',
          [server.student],
        )
      ).rows,
    ).toEqual(before);
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Stage 1 reactivation',
    ]);
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page.getByRole('status', { name: 'Статус Premium' }),
    ).toHaveText('Premium активен');
    expect((await api('/api/premium/features')).status()).toBe(200);
    await expect(
      page.getByRole('button', { name: 'Premium активен', exact: true }),
    ).toBeDisabled();
    expect(
      (
        await context.request.post(server.origin + '/api/premium/invoice', {
          headers: { Origin: server.origin },
          data: { requestId: randomUUID(), acceptTerms: true },
        })
      ).status(),
    ).toBe(503);
    await page.route('**/api/premium', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'Проверка Premium недоступна' },
      }),
    );
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Проверка Premium недоступна' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Твой учебный ритм' }),
    ).toHaveCount(0);
    await context.clearCookies();
    expect((await api('/api/premium/features')).status()).toBe(401);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Твой учебный ритм' }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await server.close();
  }
});

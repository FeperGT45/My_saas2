import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import type { ExtendedData } from '../src/lib/placement/extended';
test.use({ actionTimeout: 15000 });
test('appearance, 36-question assessment and signed Stars delivery work on isolated real API without spending Stars', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const s = await adminServer({ currentCatalog: true, billingWebhook: true }),
    c = await browser.newContext({
      viewport: { width: 320, height: 844 },
      reducedMotion: 'reduce',
    }),
    p = await c.newPage(),
    headers = { Origin: s.origin };
  const post = (path: string, data: unknown) =>
    c.request.post(s.origin + path, { headers, data });
  try {
    await c.addCookies([
      {
        name: '__Host-voklumi_session',
        value: s.tokens.student,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await p.goto(s.origin + '/appearance');
    await expect(
      p.getByRole('button', { name: 'Сохранить оформление' }),
    ).toBeVisible();
    await p.getByRole('button', { name: 'Slate Free', exact: true }).click();
    await p.getByRole('button', { name: 'Сохранить оформление' }).click();
    await expect(p.locator('[data-ui-theme="slate"]')).toBeVisible();
    expect(
      (
        await post('/api/appearance', {
          settings: {
            theme: 'sakura',
            frame: 'orbit',
            badge: 'star',
            effect: 'spark',
            decoration: 'grid',
          },
          version: 1,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await post('/api/premium/invoice', {
          requestId: randomUUID(),
          acceptTerms: true,
        })
      ).status(),
    ).toBe(503);
    const order = (
      await s.db.query<{ data: { payload: string } }>(
        'SELECT public.create_star_order($1,$2,99) AS data',
        [s.student, randomUUID()],
      )
    ).rows[0].data;
    await s.db.query(
      "SELECT public.check_star_checkout($1,456,'XTR',99,'isolated-checkout')",
      [order.payload],
    );
    const receipt = {
      message: {
        chat: { id: 456, type: 'private' },
        from: { id: 456 },
        successful_payment: {
          currency: 'XTR',
          total_amount: 99,
          invoice_payload: order.payload,
          telegram_payment_charge_id: 'isolated-charge',
        },
      },
    };
    expect((await post('/api/telegram/webhook', receipt)).status()).toBe(403);
    const webhook = (body: unknown) =>
      c.request.post(s.origin + '/api/telegram/webhook', {
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'x'.repeat(32) },
        data: body,
      });
    expect(
      (
        await webhook({
          ...receipt,
          message: {
            ...receipt.message,
            successful_payment: {
              ...receipt.message.successful_payment,
              total_amount: 1,
            },
          },
        })
      ).status(),
    ).toBe(503);
    expect(
      (await (await c.request.get(s.origin + '/api/premium')).json()).premium,
    ).toBe(false);
    expect((await webhook(receipt)).status()).toBe(200);
    expect((await webhook(receipt)).status()).toBe(200);
    expect(
      (
        await s.db.query(
          'SELECT id FROM public.subscriptions WHERE user_id=$1',
          [s.student],
        )
      ).rows,
    ).toHaveLength(1);
    await p.reload();
    await p
      .getByRole('button', { name: 'Sakura Premium', exact: true })
      .click();
    await p.getByLabel('Рамка', { exact: true }).selectOption('orbit');
    await p.getByLabel('Значок', { exact: true }).selectOption('star');
    await p.getByRole('button', { name: 'Сохранить оформление' }).click();
    await expect(p.locator('[data-ui-theme="sakura"]')).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: p })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await p.screenshot({
      path: 'test-results/appearance-mobile.png',
      fullPage: true,
    });
    expect(
      await p
        .locator('.appearance-avatar')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).animationDuration)),
    ).toBeLessThan(0.1);
    await p.goto(s.origin + '/extended-test');
    await p
      .getByRole('button', { name: 'Начать расширенный тест', exact: true })
      .click();
    await expect(
      p.getByRole('button', { name: 'Сохранить ответ', exact: true }),
    ).toBeVisible();
    let d = (await (
      await c.request.get(s.origin + '/api/extended-test')
    ).json()) as ExtendedData;
    const raw = (
      await s.db.query<{ current: { correct_option: string } }>(
        'SELECT current FROM public.extended_attempts WHERE id=$1',
        [d.id],
      )
    ).rows[0].current;
    await p
      .getByRole('button', {
        name: d.question!.options.find((o) => o.id === raw.correct_option)!
          .label,
        exact: true,
      })
      .click();
    await p
      .getByRole('button', { name: 'Сохранить ответ', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await c.request.get(s.origin + '/api/extended-test')).json())
            .answered,
      )
      .toBe(1);
    await p.reload();
    d = (await (
      await c.request.get(s.origin + '/api/extended-test')
    ).json()) as ExtendedData;
    expect(d.answered).toBe(1);
    while (d.question) {
      const key = (
        await s.db.query<{ current: { correct_option: string } }>(
          'SELECT current FROM public.extended_attempts WHERE id=$1',
          [d.id],
        )
      ).rows[0].current;
      const r = await post('/api/extended-test', {
        action: 'answer',
        attemptId: d.id,
        questionId: d.question.id,
        requestId: randomUUID(),
        option: key.correct_option,
      });
      expect(r.status()).toBe(200);
      d = await r.json();
    }
    await p.reload();
    await expect(
      p.getByRole('heading', { name: /Твой ориентир:/ }),
    ).toBeVisible();
    expect(d.review).toHaveLength(36);
    expect(
      (
        await new AxeBuilder({ page: p })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await p.screenshot({
      path: 'test-results/extended-result.png',
      fullPage: true,
    });
    await p.goto(s.origin + '/premium');
    await expect(
      p.getByText('Premium активен', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      p.getByRole('button', { name: 'Premium активен', exact: true }),
    ).toBeDisabled();
    await expect(
      p.getByRole('heading', { name: 'Premium в действии' }),
    ).toBeVisible();
    await expect(
      p.getByRole('link', { name: 'Посмотреть возможность →' }),
    ).toHaveCount(8);
    expect(
      (
        await webhook({
          message: {
            chat: { id: 456, type: 'private' },
            refunded_payment: receipt.message.successful_payment,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await c.request.get(s.origin + '/api/premium')).json()).premium,
    ).toBe(false);
    expect(
      (await c.request.get(s.origin + '/api/extended-test')).status(),
    ).toBe(403);
    const appearance = await (
      await c.request.get(s.origin + '/api/appearance')
    ).json();
    expect(appearance.saved.theme).toBe('sakura');
    expect(appearance.effective.theme).toBe('base');
    await c.clearCookies();
    await c.addCookies([
      {
        name: '__Host-voklumi_session',
        value: s.tokens.admin,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await s.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      s.admin,
      randomUUID(),
      'Other isolated reader',
    ]);
    expect(
      (
        await c.request.get(s.origin + '/api/extended-test?attempt=' + d.id)
      ).status(),
    ).toBe(404);
  } finally {
    await c.close();
    await s.close();
  }
});
test('new pages render on configured runtime and protected endpoints deny anonymous users', async ({
  page,
  request,
}) => {
  for (const path of ['/appearance', '/extended-test', '/premium']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
  }
  expect((await request.get('/api/appearance')).status()).toBe(401);
  expect((await request.get('/api/extended-test')).status()).toBe(401);
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
test('real server restricts admin page/API and mobile editor saves validated content with confirmation', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  // __Host- prefix accepts secure cookies on loopback Chromium; requests use the same real server session.
  async function login(token: string) {
    await context.clearCookies();
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: token,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  }
  try {
    expect(
      (
        await context.request.get(`${server.origin}/api/admin?view=users`)
      ).status(),
    ).toBe(401);
    for (const token of [server.tokens.student, server.tokens.expired]) {
      await login(token);
      const response = await context.request.get(
        `${server.origin}/api/admin?view=users`,
      );
      expect(response.status()).toBe(
        token === server.tokens.expired ? 401 : 403,
      );
      expect(await response.text()).not.toContain('Owner');
      await page.goto(`${server.origin}/admin`);
      await expect(
        page.getByRole('heading', { name: 'Доступ ограничен', exact: true }),
      ).toBeVisible();
      expect(await page.content()).not.toContain('Правильный вариант');
      expect(
        (
          await context.request.post(`${server.origin}/api/admin`, {
            headers: { origin: server.origin },
            data: { role: 'admin' },
          })
        ).status(),
      ).toBe(token === server.tokens.expired ? 401 : 403);
    }
    await login(server.tokens.admin);
    expect(
      (
        await context.request.get(`${server.origin}/api/admin?view=overview`)
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.post(`${server.origin}/api/admin`, {
          headers: { origin: 'https://evil.test' },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.goto(`${server.origin}/admin`);
    await expect(
      page.getByText('Всего учеников', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('admin-mobile.png') });
    const tabs = page.getByRole('navigation', {
      name: 'Разделы администратора',
    });
    await tabs.getByRole('button', { name: 'Контент', exact: true }).click();
    await page
      .getByRole('button', { name: 'Создать курс', exact: true })
      .click();
    await page.getByLabel('Название', { exact: true }).fill('Travel English');
    await page.getByLabel('Slug курса').fill('travel-english');
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page
      .getByRole('button', { name: 'Сохранить с подтверждением' })
      .click();
    expect(
      (
        await server.db.query(
          "SELECT id FROM public.courses WHERE slug='travel-english'",
        )
      ).rows.length,
    ).toBe(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('button', { name: 'Сохранить с подтверждением' })
      .click();
    await expect(
      page.getByText('Изменения сохранены. Действие записано в журнал.'),
    ).toBeVisible();
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Travel English', exact: true }),
    });
    await card.getByRole('button', { name: 'Разделы', exact: true }).click();
    await page
      .getByRole('button', { name: 'Создать раздел', exact: true })
      .click();
    await page.getByLabel('Название', { exact: true }).fill('На вокзале');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('button', { name: 'Сохранить с подтверждением' })
      .click();
    await page.getByRole('button', { name: 'Уроки', exact: true }).click();
    await page
      .getByRole('button', { name: 'Создать урок', exact: true })
      .click();
    await page.getByLabel('Название', { exact: true }).fill('Купить билет');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('button', { name: 'Сохранить с подтверждением' })
      .click();
    await page.getByRole('button', { name: 'Задания', exact: true }).click();
    await page
      .getByRole('button', { name: 'Создать задание', exact: true })
      .click();
    await page
      .getByLabel('Формулировка', { exact: true })
      .fill('Как сказать «билет»?');
    await page.getByLabel('Вариант 1', { exact: true }).fill('ticket');
    await page.getByLabel('Вариант 2', { exact: true }).fill('window');
    await page
      .getByLabel('Объяснение ответа', { exact: true })
      .fill('Ticket означает билет.');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .getByRole('button', { name: 'Сохранить с подтверждением' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Как сказать «билет»?', exact: true }),
    ).toBeVisible();
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM public.admin_audit_events',
        )
      ).rows[0].n,
    ).toBe(4);
    for (const tab of ['Ученики', 'Активность', 'Подписки', 'Журнал']) {
      await tabs.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByText('Загружаем данные…')).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Expiring the session closes the real API even while the browser still has the cookie.
    await server.db.query(
      "UPDATE public.telegram_sessions SET expires_at=now()-interval '1 hour' WHERE user_id=$1",
      [server.admin],
    );
    expect(
      (
        await context.request.get(
          `${server.origin}/api/admin?view=exercises&parent=${randomUUID()}`,
        )
      ).status(),
    ).toBe(401);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Доступ ограничен', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await server.close();
  }
});

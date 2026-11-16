import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
test('privacy policy and support are available outside Telegram at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/settings');
  await page
    .getByRole('link', { name: 'Конфиденциальность и удаление аккаунта →' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Конфиденциальность', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Если вход недоступен, напиши @feper145', { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('real deletion API keeps ownership, confirms intent, deduplicates replay and preserves progress; ordinary users cannot read the queue', async ({
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
    const post = (body: unknown, origin = server.origin) =>
      context.request.post(server.origin + '/api/privacy/deletion', {
        headers: { Origin: origin },
        data: body,
      });
    const profiles = (
      await server.db.query('SELECT * FROM public.users ORDER BY id')
    ).rows;
    const progress = (
      await server.db.query('SELECT * FROM public.user_progress')
    ).rows;
    expect(
      (await post({ requestId: randomUUID(), confirm: false })).status(),
    ).toBe(400);
    expect(
      (
        await post({
          requestId: randomUUID(),
          confirm: true,
          userId: server.admin,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await post(
          { requestId: randomUUID(), confirm: true },
          'https://attacker.test',
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.get(server.origin + '/api/admin/privacy', {
          headers: { 'x-role': 'admin' },
        })
      ).status(),
    ).toBe(403);
    await page.goto(server.origin + '/privacy');
    await expect(
      page.getByRole('button', { name: 'Отправить запрос на удаление' }),
    ).toBeDisabled();
    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: 'Отправить запрос на удаление' })
      .click();
    await expect(
      page.getByText('Заявка принята', { exact: false }),
    ).toBeVisible();
    const first = await (
      await context.request.get(server.origin + '/api/privacy/deletion')
    ).json();
    const replay = await (
      await post({ requestId: randomUUID(), confirm: true })
    ).json();
    expect(replay).toEqual(first);
    await page.reload();
    await expect(
      page.getByText('Заявка принята', { exact: false }),
    ).toBeVisible();
    expect(
      (
        await server.db.query(
          'SELECT user_id FROM public.privacy_deletion_requests',
        )
      ).rows,
    ).toEqual([{ user_id: server.student }]);
    expect(
      (await server.db.query('SELECT * FROM public.users ORDER BY id')).rows,
    ).toEqual(profiles);
    expect(
      (await server.db.query('SELECT * FROM public.user_progress')).rows,
    ).toEqual(progress);
    await context.clearCookies();
    expect(
      (
        await context.request.get(server.origin + '/api/privacy/deletion')
      ).status(),
    ).toBe(401);
    expect(
      (
        await context.request.get(server.origin + '/api/admin/privacy')
      ).status(),
    ).toBe(401);
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.admin,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const admin = await context.request.get(
      server.origin + '/api/admin/privacy',
    );
    expect(admin.status()).toBe(200);
    expect((await admin.json()).requests).toHaveLength(1);
    await page.goto(server.origin + '/admin/privacy');
    await expect(
      page.getByText('Заявка ' + first.request.id, { exact: true }),
    ).toBeVisible();
    await page.goto(server.origin + '/admin/operations');
    await expect(
      page.getByRole('heading', { name: 'Мониторинг Voklumi', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Серверных ошибок пока не зарегистрировано.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await context.request.post(server.origin + '/api/ops/check', {
          headers: { Authorization: 'Bearer forged.token.value' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await (
          await context.request.get(server.origin + '/api/privacy/deletion')
        ).json()
      ).request,
    ).toBeNull();
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('link', { name: 'Профиль', exact: true })
      .click();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Выйти', exact: true }),
    ).toHaveCount(0);
    await page.goBack();
    await expect(
      page.getByText('Серверных ошибок пока не зарегистрировано.', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Доступ ограничен', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await server.close();
  }
});

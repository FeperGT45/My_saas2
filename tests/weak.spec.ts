import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import { weakTopics, weakLesson } from './helpers/weak-fixture';
import type { WeakState, WeakDashboard } from '../src/lib/learning/weak';
test('weak training uses real history, persists answers, awards improvement XP and keeps progress private', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer({ currentCatalog: true });
  const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage();
  const url = server.origin + '/api/weak-training',
    headers = { Origin: server.origin };
  const post = (data: unknown) => context.request.post(url, { headers, data });
  try {
    expect(
      (
        await post({ action: 'start', topicId: null, requestId: randomUUID() })
      ).status(),
    ).toBe(401);
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
    expect(
      ((await (await context.request.get(url)).json()) as WeakDashboard)
        .premium,
    ).toBe(false);
    expect(
      (
        await post({ action: 'start', topicId: null, requestId: randomUUID() })
      ).status(),
    ).toBe(403);
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Weak UI test grant',
    ]);
    await page.goto(server.origin + '/weak-training');
    await expect(
      page.getByRole('heading', { name: 'Пока мало данных об ошибках' }),
    ).toBeVisible();
    const topics = await weakTopics(server.db);
    await weakLesson(server.db, server.student, topics[0]);
    await weakLesson(server.db, server.student, topics[1], 0);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Сейчас стоит повторить' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Формы be', exact: true }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/weak-topics.png',
      fullPage: true,
    });
    await page
      .getByRole('combobox', { name: 'Тема', exact: true })
      .selectOption(topics[0]);
    await page
      .getByRole('button', { name: 'Начать по теме', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: '1 I am ready.', exact: true }),
    ).toBeVisible();
    const getRun = async () =>
      (await (
        await context.request.get(
          url + '?run=' + new URL(page.url()).searchParams.get('run'),
        )
      ).json()) as WeakState;
    const initial = await getRun();
    expect(initial.total).toBe(6);
    let dropped = false;
    await page.route('**/api/weak-training', async (route) => {
      if (
        !dropped &&
        route.request().method() === 'POST' &&
        route.request().postDataJSON().action === 'answer'
      ) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page
      .getByRole('button', { name: '1 I am ready.', exact: true })
      .click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
    expect((await getRun()).answered).toBe(1);
    await page.unroute('**/api/weak-training');
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole('button', { name: '1 I am ready.', exact: true }),
    ).toBeVisible();
    let s = await getRun();
    expect(s.answered).toBe(1);
    while (s.exercise) {
      await page
        .getByRole('button', { name: '1 I am ready.', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Проверить', exact: true })
        .click();
      await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
      await page
        .getByRole('button', {
          name: s.answered + 1 === s.total ? 'Показать результат' : 'Дальше',
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await getRun()).answered)
        .toBe(s.answered + 1);
      s = await getRun();
    }
    expect(s).toMatchObject({
      xp: 15,
      before: 40,
      after: 100,
      status: 'completed',
    });
    await expect(
      page.getByRole('heading', { name: 'Тренировка завершена', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/weak-result.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Вернуться к темам' }).click();
    await expect(
      page.getByText('Выраженных слабых тем сейчас нет', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Начать по теме', exact: true }),
    ).toBeDisabled();
    expect(
      (
        await post({
          action: 'start',
          topicId: topics[0],
          requestId: randomUUID(),
        })
      ).status(),
    ).toBe(422);
    await weakLesson(server.db, server.student, topics[0], 3, 8);
    const run = (await (
      await post({
        action: 'start',
        topicId: topics[0],
        requestId: randomUUID(),
      })
    ).json()) as WeakState;
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.student],
    );
    await page.goto(server.origin + '/weak-training?run=' + run.id);
    await expect(
      page.getByRole('heading', { name: 'Продолжение сейчас недоступно' }),
    ).toBeVisible();
    expect(
      (
        await post({
          action: 'answer',
          runId: run.id,
          position: 1,
          requestId: randomUUID(),
          answer: 'a',
        })
      ).status(),
    ).toBe(403);
    await context.clearCookies();
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
    expect((await context.request.get(url + '?run=' + run.id)).status()).toBe(
      404,
    );
  } finally {
    await context.close();
    await server.close();
  }
});
test('weak training entry point works on configured runtime and denies anonymous access', async ({
  page,
  request,
}) => {
  await page.goto('/weak-training');
  await expect(
    page.getByRole('heading', { name: 'Тренировка слабых тем', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вход и профиль →' }),
  ).toBeVisible();
  expect((await request.get('/api/weak-training')).status()).toBe(401);
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import type { StoryState, StoryCatalog } from '../src/lib/stories/types';
test('stories save real choices, recover a lost response, award endings and enforce Premium and ownership', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer({ currentCatalog: true });
  const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage();
  const url = server.origin + '/api/stories',
    headers = { Origin: server.origin };
  const post = (data: unknown) => context.request.post(url, { headers, data });
  try {
    expect((await context.request.get(url)).status()).toBe(401);
    expect(
      (
        await post({
          action: 'start',
          slug: 'first-school-day',
          requestId: randomUUID(),
        })
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
    const catalog = (await (
      await context.request.get(url)
    ).json()) as StoryCatalog;
    expect(catalog.stories).toHaveLength(5);
    expect(catalog.stories.filter((s) => s.accessible)).toHaveLength(1);
    expect(
      (
        await post({
          action: 'start',
          slug: 'online-friend',
          requestId: randomUUID(),
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await post({
          action: 'start',
          slug: 'first-school-day',
          requestId: randomUUID(),
          premium: true,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(url, {
          headers: { Origin: 'https://foreign.example' },
          data: {
            action: 'start',
            slug: 'first-school-day',
            requestId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(403);
    await page.goto(server.origin + '/stories');
    await expect(
      page.getByRole('heading', { name: 'Первый день в школе', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Открыть с Premium' }),
    ).toHaveCount(4);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/stories-catalog.png',
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Читать историю', exact: true })
      .click();
    await expect(page.getByText('Narrator', { exact: true })).toBeVisible();
    await page.getByText('Слова и подсказки', { exact: true }).click();
    await expect(
      page.getByText('школьный звонок', { exact: true }),
    ).toBeVisible();
    const getRun = async () => {
      const id = new URL(page.url()).searchParams.get('attempt')!;
      return (await (
        await context.request.get(url + '?attempt=' + id)
      ).json()) as StoryState;
    };
    let s = await getRun();
    let dropped = false;
    await page.route('**/api/stories', async (route) => {
      if (
        !dropped &&
        route.request().method() === 'POST' &&
        route.request().postDataJSON().action === 'choose'
      ) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    const choiceButton = () =>
      page.getByRole('region', { name: 'Выбор реплики' }).getByRole('button');
    await choiceButton().first().click();
    await expect(page.getByRole('alert')).toBeVisible();
    await choiceButton().first().click();
    await expect(page.getByText('Ben', { exact: true })).toBeVisible();
    s = await getRun();
    expect(s).toMatchObject({ version: 1, nodeId: 'n2' });
    await page.unroute('**/api/stories');
    // Take both the narrative and educational alternative branches.
    while (s.status === 'active') {
      if (s.nodeId === 'n8') {
        await page.reload();
        await expect(
          page.getByRole('button', {
            name: 'Let us look in the garden.',
            exact: true,
          }),
        ).toBeVisible();
        expect((await getRun()).version).toBe(s.version);
      }
      const index = ['n5', 'n8', 'n12', 'n16'].includes(s.nodeId) ? 1 : 0;
      const oldVersion = s.version;
      await choiceButton().nth(index).click();
      await expect
        .poll(async () => (await getRun()).version)
        .toBe(oldVersion + 1);
      s = await getRun();
      if (s.feedback)
        await expect(
          page.getByText(s.feedback.explanation, { exact: true }),
        ).toBeVisible();
    }
    expect(s).toMatchObject({
      nodeId: 'n19',
      correct: 0,
      answered: 2,
      newEnding: true,
    });
    await expect(
      page.getByRole('heading', { name: 'Дружба после обеда', exact: true }),
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
      path: 'test-results/stories-ending.png',
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Перепройти историю', exact: true })
      .click();
    await expect(page.getByText('Narrator', { exact: true })).toBeVisible();
    expect((await getRun()).version).toBe(0);
    await page
      .getByRole('button', { name: '← Все истории', exact: true })
      .click();
    await expect(
      page.getByText('Значок «Второй шанс»', { exact: true }),
    ).toBeVisible();
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Isolated stories UI test',
    ]);
    const premium = (await (
      await post({
        action: 'start',
        slug: 'online-friend',
        requestId: randomUUID(),
      })
    ).json()) as StoryState;
    await page.goto(server.origin + '/stories?attempt=' + premium.id);
    await expect(
      page.getByRole('heading', {
        name: 'Новый друг в интернете',
        exact: true,
      }),
    ).toBeVisible();
    await choiceButton().first().click();
    await expect.poll(async () => (await getRun()).version).toBe(1);
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.student],
    );
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Продолжение доступно с Premium' }),
    ).toBeVisible();
    expect((await getRun()).node).toBeNull();
    expect(
      (
        await post({
          action: 'choose',
          attemptId: premium.id,
          requestId: randomUUID(),
          version: 1,
          choiceId: 'a',
        })
      ).status(),
    ).toBe(403);
    expect(
      ((await (await context.request.get(url)).json()) as StoryCatalog).endings,
    ).toHaveLength(1);
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Isolated stories reactivation',
    ]);
    await page
      .getByRole('button', { name: 'Проверить доступ', exact: true })
      .click();
    await expect(page.getByText('CloudFox', { exact: true })).toBeVisible();
    expect((await getRun()).version).toBe(1);
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
    expect(
      (await context.request.get(url + '?attempt=' + premium.id)).status(),
    ).toBe(404);
    expect(
      ((await (await context.request.get(url)).json()) as StoryCatalog).endings,
    ).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
test('stories entry point works on configured runtime and rejects anonymous reads and writes', async ({
  page,
  request,
}) => {
  await page.goto('/stories');
  await expect(
    page.getByRole('heading', { name: 'Интерактивные истории', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вход и профиль →', exact: true }),
  ).toBeVisible();
  expect((await request.get('/api/stories')).status()).toBe(401);
  const response = await request.post('/api/stories', {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      action: 'start',
      slug: 'first-school-day',
      requestId: randomUUID(),
    },
  });
  // A preview without APP_URL rejects the origin before it checks the session.
  expect([401, 403]).toContain(response.status());
});

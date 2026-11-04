import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import { weakTopics } from './helpers/weak-fixture';
import type { Challenges, SprintState } from '../src/lib/learning/challenges';
test('challenges verify progress, grant cosmetic once, equip profile and preserve a relaxed sprint', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer({ currentCatalog: true });
  await weakTopics(server.db);
  const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage();
  const url = server.origin + '/api/challenges',
    headers = { Origin: server.origin },
    post = (data: unknown) => context.request.post(url, { headers, data });
  try {
    expect((await context.request.get(url)).status()).toBe(401);
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
      (
        await post({
          action: 'enroll',
          code: 'one-story',
          requestId: randomUUID(),
        })
      ).status(),
    ).toBe(403);
    await page.goto(server.origin + '/challenges');
    await expect(
      page.getByRole('heading', { name: 'Дополнительные цели с Premium' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Базовые достижения →' }),
    ).toBeVisible();
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Challenges UI test',
    ]);
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: 'Участвовать · Своя развязка',
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
        .violations,
    ).toEqual([]);
    await page
      .getByRole('button', { name: 'Участвовать · Своя развязка', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Выбрать историю →' }),
    ).toBeVisible();
    const d = (await (await context.request.get(url)).json()) as Challenges,
      entry = d.enrollments.find((e) => e.code === 'one-story')!;
    expect(
      (await post({ action: 'claim', enrollmentId: entry.id })).status(),
    ).toBe(422);
    let story = (
      await server.db.query<{
        s: { id: string; version: number; status: string };
      }>('SELECT public.story_start($1,$2,$3) AS s', [
        server.student,
        'first-school-day',
        randomUUID(),
      ])
    ).rows[0].s;
    while (story.status === 'active')
      story = (
        await server.db.query<{ s: typeof story }>(
          'SELECT public.story_choose($1,$2,$3,$4,$5) AS s',
          [server.student, story.id, randomUUID(), story.version, 'a'],
        )
      ).rows[0].s;
    await page.reload();
    await page
      .getByRole('button', {
        name: 'Получить награду · Своя развязка',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('status', { name: 'Испытание завершено' }),
    ).toBeVisible();
    expect(
      (await (await post({ action: 'claim', enrollmentId: entry.id })).json())
        .awarded,
    ).toBe(false);
    await page
      .getByRole('button', { name: 'Выбрать · Рассказчик', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Снять · Рассказчик', exact: true }),
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
    await page
      .getByRole('region', { name: 'Косметические награды' })
      .screenshot({ path: 'test-results/challenges-collection.png' });
    await page.screenshot({
      path: 'test-results/challenges-rewards.png',
      fullPage: true,
    });
    await page.goto(server.origin + '/profile');
    await expect(
      page.getByRole('heading', { name: 'Мой стиль', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Рассказчик', { exact: true })).toBeVisible();
    await page.goto(server.origin + '/challenges');
    await page
      .getByRole('button', {
        name: 'Участвовать · Пять минут для себя',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: 'Открыть короткую практику', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Скрыть время', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Скрыть время', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Показать время', exact: true }),
    ).toBeVisible();
    const runId = new URL(page.url()).searchParams.get('sprint')!;
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Скрыть время', exact: true }),
    ).toBeVisible();
    const s = (await (
      await context.request.get(url + '?view=sprint&run=' + runId)
    ).json()) as SprintState;
    expect(s.answered).toBe(0);
    await server.db.query(
      "UPDATE public.challenge_sprints SET created_at=now()-interval '20 minutes' WHERE id=$1",
      [runId],
    );
    await page.reload();
    await expect(
      page.getByText('Можно спокойно продолжать. Награда остаётся той же.', {
        exact: true,
      }),
    ).toBeVisible();
    for (let position = 1; position <= 5; position++) {
      const row = (
        await server.db.query<{ answer_key: { value: string } }>(
          'SELECT answer_key FROM public.challenge_sprint_items WHERE run_id=$1 AND position=$2',
          [runId, position],
        )
      ).rows[0];
      expect(
        (
          await post({
            action: 'sprint_answer',
            runId,
            position,
            requestId: randomUUID(),
            answer: row.answer_key.value,
          })
        ).status(),
      ).toBe(200);
    }
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Короткая практика завершена' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'К наградам', exact: true }).click();
    await page
      .getByRole('button', {
        name: 'Получить награду · Пять минут для себя',
        exact: true,
      })
      .click();
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.student],
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Снять · Рассказчик', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Снять · Рассказчик', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Выбрать · Рассказчик', exact: true }),
    ).toBeVisible();
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
      (await context.request.get(url + '?view=sprint&run=' + runId)).status(),
    ).toBe(404);
  } finally {
    await context.close();
    await server.close();
  }
});
test('challenges entry point renders on configured runtime and denies anonymous access', async ({
  page,
  request,
}) => {
  await page.goto('/challenges');
  await expect(
    page.getByRole('heading', { name: 'Испытания и награды', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вход и профиль →' }),
  ).toBeVisible();
  expect((await request.get('/api/challenges')).status()).toBe(401);
});

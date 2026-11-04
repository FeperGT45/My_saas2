import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import type { EnglishAnalytics } from '../src/lib/learning/analytics';
test('analytics protects ownership, shows real data and empty states, switches periods and revokes expired access', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const url = server.origin + '/api/analytics';
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
    expect((await context.request.get(url)).status()).toBe(403);
    expect(
      (await context.request.get(server.origin + '/api/game')).status(),
    ).toBe(200);
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Isolated analytics browser test',
    ]);
    const empty = await context.request.get(url + '?days=90');
    expect(empty.status()).toBe(200);
    const blank = (await empty.json()) as EnglishAnalytics;
    expect(blank.current.accuracy).toBeNull();
    expect(blank.daily).toHaveLength(90);
    expect(empty.headers()['cache-control']).toBe('no-store');
    expect(
      (await context.request.get(url + '?userId=' + server.admin)).status(),
    ).toBe(400);
    expect((await context.request.get(url + '?days=365')).status()).toBe(400);
    await page.goto(server.origin + '/analytics');
    await expect(
      page.getByRole('heading', {
        name: 'Пока недостаточно данных',
        exact: true,
      }),
    ).toBeVisible();
    const lesson = '40000000-0000-0000-0000-000000000001';
    for (const [days, correct] of [
      [0, 8],
      [35, 4],
    ]) {
      const id = randomUUID();
      await server.db.query(
        "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,started_at) VALUES($1,$2,$3,now()-$4::integer*interval '1 day'-interval '10 minutes')",
        [id, server.student, lesson, days],
      );
      for (let i = 1; i <= 10; i++) {
        await server.db.query(
          "INSERT INTO public.lesson_attempt_items(attempt_id,position,exercise_id,kind,prompt,payload,answer_key,explanation) VALUES($1,$2,$3,$4,'test prompt','{}','{\"key\":\"PRIVATE_KEY\"}','private explanation')",
          [
            id,
            i,
            randomUUID(),
            ['grammar', 'translation', 'reading', 'listening'][i % 4],
          ],
        );
        await server.db.query(
          "INSERT INTO public.exercise_submissions(attempt_id,position,answer,correct,feedback) VALUES($1,$2,'\"PRIVATE_ANSWER\"',$3,'private feedback')",
          [id, i, i <= correct],
        );
      }
      await server.db.query(
        "UPDATE public.lesson_attempts SET status='completed',score=$2,completed_at=now()-$3::integer*interval '1 day' WHERE id=$1",
        [id, correct * 10, days],
      );
    }
    await page.reload();
    await expect(
      page.getByText('+40 п. п. к точности', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: /Динамика правильных ответов за 30 дней/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '90 дней', exact: true }).click();
    await expect(page.getByRole('img', { name: /за 90 дней/ })).toBeVisible();
    const r = await context.request.get(url + '?days=90');
    const body = (await r.json()) as EnglishAnalytics;
    expect(body.current.accuracy).toBe(60);
    expect(body.historyTotal).toBe(2);
    expect(body).not.toHaveProperty('context');
    expect(JSON.stringify(body)).not.toMatch(
      /PRIVATE_KEY|PRIVATE_ANSWER|private explanation/,
    );
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: 'test-results/analytics-mobile-real-data.png',
      fullPage: false,
    });
    await page
      .getByRole('heading', {
        name: 'Динамика правильных ответов',
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/analytics-graph-real-data.png',
      fullPage: false,
    });
    // An identity change must never reuse the previous learner's statistics.
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
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.admin,
      randomUUID(),
      'Isolated second user test',
    ]);
    const other = await context.request.get(url);
    expect((await other.json()).current.answered).toBe(0);
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: 'Пока недостаточно данных',
        exact: true,
      }),
    ).toBeVisible();
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.admin],
    );
    expect((await context.request.get(url)).status()).toBe(403);
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'Мой Premium', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Период аналитики' }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await server.close();
  }
});
test('analytics entry point and anonymous API rejection work on the configured runtime', async ({
  page,
  request,
}) => {
  await page.goto('/analytics');
  await expect(
    page.getByRole('heading', { name: 'Аналитика английского', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Базовый прогресс и XP →' }),
  ).toBeVisible();
  expect((await request.get('/api/analytics')).status()).toBe(401);
});

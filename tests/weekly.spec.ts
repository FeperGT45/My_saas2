import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminServer } from './helpers/admin-server';
import { randomUUID } from 'node:crypto';
import type { WeeklyPlan } from '../src/lib/learning/weekly';
test('weekly calendar renders on the configured Next or Worker runtime while the real API rejects anonymous writes', async ({
  page,
  request,
  baseURL,
}) => {
  const fixture: WeeklyPlan = {
    id: '00000000-0000-0000-0000-000000000001',
    start: '2026-11-04',
    today: '2026-11-04',
    timeZone: 'Europe/Moscow',
    goal: 'travel',
    minutes: 5,
    revision: 1,
    days: Array.from({ length: 7 }, (_, i) => ({
      index: i,
      date: `2026-11-${String(4 + i).padStart(2, '0')}`,
      tasks: [
        {
          position: 0,
          lessonId: '40000000-0000-0000-0000-000000000001',
          title: 'Первый разговор в путешествии',
          kind: i % 2 ? 'practice' : 'lesson',
          minutes: 5,
          completedAt: null,
          ready: true,
        },
      ],
    })),
  };
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        user: { id: 'fixture-learner', name: 'Learner', mode: 'telegram' },
      },
    }),
  );
  await page.route('**/api/weekly-plan', (r) => r.fulfill({ json: fixture }));
  await page.route('**/api/learning-plan', (r) =>
    r.fulfill({
      status: 503,
      json: { error: 'Базовые рекомендации временно недоступны' },
    }),
  );
  await page.goto('/learning-plan');
  await expect(
    page.getByRole('group', { name: 'Дни занятий' }).getByRole('button'),
  ).toHaveCount(7);
  await expect(
    page.getByRole('link', { name: 'Начать урок', exact: true }),
  ).toHaveAttribute(
    'href',
    '/lesson?lesson=40000000-0000-0000-0000-000000000001',
  );
  await page
    .getByRole('group', { name: 'Дни занятий' })
    .getByRole('button')
    .nth(1)
    .click();
  await expect(
    page.getByRole('link', { name: 'Начать практику', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect([401, 403]).toContain(
    (
      await request.post('/api/weekly-plan', {
        headers: { Origin: new URL(baseURL!).origin },
        data: { action: 'refresh' },
      })
    ).status(),
  );
  expect(
    (
      await request.post('/api/weekly-plan', {
        headers: { Origin: 'https://evil.example' },
        data: { action: 'refresh' },
      })
    ).status(),
  ).toBe(403);
  await page.screenshot({
    path: baseURL?.endsWith('3002')
      ? 'test-results-cloudflare/weekly-calendar.png'
      : 'test-results/weekly-calendar.png',
    fullPage: false,
  });
});
test('weekly Premium calendar persists preferences, moves, recalculates and fails closed through the real API', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const url = server.origin + '/api/weekly-plan';
  const headers = { 'Content-Type': 'application/json', Origin: server.origin };
  const post = (body: unknown) =>
    context.request.post(url, { headers, data: body });
  try {
    expect((await post({ action: 'refresh' })).status()).toBe(401);
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.student,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    expect((await post({ action: 'refresh' })).status()).toBe(403);
    // Free recommendations are unaffected by the paid endpoint.
    expect(
      (
        await context.request.post(server.origin + '/api/learning-plan', {
          headers,
          data: { action: 'refresh' },
        })
      ).status(),
    ).toBe(200);
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Isolated calendar test',
    ]);
    expect((await post({ action: 'refresh' })).status()).toBe(409);
    await server.db.query('SELECT public.placement_beginner($1)', [
      server.student,
    ]);
    expect(
      (
        await post({ action: 'refresh', userId: server.admin, premium: true })
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(url, {
          headers: { ...headers, Origin: 'https://other.example' },
          data: { action: 'refresh' },
        })
      ).status(),
    ).toBe(403);
    await page.goto(server.origin + '/learning-plan');
    await expect(
      page.getByRole('group', { name: 'Дни занятий' }),
    ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Дни занятий' }).getByRole('button'),
    ).toHaveCount(7);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByText('Цель и время занятий', { exact: true }).click();
    await page.getByLabel('Зачем тебе английский?').selectOption('travel');
    await page.getByRole('radio', { name: '15 мин', exact: true }).check();
    await page
      .getByRole('button', { name: 'Сохранить и обновить неделю' })
      .click();
    await expect(
      page.getByText('Цель и нагрузка сохранены. Будущие задания обновлены.'),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Английский для путешествий · около 15 мин в день'),
    ).toBeVisible();
    const r = await post({ action: 'refresh' });
    expect(r.status()).toBe(200);
    const plan = (await r.json()) as WeeklyPlan;
    const moved = await post({
      action: 'move',
      day: 0,
      date: plan.days[1].date,
      revision: plan.revision,
    });
    expect(moved.status()).toBe(200);
    const after = (await moved.json()) as WeeklyPlan;
    expect(after.days[0].date).toBe(plan.days[1].date);
    expect(after.days[0].tasks).toEqual(plan.days[0].tasks);
    expect(
      (
        await post({
          action: 'move',
          day: 0,
          date: plan.days[2].date,
          revision: plan.revision,
        })
      ).status(),
    ).toBe(409);
    const task = after.days.flatMap((d) => d.tasks)[0];
    await server.db.query(
      "INSERT INTO public.lesson_attempts(user_id,lesson_id,started_at,status,score,completed_at) VALUES($1,$2,now()-interval '1 minute','completed',95,now())",
      [server.student, task.lessonId],
    );
    const refreshed = await post({ action: 'refresh' });
    expect(refreshed.status()).toBe(200);
    const updated = (await refreshed.json()) as WeeklyPlan;
    expect(
      updated.days.flatMap((d) => d.tasks).filter((t) => t.completedAt),
    ).toHaveLength(1);
    expect(updated.days[0].date).toBe(after.days[0].date);
    await page.reload();
    await expect(page.getByText(/1 из \d+ заданий/)).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: 'test-results/weekly-premium-mobile.png',
      fullPage: true,
    });
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.student],
    );
    expect((await post({ action: 'refresh' })).status()).toBe(403);
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'Мой Premium', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Дни занятий' })).toHaveCount(
      0,
    );
    // Stored completion remains intact when access expires.
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.weekly_plan_tasks WHERE plan_id=$1 AND completed_at IS NOT NULL',
          [plan.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await context.close();
    await server.close();
  }
});

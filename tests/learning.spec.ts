import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminServer } from './helpers/admin-server';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import {
  recommendLearningPath,
  type LearningContext,
} from '../src/lib/learning/recommend';

test('learning plan integrates placement, goal persistence, real lesson links, retries and account isolation', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
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
    await page.goto(server.origin + '/learning-plan');
    await expect(
      page.getByRole('link', { name: 'Определить точку старта →' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Определить точку старта →' }).click();
    await page
      .getByRole('button', { name: 'Я новичок, начать с нуля' })
      .click();
    await expect(
      page.getByRole('link', { name: 'Начать обучение', exact: true }),
    ).toHaveAttribute('href', '/learning-plan');
    // The placement endpoint has already persisted the real plan, before its screen is opened.
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.learning_path_lessons WHERE path_id=(SELECT id FROM public.learning_paths WHERE user_id=$1)',
          [server.student],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
    await page
      .getByRole('link', { name: 'Начать обучение', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Маршрут под твой ритм' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Начать урок', exact: true }).first(),
    ).toHaveAttribute(
      'href',
      '/lesson?lesson=40000000-0000-0000-0000-000000000001',
    );
    await expect(
      page.getByText('Следующий шаг: сначала заверши предыдущие уроки', {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .getByLabel('Цель обучения', { exact: true })
      .selectOption('gaming');
    await page
      .getByLabel('Курс учебного плана')
      .selectOption('20000000-0000-0000-0000-000000000001');
    await page
      .getByRole('button', { name: 'Сохранить учебный план', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Цель и маршрут сохранены' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Цель обучения', { exact: true })).toHaveValue(
      'gaming',
    );
    await expect(page.getByLabel('Курс учебного плана')).toHaveValue(
      '20000000-0000-0000-0000-000000000001',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    const own = await context.request.get(server.origin + '/api/learning-plan');
    expect(own.status()).toBe(200);
    const body = await own.json();
    expect(body.goal).toBe('gaming');
    expect(JSON.stringify(body)).not.toMatch(
      /answer_key|correct_option|telegram_id|display_name/,
    );
    expect(
      (
        await context.request.get(
          server.origin + '/api/learning-plan?userId=' + server.admin,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(server.origin + '/api/learning-plan', {
          headers: { Origin: server.origin },
          data: { action: 'refresh', userId: server.admin },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(server.origin + '/api/learning-plan', {
          headers: { Origin: 'https://evil.example' },
          data: { action: 'refresh' },
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
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    const other = await context.request.get(
      server.origin + '/api/learning-plan',
    );
    expect((await other.json()).goal).toBe('general');
    expect(
      (
        await server.db.query(
          'SELECT * FROM public.user_progress WHERE user_id=$1',
          [server.student],
        )
      ).rows,
    ).toEqual([]);
    // Recover after a server outage; never replace a failed request with a fabricated plan.
    let fail = true;
    await page.route('**/api/learning-plan', (route) =>
      fail
        ? route.fulfill({
            status: 503,
            json: { error: 'План временно недоступен.' },
          })
        : route.continue(),
    );
    await page.reload();
    await expect(
      page.getByRole('alert').filter({ hasText: 'План временно недоступен.' }),
    ).toHaveText('План временно недоступен.');
    fail = false;
    await page
      .getByRole('button', { name: 'Повторить загрузку плана' })
      .click();
    await expect(
      page.getByRole('link', { name: 'Определить точку старта →' }),
    ).toBeVisible();
  } finally {
    await context.close();
    await server.close();
  }
});

test('learning API requires a real session on the configured Next or Worker runtime', async ({
  request,
}) => {
  expect((await request.get('/api/learning-plan')).status()).toBe(401);
  expect(
    (
      await request.post('/api/learning-plan', {
        headers: { Origin: 'https://evil.example' },
        data: { action: 'refresh' },
      })
    ).status(),
  ).toBe(403);
});

test('learning client runs on the configured runtime with actual SQL-backed recommendations', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PGlite();
  const id = 'a0000000-0000-0000-0000-000000000004';
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
    );
    for (const f of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
    await db.exec(
      await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
    );
    await db.query('INSERT INTO auth.users VALUES($1)', [id]);
    await db.query(
      "INSERT INTO public.users(id,display_name) VALUES($1,'Runtime learner')",
      [id],
    );
    await db.query('SELECT public.placement_beginner($1)', [id]);
    await page.route('**/api/auth/session', (r) =>
      r.fulfill({
        json: {
          user: {
            id,
            name: 'Runtime learner',
            mode: 'telegram',
            telegramId: '789',
            avatarUrl: null,
          },
        },
      }),
    );
    await page.route('**/api/learning-plan', async (route) => {
      const b = route.request().postDataJSON();
      if (b.action === 'preferences')
        await db.query('SELECT public.learning_path_preferences($1,$2,$3)', [
          id,
          b.goal,
          b.courseId,
        ]);
      const snapshot = (
        await db.query<{ data: { context: LearningContext; token: string } }>(
          'SELECT public.learning_path_context($1) AS data',
          [id],
        )
      ).rows[0].data;
      const plan = recommendLearningPath(snapshot.context);
      await db.query('SELECT public.learning_path_store($1,$2,$3::jsonb)', [
        id,
        snapshot.token,
        JSON.stringify(plan),
      ]);
      await route.fulfill({ json: plan });
    });
    await page.goto('/learning-plan');
    await expect(
      page.getByRole('heading', { name: 'Маршрут под твой ритм' }),
    ).toBeVisible();
    await page
      .getByLabel('Цель обучения', { exact: true })
      .selectOption('travel');
    await page
      .getByRole('button', { name: 'Сохранить учебный план', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Цель и маршрут сохранены' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Цель обучения', { exact: true })).toHaveValue(
      'travel',
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});

import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { adminServer } from './helpers/admin-server';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { PlacementStatus } from '@/lib/placement/types';
async function login(context: BrowserContext, token: string) {
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

test('first launch, beginner A1, recommendation fallback and a persistent profile use real authenticated APIs', async ({
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
    await login(context, server.tokens.student);
    await server.db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,85)',
      [server.student, '40000000-0000-0000-0000-000000000001'],
    );
    const progress = (
      await server.db.query(
        'SELECT * FROM public.user_progress WHERE user_id=$1',
        [server.student],
      )
    ).rows;
    await page.goto(server.origin + '/');
    await expect(
      page.getByRole('heading', { name: 'Узнаем твой уровень английского?' }),
    ).toBeVisible();
    await expect(page.getByText('Привет, Student ✦')).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .getByRole('button', { name: 'Я новичок, начать с нуля' })
      .click();
    await expect(page).toHaveURL(server.origin + '/placement');
    await expect(
      page.getByRole('heading', { name: 'A1', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Тест не проходился, навыки пока не оценивались.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Начать обучение', exact: true }),
    ).toHaveAttribute('href', '/learning-plan');
    await page.getByLabel('Изменить учебный маршрут').selectOption('C2');
    await expect(
      page.getByText(
        /Для маршрута C2 предлагаем ближайшие доступные материалы/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'A1', exact: true }),
    ).toBeVisible();
    const loaded = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/placement' &&
        r.request().method() === 'GET',
    );
    await page.goto(server.origin + '/');
    await loaded;
    await expect(
      page.getByRole('heading', { name: 'Узнаем твой уровень английского?' }),
    ).toHaveCount(0);
    await page.goto(server.origin + '/profile');
    await expect(
      page.getByRole('heading', { name: 'Мой уровень английского' }),
    ).toBeVisible();
    await expect(
      page.getByText('A1 · Beginner', { exact: true }),
    ).toBeVisible();
    expect(
      (
        await server.db.query(
          'SELECT * FROM public.user_progress WHERE user_id=$1',
          [server.student],
        )
      ).rows,
    ).toEqual(progress);
    await page
      .getByRole('link', { name: 'Пройти тест повторно', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Начать тест', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Я новичок, начать с нуля' }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await server.close();
  }
});

test('adaptive test resumes, survives a lost answer response, finishes, retests and protects other users', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await login(context, server.tokens.admin);
    const post = async (body: object) =>
      context.request.post(server.origin + '/api/placement', {
        headers: { origin: server.origin },
        data: body,
      });
    let lose = true;
    await page.route('**/api/placement', async (route) => {
      const request = route.request();
      if (
        request.method() === 'POST' &&
        request.postDataJSON()?.action === 'answer' &&
        lose
      ) {
        lose = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({
          status: 503,
          json: { error: 'Ответ сети потерян. Повтори запрос.' },
        });
        return;
      }
      await route.continue();
    });
    await page.goto(server.origin + '/');
    await page
      .getByRole('button', { name: 'Начать тест', exact: true })
      .click();
    await expect(page).toHaveURL(server.origin + '/placement');
    let answered = 0;
    let firstAttempt = '';
    while (true) {
      await expect(
        page.getByRole('group', { name: 'Варианты ответа теста' }),
      ).toBeVisible();
      const attempt = (
        await server.db.query<{
          id: string;
          current_question_id: string;
          current_snapshot: {
            correct_option: string;
            options: { id: string; label: string }[];
          };
        }>(
          "SELECT id,current_question_id,current_snapshot FROM public.placement_test_attempts WHERE user_id=$1 AND status='active'",
          [server.admin],
        )
      ).rows[0];
      expect(attempt).toBeDefined();
      firstAttempt ||= attempt.id;
      const publicState = await context.request.get(
        server.origin + '/api/placement',
      );
      expect(await publicState.text()).not.toMatch(
        /correct_option|correctOption|explanation|posterior/,
      );
      const label = attempt.current_snapshot.options.find(
        (o) => o.id === attempt.current_snapshot.correct_option,
      )!.label;
      await page
        .getByRole('group', { name: 'Варианты ответа теста' })
        .getByRole('button', { name: label, exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Проверить ответ', exact: true })
        .click();
      if (answered === 0) {
        await expect(page.getByRole('main').getByRole('alert')).toContainText(
          'Ответ сети потерян',
        );
        await page
          .getByRole('button', { name: 'Проверить ответ', exact: true })
          .click();
      }
      await expect(
        page.getByRole('heading', { name: 'Верно!', exact: true }),
      ).toBeVisible();
      answered++;
      expect(answered).toBeLessThanOrEqual(20);
      const s = (await (
        await context.request.get(server.origin + '/api/placement')
      ).json()) as PlacementStatus;
      expect(
        (
          await server.db.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM public.placement_test_answers WHERE attempt_id=$1',
            [firstAttempt],
          )
        ).rows[0].n,
      ).toBe(answered);
      if (!s.attempt) {
        await page
          .getByRole('button', { name: 'Посмотреть результат' })
          .click();
        break;
      }
      if (answered === 2) {
        await page.goto(server.origin + '/placement?retest=1');
        await expect(
          page.getByText('Сохранено ответов: 2 из максимум 20'),
        ).toBeVisible();
      } else
        await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    }
    expect(answered).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole('heading', { name: /^C[12]$/ })).toBeVisible();
    await expect(
      page.getByText(/Это предварительная оценка CEFR/),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page
      .getByRole('button', { name: 'Пройти тест повторно', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Начать тест', exact: true })
      .click();
    await expect(
      page.getByRole('group', { name: 'Варианты ответа теста' }),
    ).toBeVisible();
    const other = await browser.newContext();
    try {
      await login(other, server.tokens.student);
      const foreign = await other.request.post(
        server.origin + '/api/placement',
        {
          headers: { origin: server.origin },
          data: {
            action: 'answer',
            attemptId: firstAttempt,
            questionId: randomUUID(),
            requestId: randomUUID(),
            option: 'a',
          },
        },
      );
      expect(foreign.status()).toBe(404);
      const own = await other.request.get(server.origin + '/api/placement');
      expect(await own.text()).not.toContain(firstAttempt);
    } finally {
      await other.close();
    }
    let s = (await (
      await context.request.get(server.origin + '/api/placement')
    ).json()) as PlacementStatus;
    while (s.attempt) {
      const a = s.attempt;
      const q = a.question!;
      const key = (
        await server.db.query<{ key: string }>(
          "SELECT current_snapshot->>'correct_option' AS key FROM public.placement_test_attempts WHERE id=$1",
          [a.id],
        )
      ).rows[0].key;
      const response = await post({
        action: 'answer',
        attemptId: a.id,
        questionId: q.id,
        requestId: randomUUID(),
        option: q.options.find((o) => o.id !== key)!.id,
      });
      expect(response.status()).toBe(200);
      s = (await response.json()).status;
    }
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'A1', exact: true }),
    ).toBeVisible();
    expect(s.history).toHaveLength(2);
    expect(
      (
        await server.db.query(
          'SELECT * FROM public.xp_events WHERE user_id=$1',
          [server.admin],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await context.close();
    await server.close();
  }
});

test('placement APIs reject anonymous requests, foreign Origins and forged identity fields', async ({
  request,
}) => {
  expect((await request.get('/api/placement')).status()).toBe(401);
  expect(
    (
      await request.post('/api/placement', {
        headers: { origin: 'https://evil.example' },
        data: { action: 'beginner', userId: randomUUID() },
      })
    ).status(),
  ).toBe(403);
});

test('placement client works on the configured runtime with SQL-backed transport', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PGlite();
  const id = 'a0000000-0000-0000-0000-000000000003';
  try {
    await db.exec(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
    );
    for (const f of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
    await db.exec(await readFile('supabase/seed.sql', 'utf8'));
    await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
    await db.query('INSERT INTO auth.users VALUES($1)', [id]);
    await db.query(
      "INSERT INTO public.users(id,display_name) VALUES($1,'Runtime learner')",
      [id],
    );
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
    await page.route('**/api/placement', async (route) => {
      const request = route.request();
      let data;
      if (request.method() === 'GET')
        data = (
          await db.query<{ data: unknown }>(
            'SELECT public.placement_status($1) AS data',
            [id],
          )
        ).rows[0].data;
      else {
        const b = request.postDataJSON();
        if (b.action === 'start')
          data = {
            status: (
              await db.query<{ data: unknown }>(
                'SELECT public.placement_start($1,$2) AS data',
                [id, b.requestId],
              )
            ).rows[0].data,
          };
        else if (b.action === 'answer')
          data = (
            await db.query<{ data: unknown }>(
              'SELECT public.placement_answer($1,$2,$3,$4,$5) AS data',
              [id, b.attemptId, b.questionId, b.requestId, b.option],
            )
          ).rows[0].data;
        else throw new Error('Unsupported fixture command');
      }
      await route.fulfill({ json: data });
    });
    await page.goto('/placement');
    await page
      .getByRole('button', { name: 'Начать тест', exact: true })
      .click();
    await expect(
      page.getByRole('group', { name: 'Варианты ответа теста' }),
    ).toBeVisible();
    const q = (
      await db.query<{
        q: { correct_option: string; options: { id: string; label: string }[] };
      }>(
        'SELECT current_snapshot AS q FROM public.placement_test_attempts WHERE user_id=$1',
        [id],
      )
    ).rows[0].q;
    await page
      .getByRole('group', { name: 'Варианты ответа теста' })
      .getByRole('button', {
        name: q.options.find((o) => o.id === q.correct_option)!.label,
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: 'Проверить ответ', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Верно!', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Сохранено ответов: 1 из максимум 20'),
    ).toBeVisible();
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

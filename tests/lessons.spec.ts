import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
test('six mobile exercise types use database grading, recover a lost response, save and repeat', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PGlite();
  try {
    await db.exec(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    await db.exec(await readFile('supabase/seed.sql', 'utf8'));
    const user = 'a0000000-0000-0000-0000-000000000001';
    await db.exec(
      `INSERT INTO auth.users VALUES('${user}');INSERT INTO public.users(id,display_name) VALUES('${user}','Test');SET ROLE service_role;`,
    );
    let loseResponse = true;
    // Only transport/auth are substituted. Every response and score comes from the real migration RPCs.
    await page.route('**/api/lessons/**', async (route) => {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON();
      let sql: string, args: unknown[];
      if (url.pathname.endsWith('/start')) {
        sql = 'SELECT public.start_lesson($1,$2,$3) AS data';
        args = [user, body.lessonId, body.requestId];
      } else if (url.pathname.endsWith('/answer')) {
        sql = 'SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb) AS data';
        args = [
          user,
          url.pathname.split('/')[3],
          body.position,
          JSON.stringify(body.answer),
        ];
      } else {
        sql = 'SELECT public.lesson_state($1,$2) AS data';
        args = [user, url.pathname.split('/')[3]];
      }
      try {
        const data = (await db.query<{ data: unknown }>(sql, args)).rows[0]
          .data;
        if (
          url.pathname.endsWith('/answer') &&
          body.position === 2 &&
          loseResponse
        ) {
          loseResponse = false;
          await route.fulfill({
            status: 503,
            json: { error: 'Ответ сети потерян. Повтори запрос.' },
          });
          return;
        }
        await route.fulfill({ json: data });
      } catch {
        await route.fulfill({
          status: 409,
          json: { error: 'Нельзя изменить сохранённый ответ.' },
        });
      }
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', {
        value: undefined,
        configurable: true,
      });
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/lesson');
    await page
      .getByRole('button', { name: 'Начать урок', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Проверить', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: /Hello/ }).click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(
      page.getByText('Точно в цель!', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    const words = page.getByRole('group', { name: 'Слова', exact: true });
    for (const word of ['I', 'like', 'reading'])
      await words.getByRole('button', { name: word, exact: true }).click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Ответ сети потерян',
    );
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.getByRole('textbox', { name: 'Пропущенное слово' }).fill('am');
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    for (const [left, right] of [
      ['cat', 'кот'],
      ['dog', 'собака'],
    ]) {
      await page
        .getByRole('group', { name: 'Слова слева' })
        .getByRole('button', { name: left, exact: true })
        .click();
      await page
        .getByRole('group', { name: 'Переводы справа' })
        .getByRole('button', { name: right, exact: true })
        .click();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.getByRole('button', { name: '1 speak', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.getByText('Новый опыт — тоже прогресс')).toBeVisible();
    await expect(page.getByText(/В Present Simple/)).toBeVisible();
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await expect(page.getByText('Текстовый режим:')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Прослушать фразу', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: /Доброе утро/ }).click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await page
      .getByRole('button', { name: 'Завершить урок', exact: true })
      .click();
    await expect(page.getByText('5 / 6')).toBeVisible();
    await expect(page.getByText('30 XP', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Результат сохранён на сервере.'),
    ).toBeVisible();
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM public.exercise_submissions',
        )
      ).rows[0].n,
    ).toBe(6);
    await page.reload();
    await expect(page.getByText('5 / 6')).toBeVisible();
    await page.getByRole('button', { name: 'Пройти ещё раз' }).click();
    await expect(
      page.getByRole('heading', { name: 'Выбор перевода', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Выйти из урока' }).click();
    await expect(page).toHaveURL('/learn');
  } finally {
    await db.close();
  }
});
test('lesson API denies anonymous access and cross-origin writes', async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post('/api/lessons/start', {
        headers: { origin: 'https://evil.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get('/api/lessons/70000000-0000-0000-0000-000000000001')
    ).status(),
  ).toBe(401);
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByText('Результат сохранён на сервере.')).toHaveCount(0);
});

test('listening invokes supported Web Speech and falls back on synthesis failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        text: string;
        lang = '';
        constructor(text: string) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        speak(u: { text: string; lang: string; onerror?: () => void }) {
          sessionStorage.setItem('speech-call', `${u.text}:${u.lang}`);
          queueMicrotask(() => u.onerror?.());
        },
      },
    });
  });
  await page.route('**/api/lessons/start', (route) =>
    route.fulfill({
      json: {
        attemptId: '70000000-0000-0000-0000-000000000009',
        lessonId: '40000000-0000-0000-0000-000000000002',
        status: 'started',
        total: 1,
        answered: 0,
        correct: 0,
        score: null,
        xp: 0,
        exercise: {
          position: 1,
          kind: 'listening',
          prompt: 'Послушай фразу',
          payload: {
            text: 'Good morning',
            lang: 'en-US',
            options: [
              { id: 'a', label: 'Доброе утро' },
              { id: 'b', label: 'Спокойной ночи' },
            ],
          },
        },
      },
    }),
  );
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Прослушать фразу', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Прослушать фразу', exact: true })
    .click();
  await expect(page.getByText('Текстовый режим:')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('speech-call'))).toBe(
    'Good morning:en-US',
  );
});

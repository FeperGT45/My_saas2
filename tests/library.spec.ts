import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { adminServer } from './helpers/admin-server';
import { loadLibrary, libraryPayload } from '../scripts/content/library';
test.use({ actionTimeout: 15000 });
test('published library uses real Supabase RPCs, filters by CEFR, plays a new lesson and recovers from errors', async ({
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
    const library = await loadLibrary(),
      payload = libraryPayload(library);
    await server.db.query(
      'SELECT public.import_curriculum_package($1::jsonb)',
      [JSON.stringify(payload)],
    );
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
    await page.goto(server.origin + '/courses');
    await page
      .getByRole('link', { name: 'Открыть полный каталог', exact: true })
      .click();
    await expect(
      page.getByText('Уроков в каталоге: 247 · Курсов: 7'),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Уровень материалов', exact: true })
      .selectOption('C2');
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(23);
    await page
      .getByRole('textbox', { name: 'Поиск уроков', exact: true })
      .fill('несуществующий-урок-123');
    await expect(
      page.getByRole('heading', { name: 'Подходящих уроков не найдено' }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Поиск уроков', exact: true })
      .fill('');
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
    const first = payload.lessons.find(
      (l) => l.title === 'Цитирование и согласие с оценкой',
    )!;
    await page
      .getByRole('textbox', { name: 'Поиск уроков', exact: true })
      .fill(first.title);
    await page
      .getByRole('link', { name: 'Начать урок', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(server.origin + '/lesson?lesson=' + first.id);
    await page
      .getByRole('button', { name: 'Начать урок', exact: true })
      .click();
    await expect(
      page.getByText('Задание 1 из 9', { exact: true }),
    ).toBeVisible();
    const attempt = new URL(page.url()).searchParams.get('attempt')!;
    const es = payload.exercises.filter((e) => e.lesson_id === first.id),
      e = es[0];
    const index = e.public_payload.options!.findIndex(
      (o) => o.id === e.reference_answer,
    );
    await page
      .getByRole('button', {
        name: `${index + 1} ${e.public_payload.options![index].label}`,
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(
      page.getByText('Точно в цель!', { exact: true }),
    ).toBeVisible();
    for (const e of es.slice(1)) {
      const response = await context.request.post(
        `${server.origin}/api/lessons/${attempt}/answer`,
        {
          headers: { Origin: server.origin },
          data: { position: e.position, answer: e.reference_answer },
        },
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).correct).toBe(true);
    }
    expect(
      (
        await server.db.query<{ best_score: number }>(
          'SELECT best_score FROM public.user_progress WHERE user_id=$1 AND lesson_id=$2',
          [server.student, first.id],
        )
      ).rows[0].best_score,
    ).toBe(100);
    const response = await context.request.get(server.origin + '/api/library');
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toMatch(
      /answer_key|telegram_id|reference_answer|incorrect_answer/,
    );
    expect(
      (
        await context.request.get(
          server.origin + '/api/library?userId=' + server.admin,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(server.origin + '/api/library', {
          data: { action: 'import' },
        })
      ).status(),
    ).toBe(405);
    let fail = true;
    await page.route('**/api/library', (r) =>
      fail
        ? r.fulfill({
            status: 503,
            json: { error: 'Библиотека временно недоступна.' },
          })
        : r.continue(),
    );
    await page.goto(server.origin + '/library');
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Библиотека временно недоступна.' }),
    ).toBeVisible();
    fail = false;
    await page
      .getByRole('button', { name: 'Повторить загрузку библиотеки' })
      .click();
    await expect(
      page.getByText('Уроков в каталоге: 247 · Курсов: 7'),
    ).toBeVisible();
  } finally {
    await context.close();
    await server.close();
  }
});
test('library client works on the configured Next or Worker runtime with SQL-backed metadata', async ({
  page,
}) => {
  test.setTimeout(60000);
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
    );
    for (const f of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
    await db.exec(
      await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
    );
    await db.query('SELECT public.import_curriculum_package($1::jsonb)', [
      JSON.stringify(libraryPayload(await loadLibrary())),
    ]);
    await page.route('**/api/library', async (r) =>
      r.fulfill({
        json: (
          await db.query<{ data: unknown }>(
            'SELECT public.curriculum_library() AS data',
          )
        ).rows[0].data,
      }),
    );
    await page.goto('/library');
    await expect(
      page.getByText('Уроков в каталоге: 247 · Курсов: 7'),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Уровень материалов', exact: true })
      .selectOption('B2');
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(43);
    await page
      .getByRole('textbox', { name: 'Поиск уроков', exact: true })
      .fill('упущенные');
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(1);
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

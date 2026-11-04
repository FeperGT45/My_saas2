import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { adminServer } from './helpers/admin-server';
import {
  choiceKinds,
  orderedKinds,
  type ExerciseKind,
  type ExercisePayload,
  type ExerciseKey,
} from '../src/lib/exercises/contracts';
import type { Answer, LessonState } from '../src/features/lesson/types';
type Example = {
  kind: ExerciseKind;
  prompt: string;
  public_payload: ExercisePayload;
  answer_key: ExerciseKey;
  reference_answer: Answer;
  incorrect_answer: Answer;
  explanation: string;
};
async function answerExercise(page: Page, e: Example) {
  const p = e.public_payload,
    a = e.reference_answer;
  if (choiceKinds.includes(e.kind)) {
    const index = p.options!.findIndex((o) => o.id === a);
    await page
      .getByRole('button', {
        name: `${index + 1} ${p.options![index].label}`,
        exact: true,
      })
      .click();
  } else if (e.kind === 'multiple_choice') {
    for (const id of a as string[])
      await page
        .getByRole('checkbox', {
          name: p.options!.find((o) => o.id === id)!.label,
          exact: true,
        })
        .check();
  } else if (orderedKinds.includes(e.kind)) {
    for (const id of a as string[]) {
      const label = p.tokens!.find((t) => t.id === id)!.label;
      await page
        .getByRole('button', { name: label, exact: true })
        .and(page.locator('button:not([disabled])'))
        .first()
        .click();
    }
  } else if (e.kind === 'matching') {
    for (const [left, right] of Object.entries(a as Record<string, string>)) {
      await page
        .getByRole('button', {
          name: p.left!.find((o) => o.id === left)!.label,
          exact: true,
        })
        .click();
      await page
        .getByRole('button', {
          name: p.right!.find((o) => o.id === right)!.label,
          exact: true,
        })
        .click();
    }
  } else if (e.kind === 'unit_test') {
    for (const [i, q] of p.questions!.entries())
      await page
        .getByRole('group', { name: `${i + 1}. ${q.prompt}`, exact: true })
        .getByRole('button', {
          name: q.options.find(
            (o) => o.id === (a as Record<string, string>)[q.id],
          )!.label,
          exact: true,
        })
        .click();
  } else {
    if (e.kind === 'dictation') {
      await page
        .getByRole('button', { name: 'Прослушать фразу', exact: true })
        .click();
      await expect(
        page.getByText('Текстовый режим:', { exact: false }),
      ).toBeVisible();
    }
    await page.getByRole('textbox').fill(a as string);
  }
}
test('all requested formats use real authenticated APIs, resume, survive retries and keep the existing rewards', async ({
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
    const examples: Example[] = JSON.parse(
      await readFile('tests/fixtures/exercises-v2.json', 'utf8'),
    ).exercises;
    const lesson = randomUUID();
    await server.db.query(
      "INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES($1,'30000000-0000-0000-0000-000000000001','Local QA only',3,true)",
      [lesson],
    );
    for (const [i, e] of examples.entries())
      await server.db.query(
        'INSERT INTO public.exercises(lesson_id,kind,prompt,position,public_payload,answer_key,explanation) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [
          lesson,
          e.kind,
          e.prompt,
          i + 1,
          JSON.stringify(e.public_payload),
          JSON.stringify(e.answer_key),
          e.explanation,
        ],
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
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: class {
          lang = 'en-US';
          rate = 1;
          constructor(public text: string) {}
        },
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel() {},
          speak() {
            throw Error('Device audio unavailable');
          },
        },
      });
    });
    let lose = true;
    await page.route('**/api/lessons/*/answer', async (route) => {
      const b = route.request().postDataJSON();
      if (b.position === 5 && lose) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        lose = false;
        await route.fulfill({
          status: 503,
          json: { error: 'Ответ сохранён, но сетевой ответ потерян.' },
        });
      } else await route.continue();
    });
    await page.goto(server.origin + `/lesson?lesson=${lesson}`);
    await page
      .getByRole('button', { name: 'Начать урок', exact: true })
      .click();
    let attempt = '';
    for (const [i, e] of examples.entries()) {
      await expect(
        page.getByText(`Задание ${i + 1} из 21`, { exact: true }),
      ).toBeVisible();
      if (i === 0) attempt = new URL(page.url()).searchParams.get('attempt')!;
      const state = await context.request.get(
        server.origin + '/api/lessons/' + attempt,
      );
      expect(state.status()).toBe(200);
      const body: LessonState = await state.json();
      expect(body.exercise?.kind).toBe(e.kind);
      expect(JSON.stringify(body)).not.toMatch(
        /answer_key|accepted|explanations|correct_option/,
      );
      await answerExercise(page, e);
      if (
        [
          'translation',
          'dictation',
          'reading',
          'dialogue',
          'spelling',
          'unit_test',
        ].includes(e.kind)
      ) {
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
      }
      await page
        .getByRole('button', { name: 'Проверить', exact: true })
        .click();
      if (e.kind === 'translation') {
        await expect(
          page.getByRole('alert').filter({ hasText: 'Ответ сохранён' }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Проверить', exact: true })
          .click();
      }
      await expect(
        page.getByText('Точно в цель!', { exact: true }),
      ).toBeVisible();
      if (e.kind === 'unit_test')
        await expect(
          page.getByText('Вопрос 2: верно', { exact: true }),
        ).toBeVisible();
      await page
        .getByRole('button', {
          name: i === 20 ? 'Завершить урок' : 'Дальше',
          exact: true,
        })
        .click();
      if (i === 6) await page.reload();
    }
    await expect(
      page.getByRole('heading', { name: 'Отличный полёт!' }),
    ).toBeVisible();
    const finished = await context.request.get(
      server.origin + '/api/lessons/' + attempt,
    );
    expect(await finished.json()).toMatchObject({
      status: 'completed',
      correct: 21,
      score: 100,
    });
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.exercise_submissions WHERE attempt_id=$1',
          [attempt],
        )
      ).rows[0].n,
    ).toBe(21);
    expect(
      (
        await server.db.query<{ n: number }>(
          'SELECT count(*) AS n FROM public.xp_events WHERE user_id=$1 AND lesson_id=$2',
          [server.student, lesson],
        )
      ).rows[0].n,
    ).toBe(1);
    await page
      .getByRole('button', { name: 'Пройти ещё раз', exact: true })
      .click();
    await expect(
      page.getByText('Задание 1 из 21', { exact: true }),
    ).toBeVisible();
    const privateContext = await browser.newContext();
    try {
      await privateContext.addCookies([
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
      expect(
        (
          await privateContext.request.get(
            server.origin + '/api/lessons/' + attempt,
          )
        ).status(),
      ).toBe(404);
    } finally {
      await privateContext.close();
    }
  } finally {
    await context.close();
    await server.close();
  }
});

test('all exercise clients run on the configured runtime with SQL-backed transport', async ({
  page,
}) => {
  test.setTimeout(120000);
  const db = new PGlite();
  const user = randomUUID(),
    lesson = randomUUID();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;",
    );
    for (const f of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
    await db.exec(
      await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
    );
    await db.query('INSERT INTO auth.users VALUES($1)', [user]);
    await db.query(
      "INSERT INTO public.users(id,display_name) VALUES($1,'Runtime learner')",
      [user],
    );
    await db.query(
      "INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES($1,'30000000-0000-0000-0000-000000000001','Runtime QA only',3,true)",
      [lesson],
    );
    const examples: Example[] = JSON.parse(
      await readFile('tests/fixtures/exercises-v2.json', 'utf8'),
    ).exercises;
    for (const [i, e] of examples.entries())
      await db.query(
        'INSERT INTO public.exercises(lesson_id,kind,prompt,position,public_payload,answer_key,explanation) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [
          lesson,
          e.kind,
          e.prompt,
          i + 1,
          JSON.stringify(e.public_payload),
          JSON.stringify(e.answer_key),
          e.explanation,
        ],
      );
    await db.exec('SET ROLE service_role');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: class {
          lang = 'en-US';
          rate = 1;
          constructor(public text: string) {}
        },
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel() {},
          speak() {
            throw Error('Device audio unavailable');
          },
        },
      });
    });
    await page.route('**/api/lessons/**', async (route) => {
      const url = new URL(route.request().url()),
        b = route.request().postDataJSON();
      let sql: string, args: unknown[];
      if (url.pathname.endsWith('/start')) {
        sql = 'SELECT public.start_lesson($1,$2,$3) AS data';
        args = [user, b.lessonId, b.requestId];
      } else if (url.pathname.endsWith('/answer')) {
        sql = 'SELECT public.submit_lesson_answer($1,$2,$3,$4::jsonb) AS data';
        args = [
          user,
          url.pathname.split('/')[3],
          b.position,
          JSON.stringify(b.answer),
        ];
      } else {
        sql = 'SELECT public.lesson_state($1,$2) AS data';
        args = [user, url.pathname.split('/')[3]];
      }
      await route.fulfill({
        json: (await db.query<{ data: unknown }>(sql, args)).rows[0].data,
      });
    });
    await page.goto(`/lesson?lesson=${lesson}`);
    await page
      .getByRole('button', { name: 'Начать урок', exact: true })
      .click();
    for (const [i, e] of examples.entries()) {
      await expect(
        page.getByText(`Задание ${i + 1} из 21`, { exact: true }),
      ).toBeVisible();
      await answerExercise(page, e);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole('button', { name: 'Проверить', exact: true })
        .click();
      await expect(
        page.getByText('Точно в цель!', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: i === 20 ? 'Завершить урок' : 'Дальше',
          exact: true,
        })
        .click();
    }
    await expect(
      page.getByRole('heading', { name: 'Отличный полёт!' }),
    ).toBeVisible();
  } finally {
    await db.close();
  }
});

test('admin can author open answers, multiple selection and checkpoints through validated mobile forms', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  try {
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
    await page.goto(server.origin + '/admin');
    await page
      .getByRole('navigation', { name: 'Разделы администратора' })
      .getByRole('button', { name: 'Контент', exact: true })
      .click();
    await page.getByRole('button', { name: 'Разделы', exact: true }).click();
    await page.getByRole('button', { name: 'Уроки', exact: true }).click();
    const lessonCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'На одной волне', exact: true }),
    });
    await lessonCard
      .getByRole('button', { name: 'Задания', exact: true })
      .click();
    for (const [i, kind] of (
      ['translation', 'multiple_choice', 'unit_test'] as const
    ).entries()) {
      await page
        .getByRole('button', { name: 'Создать задание', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Тип задания', exact: true })
        .selectOption(kind);
      await page.getByLabel('Позиция', { exact: true }).fill(String(7 + i));
      await page
        .getByLabel('Формулировка', { exact: true })
        .fill('Проверка редактора ' + kind);
      await page
        .getByLabel('Объяснение ответа', { exact: true })
        .fill('Проверенное объяснение ответа.');
      if (kind === 'translation') {
        await page
          .getByLabel('Исходное предложение для перевода', { exact: true })
          .fill('Мы готовы.');
        await page
          .getByLabel('Допустимые ответы, каждый с новой строки', {
            exact: true,
          })
          .fill('We are ready.\nWe’re ready.');
      } else if (kind === 'multiple_choice') {
        await page.getByLabel('Вариант 1', { exact: true }).fill('cat');
        await page.getByLabel('Вариант 2', { exact: true }).fill('dog');
        await page
          .getByRole('checkbox', { name: 'Правильный вариант 1', exact: true })
          .check();
        await page
          .getByRole('checkbox', { name: 'Правильный вариант 2', exact: true })
          .check();
      } else {
        for (const n of [1, 2]) {
          await page
            .getByLabel('Формулировка вопроса ' + n, { exact: true })
            .fill('Выбери приветствие.');
          await page
            .getByLabel(`Вариант ${n}.1`, { exact: true })
            .fill('Hello');
          await page
            .getByLabel(`Вариант ${n}.2`, { exact: true })
            .fill('Goodbye');
          await page
            .getByLabel('Объяснение вопроса ' + n, { exact: true })
            .fill('Hello — приветствие.');
        }
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
      page.once('dialog', (d) => d.accept());
      await page
        .getByRole('button', {
          name: 'Сохранить с подтверждением',
          exact: true,
        })
        .click();
      await expect(
        page.getByRole('heading', {
          name: 'Проверка редактора ' + kind,
          exact: true,
        }),
      ).toBeVisible();
      const saved = (
        await server.db.query<{
          kind: string;
          answer_key: ExerciseKey;
          public_payload: ExercisePayload;
        }>(
          'SELECT kind,answer_key,public_payload FROM public.exercises WHERE prompt=$1',
          ['Проверка редактора ' + kind],
        )
      ).rows[0];
      expect(saved.kind).toBe(kind);
      expect(saved.answer_key).toBeTruthy();
      if (kind === 'unit_test')
        expect(saved.public_payload.questions).toHaveLength(2);
    }
  } finally {
    await context.close();
    await server.close();
  }
});

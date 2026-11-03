import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';

test('real review API saves one event after a lost response, updates overview and isolates users', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const server = await adminServer();
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
  });
  const page = await context.newPage();
  const signIn = async (token: string) => {
    await context.clearCookies();
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
  };
  const post = (data: unknown) =>
    context.request.post(server.origin + '/api/review', {
      headers: { Origin: server.origin },
      data,
    });
  try {
    const lesson = '40000000-0000-0000-0000-000000000001';
    await server.db.query(
      `UPDATE public.lessons SET lexicon='[{"en":"apple","ru":"яблоко"}]' WHERE id=$1`,
      [lesson],
    );
    await server.db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,80)',
      [server.student, lesson],
    );
    await signIn(server.tokens.student);
    const before = await context.request.get(server.origin + '/api/overview');
    expect(before.status()).toBe(200);
    expect((await before.json()).statistics).toMatchObject({
      passedLessons: 1,
      words: 1,
      dueWords: 1,
      reviews: 0,
    });
    expect(
      (
        await context.request.get(
          server.origin + '/api/overview?userId=' + server.admin,
        )
      ).status(),
    ).toBe(400);
    let lost = false;
    await page.route('**/api/review', async (route) => {
      if (route.request().postDataJSON().action === 'answer' && !lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(server.origin + '/review');
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      'К повторению: 1',
    );
    await page.getByRole('button', { name: 'Показать перевод' }).click();
    await expect(page.getByText('яблоко', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Легко', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Обновить очередь' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Не вспомнил', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Легко', exact: true }).click();
    await expect(page.getByText(/На сегодня готово!/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      'К повторению: 0',
    );
    const overview = await context.request.get(server.origin + '/api/overview');
    expect((await overview.json()).statistics).toMatchObject({
      words: 1,
      dueWords: 0,
      reviews: 1,
    });
    const rows = (
      await server.db.query<{ word_key: string }>(
        'SELECT word_key FROM public.word_reviews WHERE user_id=$1',
        [server.student],
      )
    ).rows;
    expect(
      (await server.db.query('SELECT * FROM public.word_review_events')).rows,
    ).toHaveLength(1);
    expect(
      (await server.db.query('SELECT * FROM public.xp_events')).rows,
    ).toHaveLength(0);
    expect(
      (await post({ action: 'queue', userId: server.admin })).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(server.origin + '/api/review', {
          headers: { Origin: 'https://evil.example' },
          data: { action: 'queue' },
        })
      ).status(),
    ).toBe(403);
    await signIn(server.tokens.admin);
    expect(await (await post({ action: 'queue' })).json()).toMatchObject({
      total: 0,
      due: 0,
      cards: [],
    });
    expect(
      (
        await post({
          action: 'answer',
          key: rows[0].word_key,
          version: 0,
          rating: 5,
          requestId: randomUUID(),
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await (
          await context.request.get(server.origin + '/api/overview')
        ).json()
      ).statistics.passedLessons,
    ).toBe(0);
    await context.clearCookies();
    expect((await post({ action: 'queue' })).status()).toBe(401);
  } finally {
    await context.close();
    await server.close();
  }
});

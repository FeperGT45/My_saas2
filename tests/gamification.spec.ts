import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
test('real SQL summary renders progress, timezone, daily goals and achievements on mobile', async ({
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
    await db.exec(
      await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
    );
    const user = 'a0000000-0000-0000-0000-000000000001';
    await db.exec(
      `INSERT INTO auth.users VALUES('${user}');INSERT INTO public.users(id,display_name) VALUES('${user}','Реальный профиль');SET ROLE service_role;`,
    );
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: {
          user: {
            id: user,
            name: 'Реальный профиль',
            avatarUrl: null,
            telegramId: '123',
            mode: 'telegram',
          },
        },
      }),
    );
    await page.route('**/api/game', async (route) => {
      const data = (
        await db.query<{ data: unknown }>(
          'SELECT public.game_summary($1) AS data',
          [user],
        )
      ).rows[0].data;
      await route.fulfill({ json: data });
    });
    await page.route('**/api/game/timezone', async (route) => {
      const body = route.request().postDataJSON();
      try {
        await db.query('SELECT public.set_game_timezone($1,$2)', [
          user,
          body.timeZone,
        ]);
        await route.fulfill({ json: { ok: true } });
      } catch {
        await route.fulfill({
          status: 409,
          json: { error: 'Часовой пояс закреплён.' },
        });
      }
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { name: 'Уровень опыта 1', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Часовой пояс IANA' })
      .fill('Asia/Tokyo');
    await page
      .getByRole('button', { name: 'Сохранить до первого занятия' })
      .click();
    await expect(
      page.getByText('Рекорд: 0 дн. · Часовой пояс: Asia/Tokyo'),
    ).toBeVisible();
    await db.exec(
      `INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,started_at,completed_at) VALUES('70000000-0000-0000-0000-000000000001','${user}','40000000-0000-0000-0000-000000000001','completed',100,now()-interval '5 minutes',now());SELECT public.award_completed_lesson('70000000-0000-0000-0000-000000000001');`,
    );
    await page.reload();
    await expect(
      page.getByText('10 XP всего · следующий уровень с 100 XP'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Часовой пояс закреплён после первого занятия. Это защищает ежедневные награды.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Получено · 15 монет')).toBeVisible();
    await expect(
      page.getByText('1 / 1 впервые зачтённых уроков'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('link', { name: 'Мои достижения', exact: true })
      .click();
    await expect(
      page.getByText('Первый контакт', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Получено · 15 монет')).toBeVisible();
  } finally {
    await db.close();
  }
});
test('game routes deny anonymous writes and anonymous summary', async ({
  request,
}) => {
  expect((await request.get('/api/game')).status()).toBe(401);
  expect(
    (
      await request.post('/api/game/timezone', {
        headers: { origin: 'https://evil.example' },
        data: { timeZone: 'UTC', xp: 100000 },
      })
    ).status(),
  ).toBe(403);
});

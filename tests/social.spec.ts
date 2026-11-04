import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { telegramInviteUrl } from '../src/lib/social/invite';
test('opt-in rankings, privacy and invitations use real SQL on a mobile screen', async ({
  page,
  context,
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
      `INSERT INTO auth.users VALUES('${user}');INSERT INTO public.users(id,display_name) VALUES('${user}','PRIVATE ACTUAL NAME');INSERT INTO public.lesson_attempts(id,user_id,lesson_id,status,score,started_at,completed_at) VALUES('70000000-0000-0000-0000-000000000001','${user}','40000000-0000-0000-0000-000000000001','completed',100,now()-interval '5 minutes',now());SET ROLE service_role;SELECT public.award_completed_lesson('70000000-0000-0000-0000-000000000001');`,
    );
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: {
          user: {
            id: user,
            name: 'PRIVATE ACTUAL NAME',
            avatarUrl: null,
            telegramId: '123',
            mode: 'telegram',
          },
        },
      }),
    );
    await page.route(/\/api\/social(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      const result = (
        await db.query<{ data: { invitations: { code: string } } }>(
          'SELECT public.social_summary($1,$2,$3) AS data',
          [
            user,
            url.searchParams.get('scope') ?? 'weekly',
            Number(url.searchParams.get('offset') ?? 0),
          ],
        )
      ).rows[0].data;
      const { code, ...stats } = result.invitations;
      await route.fulfill({
        json: {
          ...result,
          invitations: { ...stats, url: telegramInviteUrl(code) },
        },
      });
    });
    await page.route('**/api/social/privacy', async (route) => {
      const body = route.request().postDataJSON();
      await db.query('SELECT public.set_social_privacy($1,$2,$3)', [
        user,
        body.visible,
        body.alias,
      ]);
      await route.fulfill({ json: { ok: true } });
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/leaderboard');
    await expect(page.getByText('Здесь начнётся соревнование')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Публичный псевдоним' })
      .fill('Orbit');
    await page
      .getByRole('checkbox', { name: 'Участвовать в публичном рейтинге' })
      .check();
    await page.getByRole('button', { name: 'Сохранить приватность' }).click();
    await expect(
      page.getByText('Твоя позиция: #1', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^Orbit/)).toBeVisible();
    await expect(
      page.getByText('PRIVATE ACTUAL NAME', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'За всё время', exact: true })
      .click();
    await expect(
      page.getByText('Все серверные XP за всё время.', { exact: false }),
    ).toBeVisible();
    await page
      .getByRole('checkbox', { name: 'Участвовать в публичном рейтинге' })
      .uncheck();
    await page.getByRole('button', { name: 'Сохранить приватность' }).click();
    await expect(page.getByText('Здесь начнётся соревнование')).toBeVisible();
    await page
      .getByRole('link', { name: 'Друзья и приглашения', exact: true })
      .click();
    await expect(page).toHaveURL('/friends');
    await expect(
      page.getByRole('textbox', { name: 'Твоя Telegram-ссылка' }),
    ).toHaveValue(/^https:\/\/t.me\/Voklumi_bot\?startapp=r_[a-f0-9]{32}$/);
    const share = page.getByRole('link', { name: 'Пригласить', exact: true });
    expect(await share.getAttribute('href')).toContain(
      'https://t.me/share/url?url=',
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Копировать', exact: true }).click();
    await expect(page.getByText('Ссылка скопирована.')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});
test('social API rejects anonymous reads and cross-origin updates', async ({
  request,
}) => {
  expect((await request.get('/api/social')).status()).toBe(401);
  expect(
    (
      await request.post('/api/social/privacy', {
        headers: { origin: 'https://evil.example' },
        data: { visible: true, alias: 'Fake', userId: 'forged' },
      })
    ).status(),
  ).toBe(403);
});

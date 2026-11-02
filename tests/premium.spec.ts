import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
test('Premium mobile screen stays disabled and shows verified active/refunded/expired states', async ({
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
    const user = 'a0000000-0000-0000-0000-000000000001';
    await db.exec(
      `INSERT INTO auth.users VALUES('${user}');INSERT INTO public.users(id,display_name,telegram_id) VALUES('${user}','Buyer',123);SET ROLE service_role;`,
    );
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: {
          user: {
            id: user,
            name: 'Buyer',
            avatarUrl: null,
            telegramId: '123',
            mode: 'telegram',
          },
        },
      }),
    );
    await page.route(/\/api\/premium$/, async (route) => {
      const status = (
        await db.query<{ data: object }>(
          'SELECT public.premium_status($1) AS data',
          [user],
        )
      ).rows[0].data;
      await route.fulfill({
        json: {
          ...status,
          enabled: false,
          amount: null,
          termsUrl: null,
          supportUrl: null,
        },
      });
    });
    await page.route('**/api/premium/features', async (route) => {
      const result = (
        await db.query<{ data: object }>(
          'SELECT public.premium_features($1) AS data',
          [user],
        )
      ).rows[0].data;
      await route.fulfill({ json: result });
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/premium');
    await expect(
      page.getByText('Текущий доступ: Free', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Открыть оплату Telegram Stars' }),
    ).toBeDisabled();
    const order = (
      await db.query<{ data: { payload: string } }>(
        `SELECT public.create_star_order($1,'70000000-0000-0000-0000-000000000001',99) AS data`,
        [user],
      )
    ).rows[0].data;
    await db.query(`SELECT public.check_star_checkout($1,123,'XTR',99,'q')`, [
      order.payload,
    ]);
    await db.query(
      `SELECT public.apply_star_event($1,123,'XTR',99,'fixture-charge',false)`,
      [order.payload],
    );
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(
      page.getByRole('status', { name: 'Статус Premium' }),
    ).toContainText('Premium активен');
    await expect(
      page.getByText('Пройди урок, чтобы получить план повторения.'),
    ).toBeVisible();
    await db.query(
      `UPDATE public.subscriptions SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE user_id=$1`,
      [user],
    );
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(page.getByText('Период завершён · Free')).toBeVisible();
    await db.query(
      `SELECT public.apply_star_event($1,123,'XTR',99,'fixture-charge',true)`,
      [order.payload],
    );
    await page.getByRole('button', { name: 'Проверить статус' }).click();
    await expect(page.getByText('Платёж возвращён · Free')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});
test('real Next endpoints keep payment creation disabled and deny anonymous features', async ({
  request,
}) => {
  expect(
    (
      await request.post('/api/premium/invoice', {
        data: { requestId: 'fake', amount: 1 },
      })
    ).status(),
  ).toBe(503);
  expect((await request.get('/api/premium/features')).status()).toBe(401);
});

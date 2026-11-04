import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { adminServer } from './helpers/admin-server';
import type { DictionaryData } from '../src/lib/learning/dictionary';
test('dictionary persists collections and words, flips cards, imports lesson vocabulary and retains basic access after expiry', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const server = await adminServer({ currentCatalog: true });
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const url = server.origin + '/api/dictionary';
  const headers = { Origin: server.origin };
  const post = (data: unknown) => context.request.post(url, { headers, data });
  try {
    expect((await context.request.get(url)).status()).toBe(401);
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.student,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const basic = await context.request.get(url);
    expect(basic.status()).toBe(200);
    expect((await basic.json()).canManage).toBe(false);
    expect((await post({ action: 'train', collectionId: null })).status()).toBe(
      403,
    );
    const library = await context.request.get(server.origin + '/api/library');
    expect(JSON.stringify(await library.json())).not.toContain(
      'На одной волне',
    );
    await server.db.query('SELECT public.grant_premium_access($1,$2,30,$3)', [
      server.student,
      randomUUID(),
      'Isolated dictionary UI test',
    ]);
    await page.goto(server.origin + '/dictionary');
    await expect(
      page.getByRole('heading', { name: 'Здесь появятся твои слова' }),
    ).toBeVisible();
    await page.getByText('Мои коллекции (0)', { exact: true }).click();
    await page.getByLabel('Название коллекции').fill('Путешествия');
    await page
      .getByRole('button', { name: 'Создать коллекцию', exact: true })
      .click();
    await expect(
      page.getByText('Мои коллекции (1)', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Добавить слово', exact: true })
      .click();
    await page.getByLabel('Английское слово или выражение').fill('journey');
    await page.getByLabel('Перевод', { exact: true }).fill('путешествие');
    await page
      .getByLabel('Примеры использования (необязательно)')
      .fill('A journey starts with one step.');
    const initial = (await (
      await context.request.get(url)
    ).json()) as DictionaryData;
    await page
      .getByRole('combobox', { name: 'Коллекция слова', exact: true })
      .selectOption(initial.collections[0].id);
    await page
      .getByRole('button', { name: 'Сохранить слово', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'journey', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'journey', exact: true }),
    ).toBeVisible();
    expect(
      (await context.request.get(url + '?userId=' + server.admin)).status(),
    ).toBe(400);
    expect(
      (
        await context.request.post(url, {
          headers: { Origin: 'https://evil.example' },
          data: { action: 'train', collectionId: null },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole('button', { name: 'Карточки коллекции', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Загрузить карточки', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Знаю', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Перевернуть карточку' }).click();
    await expect(
      page.getByRole('button', { name: 'Перевернуть карточку' }),
    ).toContainText('путешествие');
    await page.getByRole('button', { name: 'Знаю', exact: true }).click();
    await expect(page.getByText(/Карточек на сейчас нет/)).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть тренировку' }).click();
    const learned = (await (
      await context.request.get(url)
    ).json()) as DictionaryData;
    expect(learned.statistics?.known).toBe(1);
    await page.getByRole('searchbox').fill('несуществующее');
    await expect(
      page.getByRole('heading', { name: 'Ничего не найдено' }),
    ).toBeVisible();
    await page.getByRole('searchbox').fill('');
    await expect(
      page.getByRole('heading', { name: 'journey', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Редактировать слово', exact: true })
      .click();
    await page
      .getByLabel('Примеры использования (необязательно)')
      .fill('My journey continues.');
    await page
      .getByRole('button', { name: 'Сохранить слово', exact: true })
      .click();
    await expect(
      page.getByText('My journey continues.', { exact: true }),
    ).toBeVisible();
    // Real completed lesson source; no private answer data is required by vocabulary import.
    await server.db.query(
      `UPDATE public.lessons SET lexicon='[{"en":"hello","ru":"привет","example":"Hello, my friend."}]'::jsonb WHERE id='40000000-0000-0000-0000-000000000001'`,
    );
    await server.db.query(
      "INSERT INTO public.lesson_attempts(user_id,lesson_id,status,score,started_at,completed_at) VALUES($1,'40000000-0000-0000-0000-000000000001','completed',80,now()-interval '1 minute',now())",
      [server.student],
    );
    await page.getByRole('button', { name: 'Из уроков', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'hello', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Добавить в мой словарь', exact: true })
      .click();
    await expect(
      page.getByText('Уже в моём словаре', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Мои слова', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'hello', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: 'test-results/dictionary-mobile.png',
      fullPage: false,
    });
    await server.db.query(
      "UPDATE public.subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE user_id=$1",
      [server.student],
    );
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'journey', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Добавить слово', exact: true }),
    ).toHaveCount(0);
    const expired = (await (
      await context.request.get(url)
    ).json()) as DictionaryData;
    expect(expired.words).toHaveLength(2);
    expect(expired.statistics).toBeNull();
    expect((await post({ action: 'train', collectionId: null })).status()).toBe(
      403,
    );
    expect(
      (
        await context.request.post(server.origin + '/api/review', {
          headers,
          data: { action: 'queue' },
        })
      ).status(),
    ).toBe(200);
    await context.clearCookies();
    await context.addCookies([
      {
        name: '__Host-voklumi_session',
        value: server.tokens.admin,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    expect((await (await context.request.get(url)).json()).words).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
test('dictionary entry point renders and rejects anonymous writes on the configured runtime', async ({
  page,
  request,
}) => {
  await page.goto('/dictionary');
  await expect(
    page.getByRole('heading', { name: 'Мой словарь', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вход и профиль →' }),
  ).toBeVisible();
  expect((await request.get('/api/dictionary')).status()).toBe(401);
});

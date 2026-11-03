import { test, expect } from '@playwright/test';
import { buildLearningMap } from '../src/lib/learning/map';
import type {
  LearningContext,
  LearningLesson,
} from '../src/lib/learning/recommend';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const lesson = (
  key: string,
  courseId: string,
  title: string,
  bestScore: number | null,
): LearningLesson => ({
  id: key,
  title,
  unitTitle: 'Глава путешествий',
  courseId,
  courseTitle: courseId === 'first' ? 'Первый курс' : 'Второй курс',
  level: 'A1',
  goals: ['general'],
  skills: ['grammar'],
  prerequisites: [],
  bestScore,
  lastScore: bestScore,
  recentWrong: 0,
});
const context: LearningContext = {
  level: 'A1',
  goal: 'general',
  courseId: null,
  assessmentSkills: [],
  recentSkills: [],
  recentLessons: [],
  lessons: [
    lesson(id, 'first', 'Заказ билета', 80),
    lesson(other, 'second', 'Планирование поездки', null),
  ],
};
const statistics = {
  passedLessons: 1,
  completedAttempts: 2,
  answered: 10,
  correct: 7,
  accuracy: 70,
  attemptMinutes: 12,
  words: 8,
  dueWords: 3,
  reviews: 5,
};
test('mobile map reflects progress, saves course choice, retries failures and clears private UI after logout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  let selected: string | null = null,
    fail = false,
    signedIn = true;
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      status: signedIn ? 200 : 401,
      json: {
        user: signedIn
          ? { id: 'learner', name: 'Learner', mode: 'telegram' }
          : null,
      },
    }),
  );
  await page.route('**/api/overview', (r) =>
    r.fulfill(
      fail
        ? { status: 503, json: { error: 'Тестовая ошибка загрузки' } }
        : {
            json: {
              ...buildLearningMap({ ...context, courseId: selected }),
              statistics,
            },
          },
    ),
  );
  await page.route('**/api/learning-plan', async (r) => {
    selected = r.request().postDataJSON().courseId;
    await r.fulfill({ json: { ok: true } });
  });
  await page.goto('/learn');
  await expect(
    page.getByRole('link', { name: 'Повторить слова · доступно 3' }),
  ).toBeVisible();
  await expect(page.getByText('Зачтено 1 из 1')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Планирование поездки' }),
  ).toHaveAttribute('href', `/lesson?lesson=${other}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('Выбранный курс').selectOption('second');
  await page.getByRole('button', { name: 'Сохранить выбор' }).click();
  await expect(
    page.getByRole('heading', { name: 'Второй курс · A1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Первый курс · A1', exact: true }),
  ).toHaveCount(0);
  fail = true;
  await page.getByRole('button', { name: 'Обновить прогресс' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Тестовая ошибка' }),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByLabel('Выбранный курс')).toBeVisible();
  signedIn = false;
  await page.reload();
  await expect(
    page.getByText('Твой личный прогресс', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Заказ билета', { exact: true })).toHaveCount(0);
});
test('home uses evidence-based statistics and exposes no fictional XP or rank', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: { user: { id: 'learner', name: 'Learner', mode: 'telegram' } },
    }),
  );
  await page.route('**/api/overview', (r) =>
    r.fulfill({ json: { ...buildLearningMap(context), statistics } }),
  );
  await page.route('**/api/game', (r) =>
    r.fulfill({
      json: {
        xp: 30,
        streak: { current: 1 },
        completedLessons: 1,
        achievements: [],
      },
    }),
  );
  await page.route('**/api/placement', (r) =>
    r.fulfill({ status: 503, json: { error: 'Тест недоступен' } }),
  );
  await page.goto('/');
  await expect(page.getByText('Моя статистика', { exact: true })).toBeVisible();
  await expect(page.getByText('70% (7/10)', { exact: true })).toBeVisible();
  await expect(
    page.getByText('30 XP · 1 дней подряд · 1 зачтённых уроков'),
  ).toBeVisible();
  await expect(page.getByText('1 240', { exact: true })).toHaveCount(0);
  await expect(page.getByText('#4', { exact: true })).toHaveCount(0);
});

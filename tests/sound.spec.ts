import { test, expect } from '@playwright/test';

test('server-confirmed wrong/right answers and lesson completion produce distinct real audio cues', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    Object.assign(window, { toneFrequencies: [] });
    window.AudioContext = class extends Original {
      createOscillator() {
        const oscillator = super.createOscillator();
        const set = oscillator.frequency.setValueAtTime.bind(
          oscillator.frequency,
        );
        oscillator.frequency.setValueAtTime = (frequency, time) => {
          (
            window as unknown as { toneFrequencies: number[] }
          ).toneFrequencies.push(frequency);
          return set(frequency, time);
        };
        return oscillator;
      }
    };
  });
  const exercise = (position: number) => ({
    position,
    kind: 'grammar',
    prompt: 'Выбери ответ',
    payload: {
      options: [
        { id: 'a', label: 'I am' },
        { id: 'b', label: 'I is' },
      ],
    },
  });
  const state = {
    attemptId: '60000000-0000-0000-0000-000000000001',
    lessonId: '40000000-0000-0000-0000-000000000002',
    status: 'started',
    total: 2,
    answered: 0,
    correct: 0,
    score: null,
    xp: 0,
    exercise: exercise(1),
  };
  await page.route('**/api/lessons/start', (r) => r.fulfill({ json: state }));
  await page.route('**/api/lessons/*/answer', (r) => {
    const last = r.request().postDataJSON().position === 2;
    return r.fulfill({
      json: {
        correct: last,
        explanation: last ? 'Верно' : 'Попробуй ещё',
        state: {
          ...state,
          status: last ? 'completed' : 'started',
          answered: last ? 2 : 1,
          correct: last ? 1 : 0,
          score: last ? 50 : null,
          exercise: last ? null : exercise(2),
        },
      },
    });
  });
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await page.getByRole('button', { name: '2 I is', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.getByText('Попробуй ещё', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { toneFrequencies: number[] }
        ).toneFrequencies.includes(293.66),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await page.getByRole('button', { name: '1 I am', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { toneFrequencies: number[] }
        ).toneFrequencies.includes(523.25),
      ),
    )
    .toBe(true);
  await page
    .getByRole('button', { name: 'Завершить урок', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Отличный полёт!' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { toneFrequencies: number[] }
        ).toneFrequencies.includes(1046.5),
      ),
    )
    .toBe(true);
});
test('real Web Audio starts only after a gesture, mute survives reload and keyboard preview works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const metrics = { contexts: 0, notes: 0 };
    Object.assign(window, { soundMetrics: metrics });
    if (Original)
      window.AudioContext = class extends Original {
        constructor() {
          super();
          metrics.contexts++;
        }
        createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = (when?: number) => {
            metrics.notes++;
            start(when);
          };
          return oscillator;
        }
      };
  });
  const metrics = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            soundMetrics: { contexts: number; notes: number };
          }
        ).soundMetrics,
    );
  await page.goto('/settings');
  await expect(
    page.getByRole('switch', { name: 'Звуки', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(await metrics()).toEqual({ contexts: 0, notes: 0 });
  await page
    .getByRole('button', { name: 'Проверить звук', exact: true })
    .click();
  await expect.poll(async () => (await metrics()).notes).toBe(4);
  await page.getByRole('switch', { name: 'Звуки', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Проверить звук', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Звуки', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Главная', exact: true })
    .click();
  expect(await metrics()).toEqual({ contexts: 0, notes: 0 });
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await page.getByRole('switch', { name: 'Звуки', exact: true }).click();
  await page
    .getByRole('button', { name: 'Проверить звук', exact: true })
    .press('Enter');
  await expect.poll(async () => (await metrics()).notes).toBe(4);
  await page
    .getByRole('switch', { name: 'Озвучка упражнений', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Озвучка упражнений', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
});

test('listening has slow speech and stop, and muted speech falls back to text', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { spoken: [] });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [],
        cancel() {},
        speak(u: unknown) {
          (window as unknown as { spoken: unknown[] }).spoken.push(u);
        },
      },
    });
  });
  await page.route('**/api/lessons/start', (route) =>
    route.fulfill({
      json: {
        attemptId: '60000000-0000-0000-0000-000000000001',
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
          prompt: 'Выбери слово',
          payload: {
            text: 'Good morning',
            lang: 'en-US',
            options: [
              { id: 'a', label: 'Hello' },
              { id: 'b', label: 'Goodbye' },
            ],
          },
        },
      },
    }),
  );
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await page.getByRole('button', { name: 'Медленно', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          spoken: { text: string; lang: string; rate: number }[];
        }
      ).spoken.map((u) => ({ text: u.text, lang: u.lang, rate: u.rate })),
    ),
  ).toEqual([{ text: 'Good morning', lang: 'en-US', rate: 0.6 }]);
  await expect(
    page.getByRole('button', { name: 'Остановить', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Прослушать фразу', exact: true }),
  ).toBeEnabled();
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await page
    .getByRole('switch', { name: 'Озвучка упражнений', exact: true })
    .click();
  await page.goto('/lesson');
  await page.getByRole('button', { name: 'Начать урок', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Прослушать фразу', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Good morning', { exact: true })).toBeVisible();
});

test('blocked storage and unavailable audio leave settings usable without browser errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw Error('storage denied');
      },
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/settings');
  await page
    .getByRole('button', { name: 'Проверить звук', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Звуки', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Звуки', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  expect(errors).toEqual([]);
});

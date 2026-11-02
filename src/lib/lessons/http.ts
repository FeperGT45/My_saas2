import 'server-only';
import { assertSameOrigin } from '@/lib/auth/security';
import { getSessionUser, adminClient } from '@/lib/auth/session';
export const isUuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s);
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function lessonRequest(
  request: Request,
  write: boolean,
  run: (
    userId: string,
    db: ReturnType<typeof adminClient>,
  ) => Promise<Response>,
) {
  if (write) {
    try {
      assertSameOrigin(request);
    } catch {
      return json({ error: 'Недопустимый источник запроса.' }, 403);
    }
  }
  try {
    const user = await getSessionUser(request);
    if (!user)
      return json(
        { error: 'Войди через Telegram, чтобы сохранить результат.' },
        401,
      );
    if (user.mode !== 'telegram')
      return json(
        {
          error:
            'Локальная сессия не создаёт реальные результаты. Используй тесты БД.',
        },
        403,
      );
    return await run(user.id, adminClient());
  } catch {
    return json(
      {
        error:
          'Сервис уроков недоступен. Проверь подключение и повтори запрос.',
      },
      503,
    );
  }
}
export function rpcError(error: { message: string }) {
  const message = error.message;
  if (message.includes('premium required'))
    return json({ error: 'Для этого задания нужен действующий Premium.' }, 403);
  if (message.includes('invalid answer'))
    return json({ error: 'Некорректный формат ответа.' }, 400);
  if (/unavailable|closed/.test(message))
    return json({ error: 'Урок или попытка недоступны.' }, 404);
  if (/already submitted|out of order|too many/.test(message))
    return json(
      {
        error:
          'Ответ уже сохранён или порядок изменился. Открой попытку заново.',
      },
      409,
    );
  return json(
    { error: 'Не удалось обработать урок. Проверь настройки курса.' },
    503,
  );
}

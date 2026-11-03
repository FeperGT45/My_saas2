import { lessonRequest, json } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { placementCommand } from '@/lib/placement/validation';
const unavailable = () =>
  json({ error: 'Тест временно недоступен. Повтори попытку позже.' }, 503);
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if ([...new URL(request.url).searchParams.keys()].length)
      return json({ error: 'Некорректные параметры запроса.' }, 400);
    const { data, error } = await db.rpc('placement_status', {
      p_user: userId,
    });
    return error ? unavailable() : json(data);
  });
}
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON-запрос.' }, 415);
    let command;
    try {
      command = placementCommand(JSON.parse(await readBodyText(request, 2048)));
    } catch {
      return json({ error: 'Некорректный запрос тестирования.' }, 400);
    }
    const action = command.action;
    const { data, error } =
      action === 'start'
        ? await db.rpc('placement_start', {
            p_user: userId,
            p_request: command.requestId,
          })
        : action === 'beginner'
          ? await db.rpc('placement_beginner', { p_user: userId })
          : action === 'route'
            ? await db.rpc('placement_set_route', {
                p_user: userId,
                p_level: command.level,
              })
            : await db.rpc('placement_answer', {
                p_user: userId,
                p_attempt: command.attemptId,
                p_question: command.questionId,
                p_request: command.requestId,
                p_option: command.option,
              });
    if (error) {
      if (error.message.includes('daily limit'))
        return json(
          {
            error:
              'На сегодня достаточно попыток. Новый тест будет доступен позже; обучение остаётся открытым.',
          },
          429,
        );
      if (/conflict|out of order/.test(error.message))
        return json(
          {
            error:
              'Ответ уже сохранён или тест открыт в другом окне. Обнови состояние теста.',
          },
          409,
        );
      if (error.message === 'placement unavailable')
        return json({ error: 'Попытка недоступна.' }, 404);
      return unavailable();
    }
    return json(action === 'answer' ? data : { status: data });
  });
}

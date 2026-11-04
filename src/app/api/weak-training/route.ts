import { lessonRequest, json, rpcError } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { weakCommand, weakQuery } from '@/lib/learning/weak';
function failure(error: { message: string }) {
  const m = error.message;
  if (m.includes('weak insufficient'))
    return json(
      {
        error:
          'Недостаточно истории ответов. Пройди хотя бы два урока и ответь минимум на 10 разных заданий подходящего уровня.',
      },
      422,
    );
  if (m.includes('weak no eligible'))
    return json(
      {
        error:
          'Выраженных слабых тем пока нет или выбранная тема уже освоена. Пройди другие уроки.',
      },
      422,
    );
  if (m.includes('weak no materials'))
    return json(
      {
        error:
          'В базе недостаточно подходящих заданий этой темы. Выбери другую тему или продолжи уроки.',
      },
      422,
    );
  if (m.includes('weak conflict'))
    return json(
      {
        error:
          'Ответ уже сохранён или тренировка изменилась. Загрузи сохранённое состояние.',
      },
      409,
    );
  if (m.includes('invalid weak'))
    return json({ error: 'Проверь формат ответа.' }, 400);
  return rpcError(error);
}
export async function GET(request: Request) {
  return lessonRequest(request, false, async (user, db) => {
    let id: string | null;
    try {
      id = weakQuery(new URL(request.url).searchParams);
    } catch {
      return json({ error: 'Некорректная тренировка.' }, 400);
    }
    const { data, error } = await (
      id
        ? db.rpc('weak_state', { p_user: user, p_run: id })
        : db.rpc('weak_dashboard', { p_user: user })
    ).abortSignal(AbortSignal.timeout(20000));
    return error ? failure(error) : json(data);
  });
}
export async function POST(request: Request) {
  return lessonRequest(request, true, async (user, db) => {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON.' }, 415);
    let c;
    try {
      c = weakCommand(JSON.parse(await readBodyText(request, 8192)));
    } catch {
      return json({ error: 'Некорректный запрос тренировки.' }, 400);
    }
    const { data, error } = await (
      c.action === 'start'
        ? db.rpc('weak_start', {
            p_user: user,
            p_topic: c.topicId,
            p_request: c.requestId,
          })
        : db.rpc('weak_answer', {
            p_user: user,
            p_run: c.runId,
            p_request: c.requestId,
            p_position: c.position,
            p_answer: c.answer,
          })
    ).abortSignal(AbortSignal.timeout(20000));
    return error ? failure(error) : json(data);
  });
}

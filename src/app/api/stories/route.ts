import { lessonRequest, json, rpcError } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { storyCommand, storyAttemptParam } from '@/lib/stories/types';
function failure(error: { message: string }) {
  if (error.message.includes('story conflict'))
    return json(
      { error: 'Прохождение уже изменилось. Загрузите сохранённое состояние.' },
      409,
    );
  if (error.message.includes('invalid story'))
    return json({ error: 'Этот вариант ответа недоступен.' }, 400);
  return rpcError(error);
}
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    let id: string | null;
    try {
      id = storyAttemptParam(new URL(request.url).searchParams);
    } catch {
      return json({ error: 'Некорректное прохождение.' }, 400);
    }
    const { data, error } = await (
      id
        ? db.rpc('story_state', { p_user: userId, p_attempt: id })
        : db.rpc('story_catalog', { p_user: userId })
    ).abortSignal(AbortSignal.timeout(15000));
    return error ? failure(error) : json(data);
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
      return json({ error: 'Требуется JSON.' }, 415);
    let c;
    try {
      c = storyCommand(JSON.parse(await readBodyText(request, 4096)));
    } catch {
      return json({ error: 'Некорректный запрос истории.' }, 400);
    }
    const { data, error } = await (
      c.action === 'start'
        ? db.rpc('story_start', {
            p_user: userId,
            p_slug: c.slug,
            p_request: c.requestId,
          })
        : db.rpc('story_choose', {
            p_user: userId,
            p_attempt: c.attemptId,
            p_request: c.requestId,
            p_version: c.version,
            p_choice: c.choiceId,
          })
    ).abortSignal(AbortSignal.timeout(15000));
    return error ? failure(error) : json(data);
  });
}

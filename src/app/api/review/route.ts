import { lessonRequest, json, isUuid } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON.' }, 415);
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 2048));
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Некорректный запрос.' }, 400);
    if (body.action === 'queue' && Object.keys(body).length === 1) {
      const { data, error } = await db
        .rpc('word_review_queue', { p_user: userId })
        .abortSignal(AbortSignal.timeout(15000));
      return error
        ? json({ error: 'Повторение временно недоступно.' }, 503)
        : json(data);
    }
    if (
      body.action !== 'answer' ||
      Object.keys(body).sort().join(',') !==
        'action,key,rating,requestId,version' ||
      !isUuid(body.requestId) ||
      typeof body.key !== 'string' ||
      !/^[a-f0-9]{32}$/.test(body.key) ||
      !Number.isInteger(body.version) ||
      body.version < 0 ||
      ![0, 3, 4, 5].includes(body.rating)
    )
      return json({ error: 'Некорректный ответ.' }, 400);
    const { data, error } = await db
      .rpc('word_review_answer', {
        p_user: userId,
        p_request: body.requestId,
        p_word: body.key,
        p_version: body.version,
        p_rating: body.rating,
      })
      .abortSignal(AbortSignal.timeout(15000));
    return error
      ? json(
          { error: 'Карточка уже изменена или недоступна. Обнови очередь.' },
          409,
        )
      : json(data);
  });
}

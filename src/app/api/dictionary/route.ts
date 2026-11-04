import { lessonRequest, json } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { dictionaryCommand, dictionaryQuery } from '@/lib/learning/dictionary';
function failure(error: { message: string; code?: string }) {
  if (error.code === '23505')
    return json({ error: 'Такое слово с этим переводом уже есть.' }, 409);
  const m = error.message;
  return json(
    {
      error: m.includes('premium required')
        ? 'Для изменения словаря и расширенной тренировки нужен Premium.'
        : m.includes('limit')
          ? 'Достигнут технический лимит: 1000 коллекций или 50 000 слов.'
          : m.includes('conflict')
            ? 'Запись уже изменилась. Обнови словарь и повтори действие.'
            : m.includes('unavailable')
              ? 'Слово или коллекция недоступны.'
              : m.includes('invalid')
                ? 'Проверь слово, перевод и пример.'
                : 'Словарь временно недоступен. Повтори запрос.',
    },
    m.includes('premium required')
      ? 403
      : m.includes('limit')
        ? 409
        : m.includes('conflict')
          ? 409
          : m.includes('unavailable')
            ? 404
            : m.includes('invalid')
              ? 400
              : 503,
  );
}
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    let q;
    try {
      q = dictionaryQuery(new URL(request.url).searchParams);
    } catch {
      return json({ error: 'Некорректный поиск или коллекция.' }, 400);
    }
    const { data, error } = await db
      .rpc('dictionary_read', {
        p_user: userId,
        p_source: q.source,
        p_collection: q.collection,
        p_search: q.search,
        p_offset: q.offset,
      })
      .abortSignal(AbortSignal.timeout(15000));
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
      c = dictionaryCommand(JSON.parse(await readBodyText(request, 16384)));
    } catch {
      return json(
        { error: 'Введи английское слово, перевод и корректные настройки.' },
        400,
      );
    }
    const call =
      c.action === 'train'
        ? db.rpc('dictionary_train', {
            p_user: userId,
            p_collection: c.collectionId,
          })
        : c.action === 'answer'
          ? db.rpc('dictionary_answer', {
              p_user: userId,
              p_id: c.id,
              p_request: c.requestId,
              p_key: c.key,
              p_version: c.version,
              p_rating: c.rating,
            })
          : db.rpc('dictionary_mutate', {
              p_user: userId,
              p_request: c.requestId,
              p_action: c.action,
              p_data: c.data,
            });
    const { data, error } = await call.abortSignal(AbortSignal.timeout(15000));
    return error ? failure(error) : json(data);
  });
}

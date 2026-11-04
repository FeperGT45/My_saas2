import { lessonRequest, json, rpcError, isUuid } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
function fail(e: { message: string }) {
  if (e.message.includes('conflict'))
    return json({ error: 'Ответ уже сохранён. Загрузи тест заново.' }, 409);
  if (e.message.includes('bank'))
    return json(
      { error: 'Недостаточно проверенных вопросов. Попробуй позднее.' },
      503,
    );
  if (e.message.includes('daily limit'))
    return json(
      {
        error:
          'Доступно два новых теста за 24 часа. Сохранённый тест можно продолжить.',
      },
      429,
    );
  return rpcError(e);
}
export async function GET(r: Request) {
  return lessonRequest(r, false, async (u, db) => {
    const q = new URL(r.url).searchParams,
      id = q.get('attempt');
    if (
      [...q.keys()].some((k) => k !== 'attempt') ||
      q.getAll('attempt').length > 1 ||
      (id !== null && !isUuid(id))
    )
      return json({ error: 'Некорректный тест.' }, 400);
    const { data, error } = await db.rpc('extended_read', {
      p_user: u,
      p_id: id,
    });
    return error ? fail(error) : json(data);
  });
}
export async function POST(r: Request) {
  return lessonRequest(r, true, async (u, db) => {
    let b;
    try {
      if (!r.headers.get('content-type')?.startsWith('application/json'))
        throw Error();
      b = JSON.parse(await readBodyText(r, 2048));
      if (!isUuid(b.requestId)) throw Error();
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    let call;
    if (
      b.action === 'start' &&
      Object.keys(b).sort().join() === 'action,requestId'
    )
      call = db.rpc('extended_start', { p_user: u, p_request: b.requestId });
    else if (
      b.action === 'answer' &&
      Object.keys(b).sort().join() ===
        'action,attemptId,option,questionId,requestId' &&
      isUuid(b.attemptId) &&
      isUuid(b.questionId) &&
      ['a', 'b', 'c', 'd'].includes(b.option)
    )
      call = db.rpc('extended_answer', {
        p_user: u,
        p_id: b.attemptId,
        p_request: b.requestId,
        p_question: b.questionId,
        p_option: b.option,
      });
    else return json({ error: 'Проверь ответ.' }, 400);
    const { data, error } = await call;
    return error ? fail(error) : json(data);
  });
}

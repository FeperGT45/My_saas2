import { readBodyText } from '@/lib/auth/body';
import { isUuid, json, lessonRequest, rpcError } from '@/lib/lessons/http';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  return lessonRequest(request, true, async (userId, db) => {
    const { attemptId } = await params;
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 8192));
    } catch {
      return json({ error: 'Некорректный ответ.' }, 400);
    }
    if (
      !isUuid(attemptId) ||
      !Number.isInteger(body?.position) ||
      body.position < 1 ||
      body.position > 100 ||
      body.answer === null ||
      body.answer === undefined ||
      Object.keys(body).some((k) => !['position', 'answer'].includes(k))
    )
      return json({ error: 'Некорректный ответ.' }, 400);
    const { data, error } = await db.rpc('submit_lesson_answer', {
      p_user: userId,
      p_attempt: attemptId,
      p_position: body.position,
      p_answer: body.answer,
    });
    return error ? rpcError(error) : json(data);
  });
}

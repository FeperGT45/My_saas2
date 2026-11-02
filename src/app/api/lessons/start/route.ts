import { readBodyText } from '@/lib/auth/body';
import { isUuid, json, lessonRequest, rpcError } from '@/lib/lessons/http';
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 2048));
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    if (
      !isUuid(body?.lessonId) ||
      !isUuid(body?.requestId) ||
      Object.keys(body).some((k) => !['lessonId', 'requestId'].includes(k))
    )
      return json({ error: 'Некорректный идентификатор.' }, 400);
    const { data, error } = await db.rpc('start_lesson', {
      p_user: userId,
      p_lesson: body.lessonId,
      p_request: body.requestId,
    });
    return error ? rpcError(error) : json(data);
  });
}

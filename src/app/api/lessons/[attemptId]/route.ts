import { isUuid, json, lessonRequest, rpcError } from '@/lib/lessons/http';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  return lessonRequest(request, false, async (userId, db) => {
    const { attemptId } = await params;
    if (!isUuid(attemptId))
      return json({ error: 'Некорректная попытка.' }, 400);
    const { data, error } = await db.rpc('lesson_state', {
      p_user: userId,
      p_attempt: attemptId,
    });
    return error ? rpcError(error) : json(data);
  });
}

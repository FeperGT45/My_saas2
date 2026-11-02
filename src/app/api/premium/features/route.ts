import { lessonRequest, json } from '@/lib/lessons/http';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    const { data, error } = await db.rpc('premium_features', {
      p_user: userId,
    });
    return error
      ? error.message.includes('premium required')
        ? json({ error: 'Требуется действующий Premium.' }, 403)
        : json({ error: 'Статистика временно недоступна.' }, 503)
      : json(data);
  });
}

import { lessonRequest, json } from '@/lib/lessons/http';
import { requirePremiumFeature } from '@/lib/premium/server';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if (new URL(request.url).search)
      return json({ error: 'Некорректные параметры.' }, 400);
    for (const feature of [
      'advanced_statistics',
      'lesson_review_plan',
    ] as const) {
      const denied = await requirePremiumFeature(userId, db, feature);
      if (denied) return denied;
    }
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

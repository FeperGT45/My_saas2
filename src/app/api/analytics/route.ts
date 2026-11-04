import { lessonRequest, json } from '@/lib/lessons/http';
import { requirePremiumFeature } from '@/lib/premium/server';
import {
  analyticsQuery,
  analyticsRecommendations,
  type EnglishAnalytics,
} from '@/lib/learning/analytics';
import type { LearningContext } from '@/lib/learning/recommend';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    const denied = await requirePremiumFeature(
      userId,
      db,
      'advanced_statistics',
    );
    if (denied) return denied;
    let query;
    try {
      query = analyticsQuery(new URL(request.url).searchParams);
    } catch {
      return json({ error: 'Выбери период 7, 30 или 90 дней.' }, 400);
    }
    const { data, error } = await db
      .rpc('english_analytics', {
        p_user: userId,
        p_days: query.days,
        p_offset: query.offset,
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (error)
      return json(
        {
          error: error.message.includes('premium required')
            ? 'Для подробного отчёта нужен действующий Premium.'
            : 'Не удалось загрузить аналитику. Попробуй ещё раз.',
        },
        error.message.includes('premium required') ? 403 : 503,
      );
    if (!data || data.version !== 'analytics-v1' || !data.context)
      return json({ error: 'Аналитика временно недоступна.' }, 503);
    const { context, ...report } = data as EnglishAnalytics & {
      context: LearningContext;
    };
    return json({
      ...report,
      recommendations: analyticsRecommendations(
        report.recommendations,
        context,
      ),
    });
  });
}

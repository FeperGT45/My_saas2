import { lessonRequest, json } from '@/lib/lessons/http';
import { buildLearningMap } from '@/lib/learning/map';
import type { LearningContext } from '@/lib/learning/recommend';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if (new URL(request.url).search)
      return json({ error: 'Некорректные параметры.' }, 400);
    const [context, statistics] = await Promise.all([
      db
        .rpc('learning_path_context', { p_user: userId })
        .abortSignal(AbortSignal.timeout(15000)),
      db
        .rpc('learner_statistics', { p_user: userId })
        .abortSignal(AbortSignal.timeout(15000)),
    ]);
    if (
      context.error ||
      statistics.error ||
      !context.data?.context ||
      !statistics.data
    )
      return json(
        { error: 'Не удалось загрузить личный прогресс. Повтори попытку.' },
        503,
      );
    return json({
      ...buildLearningMap(
        context.data.context as LearningContext,
        statistics.data.checkpointIds,
      ),
      statistics: statistics.data,
    });
  });
}

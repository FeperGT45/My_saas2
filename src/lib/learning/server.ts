import 'server-only';
import type { adminClient } from '@/lib/auth/session';
import { recommendLearningPath, type LearningContext } from './recommend';
type Database = ReturnType<typeof adminClient>;
export async function buildLearningPath(
  userId: string,
  db: Database,
  persist: boolean,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db
      .rpc('learning_path_context', { p_user: userId })
      .abortSignal(AbortSignal.timeout(15000));
    if (error || !data) throw new Error('learning unavailable');
    const plan = recommendLearningPath(data.context as LearningContext);
    if (!persist) return plan;
    const stored = await db
      .rpc('learning_path_store', {
        p_user: userId,
        p_token: data.token,
        p_plan: plan,
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (!stored.error) return plan;
    if (stored.error.message !== 'learning stale context')
      throw new Error('learning unavailable');
  }
  throw new Error('learning stale context');
}

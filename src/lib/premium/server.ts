import 'server-only';
import type { createServiceClient } from '@/lib/supabase/service';
import { json } from '@/lib/lessons/http';
import { isSubscriptionAccess, type PremiumFeature } from './permissions';
type Database = ReturnType<typeof createServiceClient>;
export async function premiumStatus(userId: string, db: Database) {
  const { data, error } = await db
    .rpc('premium_status', { p_user: userId })
    .abortSignal(AbortSignal.timeout(15000));
  if (error || !isSubscriptionAccess(data))
    throw Error('Premium status unavailable');
  return data;
}
/** Authenticated user ID must come from lessonRequest, never from request input. */
export async function requirePremiumFeature(
  userId: string,
  db: Database,
  feature: PremiumFeature,
) {
  const { data, error } = await db
    .rpc('has_feature', { p_user: userId, p_feature: feature })
    .abortSignal(AbortSignal.timeout(15000));
  if (error || typeof data !== 'boolean')
    return json({ error: 'Проверка доступа временно недоступна.' }, 503);
  return data
    ? null
    : json(
        { error: 'Требуется действующий Premium с доступом к этой функции.' },
        403,
      );
}

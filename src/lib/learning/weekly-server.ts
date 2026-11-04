import 'server-only';
import type { adminClient } from '@/lib/auth/session';
import {
  scheduleWeek,
  type WeeklyCommand,
  type WeeklySnapshot,
  type WeeklyPlan,
} from './weekly';
type Database = ReturnType<typeof adminClient>;
export async function refreshWeeklyPlan(
  userId: string,
  db: Database,
  command: WeeklyCommand,
): Promise<WeeklyPlan> {
  for (let retry = 0; retry < 2; retry++) {
    const loaded = await db
      .rpc('weekly_plan_snapshot', {
        p_user: userId,
        p_goal: command.action === 'settings' ? command.goal : null,
        p_minutes: command.action === 'settings' ? command.minutes : null,
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (loaded.error) throw Error(loaded.error.message);
    const snapshot = loaded.data as WeeklySnapshot;
    if (command.action === 'move') {
      const moved = await db
        .rpc('weekly_plan_move', {
          p_user: userId,
          p_id: snapshot.plan.id,
          p_day: command.day,
          p_date: command.date,
          p_revision: command.revision,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (moved.error) throw Error(moved.error.message);
      // A move is applied once. Never replay it on a stale-context retry.
      return refreshWeeklyPlan(userId, db, { action: 'refresh' });
    }
    if (snapshot.needsRebuild === false) return snapshot.plan;
    const stored = await db
      .rpc('weekly_plan_store', {
        p_user: userId,
        p_id: snapshot.plan.id,
        p_revision: snapshot.plan.revision,
        p_token: snapshot.token,
        p_days: scheduleWeek(snapshot),
      })
      .abortSignal(AbortSignal.timeout(15000));
    if (!stored.error) return stored.data as WeeklyPlan;
    if (stored.error.message !== 'weekly conflict')
      throw Error(stored.error.message);
  }
  throw Error('weekly conflict');
}

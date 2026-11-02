export const requiredTables = [
  'users',
  'languages',
  'courses',
  'units',
  'lessons',
  'exercises',
  'exercise_options',
  'user_progress',
  'lesson_attempts',
  'xp_events',
  'achievements',
  'user_achievements',
  'daily_streaks',
  'referrals',
  'subscriptions',
  'telegram_sessions',
  'lesson_attempt_items',
  'exercise_submissions',
  'coin_events',
  'star_orders',
  'star_events',
  'admin_audit_events',
] as const;
export type DatabaseReadiness = {
  schemaVersion: string;
  ready: boolean;
  tables: {
    name: string;
    exists: boolean;
    rls: boolean;
    clientWritesDenied: boolean;
    privateReadsDenied: boolean;
  }[];
  protectedColumns: boolean;
  rpcPermissions: boolean;
};
export function isDatabaseReady(value: unknown): value is DatabaseReadiness {
  if (!value || typeof value !== 'object') return false;
  const data = value as DatabaseReadiness;
  return (
    data.schemaVersion === '202611020010' &&
    data.ready === true &&
    data.protectedColumns === true &&
    data.rpcPermissions === true &&
    Array.isArray(data.tables) &&
    data.tables.length === requiredTables.length &&
    requiredTables.every(
      (name) =>
        data.tables.filter(
          (t) =>
            t.name === name &&
            t.exists === true &&
            t.rls === true &&
            t.clientWritesDenied === true &&
            t.privateReadsDenied === true,
        ).length === 1,
    )
  );
}

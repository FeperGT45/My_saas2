import { learningGoals, type LearningGoal } from './recommend';
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export type LearningCommand =
  | { action: 'refresh' }
  | { action: 'preferences'; goal: LearningGoal; courseId: string | null };
export function learningCommand(value: unknown): LearningCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid command');
  const v = value as Record<string, unknown>;
  if (v.action === 'refresh' && Object.keys(v).length === 1)
    return { action: 'refresh' };
  if (
    v.action === 'preferences' &&
    Object.keys(v).length === 3 &&
    typeof v.goal === 'string' &&
    Object.hasOwn(learningGoals, v.goal) &&
    (v.courseId === null || isUuid(v.courseId))
  )
    return {
      action: 'preferences',
      goal: v.goal as LearningGoal,
      courseId: v.courseId,
    };
  throw new Error('invalid command');
}

import { cefrLevels } from '@/lib/placement/types';
import {
  learningGoals,
  recommendLearningPath,
  type LearningContext,
  type LearningGoal,
} from './recommend';
export const dailyMinutes = [5, 10, 15, 20] as const;
export type DailyMinutes = (typeof dailyMinutes)[number];
export type WeeklyTask = {
  position: number;
  lessonId: string;
  title: string;
  kind: 'lesson' | 'practice';
  minutes: number;
  completedAt: string | null;
  ready: boolean;
};
export type WeeklyDay = { index: number; date: string; tasks: WeeklyTask[] };
export type WeeklyPlan = {
  id: string;
  start: string;
  today: string;
  timeZone: string;
  goal: LearningGoal;
  minutes: DailyMinutes;
  revision: number;
  days: WeeklyDay[];
};
export type WeeklySnapshot = {
  needsRebuild?: boolean;
  plan: WeeklyPlan;
  context: LearningContext;
  token: string;
};
export type WeeklyCommand =
  | { action: 'refresh' }
  | { action: 'settings'; goal: LearningGoal; minutes: DailyMinutes }
  | { action: 'move'; day: number; date: string; revision: number };
export function weeklyCommand(value: unknown): WeeklyCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('invalid command');
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(',');
  if (v.action === 'refresh' && keys === 'action') return { action: 'refresh' };
  if (
    v.action === 'settings' &&
    keys === 'action,goal,minutes' &&
    typeof v.goal === 'string' &&
    Object.hasOwn(learningGoals, v.goal) &&
    dailyMinutes.includes(v.minutes as DailyMinutes)
  )
    return {
      action: 'settings',
      goal: v.goal as LearningGoal,
      minutes: v.minutes as DailyMinutes,
    };
  if (
    v.action === 'move' &&
    keys === 'action,date,day,revision' &&
    Number.isInteger(v.day) &&
    Number(v.day) >= 0 &&
    Number(v.day) < 7 &&
    typeof v.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    Number.isFinite(Date.parse(v.date)) &&
    new Date(v.date).toISOString().slice(0, 10) === v.date &&
    Number.isSafeInteger(v.revision) &&
    Number(v.revision) >= 0
  )
    return {
      action: 'move',
      day: Number(v.day),
      date: v.date,
      revision: Number(v.revision),
    };
  throw Error('invalid command');
}
/** Pure deterministic scheduling. Time and saved state come from the database, never the browser. */
export function scheduleWeek(snapshot: WeeklySnapshot): WeeklyDay[] {
  const { plan } = snapshot;
  const context = { ...snapshot.context, courseId: null, goal: plan.goal };
  const ranked = recommendLearningPath(context, 28);
  const weak = new Set(ranked.skills.filter((s) => s.weak).map((s) => s.skill));
  const passed = new Set(
    context.lessons.filter((l) => (l.bestScore ?? 0) >= 60).map((l) => l.id),
  );
  const known = new Map(context.lessons.map((l) => [l.id, l]));
  const selected = new Set(
    plan.days.flatMap((d) =>
      d.tasks.filter((t) => t.completedAt).map((t) => t.lessonId),
    ),
  );
  const planned = new Set(passed);
  // New material follows the existing topological ranking. Practice can reuse an accessible lesson.
  const pool = ranked.items;
  const reviews = context.lessons
    .filter(
      (l) =>
        cefrLevels.indexOf(l.level) <=
          cefrLevels.indexOf(ranked.targetLevel ?? 'A1') + 1 &&
        l.prerequisites.every((id) => passed.has(id)) &&
        l.skills.some((s) => weak.has(s)),
    )
    .sort(
      (a, b) =>
        b.recentWrong - a.recentWrong ||
        (a.lastScore ?? 100) - (b.lastScore ?? 100) ||
        a.id.localeCompare(b.id),
    );
  const fallback = context.lessons.filter(
    (l) =>
      l.level === (ranked.targetLevel ?? context.level) &&
      l.prerequisites.every((id) => passed.has(id)),
  );
  let reviewIndex = 0;
  return [...plan.days]
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
    .map((day) => {
      // Past days and completed work are history, never silently rewritten.
      if (day.date < plan.today) {
        day.tasks.forEach((t) => planned.add(t.lessonId));
        return day;
      }
      const tasks = day.tasks.filter((t) => t.completedAt);
      tasks.forEach((t) => planned.add(t.lessonId));
      const used = new Set(tasks.map((t) => t.lessonId));
      let remaining = Math.max(
        0,
        plan.minutes - tasks.reduce((n, t) => n + t.minutes, 0),
      );
      const add = (
        lesson: (typeof context.lessons)[number],
        kind: WeeklyTask['kind'],
      ) => {
        let position = 0;
        while (tasks.some((t) => t.position === position)) position++;
        tasks.push({
          position,
          lessonId: lesson.id,
          title: lesson.title,
          kind,
          minutes: 5,
          completedAt: null,
          ready: lesson.prerequisites.every((id) => passed.has(id)),
        });
        remaining -= 5;
        used.add(lesson.id);
        selected.add(lesson.id);
        planned.add(lesson.id);
      };
      if (
        remaining >= 5 &&
        reviews.length &&
        (day.index % 2 === 1 || !pool.length)
      ) {
        const practice = reviews[reviewIndex++ % reviews.length];
        if (!used.has(practice.id)) add(practice, 'practice');
      }
      while (remaining >= 5) {
        const next = pool.find(
          (l) =>
            !selected.has(l.id) &&
            !used.has(l.id) &&
            l.prerequisites.every((id) => planned.has(id)),
        );
        if (next) {
          add(next, next.reason === 'practice' ? 'practice' : 'lesson');
          continue;
        }
        const repeat = [...reviews, ...fallback].find(
          (l) => !used.has(l.id) && known.has(l.id),
        );
        if (!repeat) break;
        add(repeat, 'practice');
      }
      return { ...day, tasks: tasks.sort((a, b) => a.position - b.position) };
    })
    .sort((a, b) => a.index - b.index);
}
export function weeklyStatistics(plan: WeeklyPlan) {
  const tasks = plan.days.flatMap((d) => d.tasks);
  const completed = tasks.filter((t) => t.completedAt);
  return {
    total: tasks.length,
    completed: completed.length,
    completedDays: plan.days.filter(
      (d) => d.tasks.length > 0 && d.tasks.every((t) => t.completedAt),
    ).length,
    plannedMinutes: tasks.reduce((n, t) => n + t.minutes, 0),
    completedMinutes: completed.reduce((n, t) => n + t.minutes, 0),
  };
}

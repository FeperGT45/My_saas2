import {
  recommendLearningPath,
  type LearningContext,
  type LearningLesson,
} from './recommend';
export type MapLesson = Pick<LearningLesson, 'id' | 'title' | 'bestScore'> & {
  state: 'completed' | 'recommended' | 'available' | 'foundation';
  checkpoint: boolean;
};
export function buildLearningMap(
  context: LearningContext,
  checkpointIds: string[] = [],
) {
  const plan = recommendLearningPath(context);
  const passed = new Set(
    context.lessons.filter((l) => (l.bestScore ?? -1) >= 60).map((l) => l.id),
  );
  const next = plan.items.find((l) => l.ready);
  const courses = plan.courses.map((c) => ({
    ...c,
    chapters: [
      ...new Set(
        context.lessons
          .filter((l) => l.courseId === c.id)
          .map((l) => l.unitTitle),
      ),
    ].map((title) => {
      const lessons: MapLesson[] = context.lessons
        .filter((l) => l.courseId === c.id && l.unitTitle === title)
        .map((l) => ({
          id: l.id,
          title: l.title,
          bestScore: l.bestScore,
          state: passed.has(l.id)
            ? 'completed'
            : l.id === next?.id
              ? 'recommended'
              : l.prerequisites.some((id) => !passed.has(id))
                ? 'foundation'
                : 'available',
          checkpoint:
            checkpointIds.includes(l.id) ||
            /контроль|итог|checkpoint/i.test(l.title),
        }));
      const completed = lessons.filter((l) => l.state === 'completed').length;
      return {
        title,
        lessons,
        completed,
        total: lessons.length,
        progress: lessons.length
          ? Math.round((100 * completed) / lessons.length)
          : 0,
      };
    }),
  }));
  return {
    plan,
    courses,
    next: next ? { id: next.id, title: next.title, reason: next.reason } : null,
  };
}
export type LearningMap = ReturnType<typeof buildLearningMap>;
export type LearnerStats = {
  passedLessons: number;
  completedAttempts: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  attemptMinutes: number | null;
  words: number;
  dueWords: number;
  reviews: number;
};
export type LearnerOverview = LearningMap & { statistics: LearnerStats };

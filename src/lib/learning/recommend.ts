import { cefrLevels, type CefrLevel } from '@/lib/placement/types';

export const learningGoals = {
  general: 'Общий английский',
  communication: 'Английский для общения',
  gaming: 'Английский для игр',
  travel: 'Английский для путешествий',
  study: 'Английский для учёбы',
} as const;
export type LearningGoal = keyof typeof learningGoals;
export type LearningSkill = 'grammar' | 'vocabulary' | 'reading' | 'listening';
export type SkillEvidence = {
  skill: LearningSkill;
  answered: number;
  correct: number;
};
export type LearningLesson = {
  id: string;
  title: string;
  unitTitle: string;
  courseId: string;
  courseTitle: string;
  level: CefrLevel;
  goals: LearningGoal[];
  skills: LearningSkill[];
  prerequisites: string[];
  bestScore: number | null;
  lastScore: number | null;
  recentWrong: number;
};
export type LearningContext = {
  level: CefrLevel | null;
  goal: LearningGoal;
  courseId: string | null;
  assessmentSkills: SkillEvidence[];
  recentSkills: SkillEvidence[];
  recentLessons: { lessonId: string; level: CefrLevel; score: number }[];
  lessons: LearningLesson[];
};
export type PlanItem = LearningLesson & {
  reason: 'practice' | 'foundation' | 'advance' | 'goal' | 'continue';
  ready: boolean;
};
export type LearningPlan = {
  version: 'rules-v1';
  level: CefrLevel | null;
  targetLevel: CefrLevel | null;
  goal: LearningGoal;
  courseId: string | null;
  skills: (SkillEvidence & {
    source: 'lessons' | 'placement';
    weak: boolean;
  })[];
  items: PlanItem[];
  fallback: boolean;
  mastered: number;
  available: number;
  courses: { id: string; title: string; level: CefrLevel }[];
  optionalReview: { id: string; title: string }[];
};
const rank = (level: CefrLevel) => cefrLevels.indexOf(level);
/** Pure, deterministic rules: no UI, clock, network, answer keys or XP writes. */
export function recommendLearningPath(context: LearningContext): LearningPlan {
  const skills = (
    ['grammar', 'vocabulary', 'reading', 'listening'] as const
  ).flatMap((skill) => {
    const recent = context.recentSkills.find(
      (s) => s.skill === skill && s.answered >= 3,
    );
    const evidence =
      recent ??
      context.assessmentSkills.find(
        (s) => s.skill === skill && s.answered >= 3,
      );
    return evidence
      ? [
          {
            ...evidence,
            source: recent ? ('lessons' as const) : ('placement' as const),
            weak: evidence.correct / evidence.answered < 0.6,
          },
        ]
      : [];
  });
  const result: LearningPlan = {
    version: 'rules-v1',
    level: context.level,
    targetLevel: context.level,
    goal: context.goal,
    courseId: context.courseId,
    skills,
    items: [],
    fallback: false,
    mastered: context.lessons.filter(
      (l) =>
        l.bestScore !== null &&
        l.bestScore >= 80 &&
        (l.lastScore ?? l.bestScore) >= 80,
    ).length,
    available: context.lessons.length,
    courses: [
      ...new Map(
        context.lessons.map((l) => [
          l.courseId,
          { id: l.courseId, title: l.courseTitle, level: l.level },
        ]),
      ).values(),
    ],
    optionalReview: [],
  };
  if (!context.level) return result;
  const base = rank(context.level);
  // Each lesson contributes only its latest completed attempt, never repeated successes.
  const uniqueRecent = context.recentLessons.filter(
    (l, i, all) => all.findIndex((x) => x.lessonId === l.lessonId) === i,
  );
  const recent = uniqueRecent.filter((l) => rank(l.level) === base).slice(0, 5);
  let target = base;
  if (
    recent.length >= 2 &&
    recent.slice(0, 3).filter((l) => l.score < 60).length >= 2
  )
    target = Math.max(0, base - 1);
  else if (
    recent.filter((l) => l.score >= 80).length >= 3 &&
    !recent.some((l) => l.score < 60)
  )
    target = Math.min(5, base + 1);
  result.targetLevel = cefrLevels[target];
  const weak = new Set(skills.filter((s) => s.weak).map((s) => s.skill));
  const pool = context.lessons.filter(
    (l) => !context.courseId || l.courseId === context.courseId,
  );
  const passed = new Set(
    context.lessons.filter((l) => (l.bestScore ?? -1) >= 60).map((l) => l.id),
  );
  const planned = new Set<string>();
  const ready = (l: LearningLesson) =>
    l.prerequisites.every((id) => passed.has(id));
  const eligible = (l: LearningLesson) =>
    l.prerequisites.every((id) => passed.has(id) || planned.has(id));
  // Bounded corrective practice. A successful retry removes this recommendation immediately.
  const reviews = pool
    .filter(
      (l) =>
        l.lastScore !== null &&
        l.lastScore < 80 &&
        l.recentWrong >= 2 &&
        l.skills.some((s) => weak.has(s)) &&
        ready(l),
    )
    .sort((a, b) => a.lastScore! - b.lastScore! || a.id.localeCompare(b.id))
    .slice(0, 2);
  for (const l of reviews) {
    result.items.push({ ...l, reason: 'practice', ready: true });
    planned.add(l.id);
  }
  const fresh = pool.filter(
    (l) =>
      (l.bestScore ?? -1) < 60 &&
      !planned.has(l.id) &&
      (context.courseId !== null || rank(l.level) <= Math.min(5, base + 1)) &&
      !(
        l.lastScore !== null &&
        l.recentWrong >= 2 &&
        l.skills.some((s) => weak.has(s))
      ),
  );
  const priority = (l: LearningLesson) =>
    Math.abs(rank(l.level) - target) * 100 +
    (l.goals.includes(context.goal) ? 0 : 10) +
    (l.skills.some((s) => weak.has(s)) ? 0 : 2);
  // Topological selection preserves prerequisites; upcoming steps never imply a permanent lock.
  while (result.items.length < 12) {
    const next = fresh
      .filter((l) => !planned.has(l.id) && eligible(l))
      .sort(
        (a, b) =>
          priority(a) - priority(b) ||
          a.courseId.localeCompare(b.courseId) ||
          context.lessons.indexOf(a) - context.lessons.indexOf(b),
      )[0];
    if (!next) break;
    result.items.push({
      ...next,
      ready: ready(next),
      reason:
        rank(next.level) < target
          ? 'foundation'
          : rank(next.level) > base
            ? 'advance'
            : next.goals.includes(context.goal)
              ? 'goal'
              : 'continue',
    });
    planned.add(next.id);
  }
  result.fallback =
    result.items.length > 0 &&
    !result.items.some((l) => l.level === result.targetLevel);
  if (!result.items.length)
    result.optionalReview = pool
      .filter((l) => (l.bestScore ?? -1) >= 60)
      .slice(0, 5)
      .map((l) => ({ id: l.id, title: l.title }));
  return result;
}

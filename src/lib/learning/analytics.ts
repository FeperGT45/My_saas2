import { recommendLearningPath, type LearningContext } from './recommend';
export const analyticsSkills = {
  grammar: 'Грамматика',
  vocabulary: 'Лексика',
  reading: 'Чтение',
  listening: 'Аудирование',
} as const;
export type AnalyticsSummary = {
  attempts: number;
  lessons: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  elapsedSeconds: number | null;
  averageSeconds: number | null;
  medianSeconds: number | null;
  longAttempts: number;
};
export type AnalyticsDay = {
  date: string;
  answered: number;
  correct: number;
  accuracy: number | null;
  attempts: number;
  elapsedSeconds: number | null;
};
export type AnalyticsTopic = {
  lessonId: string;
  title: string;
  unit: string;
  course: string;
  answered: number;
  correct: number;
  accuracy: number;
};
export type AnalyticsRecommendation = {
  lessonId: string;
  title: string;
  reason: 'weak_topic' | 'next_step';
};
export type EnglishAnalytics = {
  version: 'analytics-v1';
  days: 7 | 30 | 90;
  timeZone: string;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  current: AnalyticsSummary;
  previous: AnalyticsSummary;
  skills: {
    skill: keyof typeof analyticsSkills;
    answered: number;
    correct: number;
    accuracy: number | null;
    previousAnswered: number;
    previousCorrect: number;
    previousAccuracy: number | null;
  }[];
  unclassified: number;
  daily: AnalyticsDay[];
  topics: AnalyticsTopic[];
  history: {
    attemptId: string;
    lessonId: string;
    title: string;
    completedAt: string;
    score: number;
    elapsedSeconds: number;
    canOpen: boolean;
  }[];
  historyOffset: number;
  historyTotal: number;
  recommendations: AnalyticsRecommendation[];
};
export function analyticsQuery(params: URLSearchParams) {
  if (
    [...params.keys()].some((k) => !['days', 'offset'].includes(k)) ||
    params.getAll('days').length > 1 ||
    params.getAll('offset').length > 1
  )
    throw Error('invalid analytics parameters');
  const days = params.get('days') ?? '30',
    offset = params.get('offset') ?? '0';
  if (
    !['7', '30', '90'].includes(days) ||
    !/^\d{1,6}$/.test(offset) ||
    Number(offset) > 100000
  )
    throw Error('invalid analytics parameters');
  return { days: Number(days) as 7 | 30 | 90, offset: Number(offset) };
}
/** Descriptive comparison, not a confidence interval or a CEFR assessment. */
export function accuracyChange(
  current: { answered: number; accuracy: number | null },
  previous: { answered: number; accuracy: number | null },
) {
  return current.answered >= 5 &&
    previous.answered >= 5 &&
    current.accuracy !== null &&
    previous.accuracy !== null
    ? Math.round((current.accuracy - previous.accuracy) * 10) / 10
    : null;
}
export function analyticsRecommendations(
  weak: AnalyticsRecommendation[],
  context: LearningContext,
): AnalyticsRecommendation[] {
  const next = recommendLearningPath(context)
    .items.filter((i) => i.ready)
    .map((i) => ({
      lessonId: i.id,
      title: i.title,
      reason: 'next_step' as const,
    }));
  const unique = new Map<string, AnalyticsRecommendation>();
  for (const item of [...weak, ...next])
    if (!unique.has(item.lessonId)) unique.set(item.lessonId, item);
  return [...unique.values()].slice(0, 3);
}
/** Missing observations split the line. A day without answers is never plotted as 0%. */
export function analyticsSegments(days: AnalyticsDay[]) {
  const segments: { x: number; y: number }[][] = [];
  let segment: { x: number; y: number }[] = [];
  days.forEach((d, i) => {
    if (d.accuracy === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else
      segment.push({
        x: 20 + (560 * i) / Math.max(1, days.length - 1),
        y: 110 - d.accuracy,
      });
  });
  if (segment.length) segments.push(segment);
  return segments;
}
export const difficultTopics = (topics: AnalyticsTopic[]) =>
  topics
    .filter((t) => t.answered >= 5 && t.accuracy < 60)
    .sort((a, b) => a.accuracy - b.accuracy || b.answered - a.answered)
    .slice(0, 5);

import type { Exercise, Answer } from '@/features/lesson/types';
export type WeakTopic = {
  id: string;
  title: string;
  level: string;
  answered: number;
  wrong: number;
  accuracy: number | null;
  status: 'weak' | 'developing' | 'mastered' | 'insufficient';
  available: number;
};
export type WeakDashboard = {
  premium: boolean;
  enough: boolean;
  level: string | null;
  topics: WeakTopic[];
  activeId: string | null;
  history: {
    id: string;
    title: string;
    completedAt: string;
    before: number;
    after: number | null;
    xp: number;
  }[];
};
export type WeakState = {
  id: string;
  topicId: string;
  title: string;
  level: string;
  status: 'started' | 'completed' | 'abandoned';
  accessible: boolean;
  total: number;
  answered: number;
  correct: number;
  score: number | null;
  before: number;
  after: number | null;
  xp: number;
  recovered: number;
  exercise: (Exercise & { isNew: boolean; wasWrong: boolean }) | null;
};
export type WeakFeedback = {
  correct: boolean;
  explanation: string;
  state: WeakState;
  details?: { questionId: string; correct: boolean; explanation: string }[];
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function weakQuery(p: URLSearchParams) {
  if ([...p.keys()].some((k) => k !== 'run') || p.getAll('run').length > 1)
    throw Error('invalid query');
  const id = p.get('run');
  if (id !== null && !uuid(id)) throw Error('invalid run');
  return id;
}
export function weakCommand(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('invalid command');
  const b = input as Record<string, unknown>,
    keys = Object.keys(b).sort().join();
  if (
    b.action === 'start' &&
    keys === 'action,requestId,topicId' &&
    (b.topicId === null || uuid(b.topicId)) &&
    uuid(b.requestId)
  )
    return {
      action: 'start' as const,
      topicId: b.topicId as string | null,
      requestId: b.requestId,
    };
  if (
    b.action === 'answer' &&
    keys === 'action,answer,position,requestId,runId' &&
    uuid(b.runId) &&
    uuid(b.requestId) &&
    Number.isInteger(b.position) &&
    Number(b.position) >= 1 &&
    Number(b.position) <= 6
  ) {
    if (
      typeof b.answer !== 'string' &&
      !Array.isArray(b.answer) &&
      (!b.answer || typeof b.answer !== 'object')
    )
      throw Error('invalid answer');
    return {
      action: 'answer' as const,
      runId: b.runId,
      requestId: b.requestId,
      position: Number(b.position),
      answer: b.answer as Answer,
    };
  }
  throw Error('invalid command');
}

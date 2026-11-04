import type { Exercise, Answer } from '@/features/lesson/types';
export type Cosmetic = {
  code: string;
  title: string;
  description: string;
  slot: 'badge' | 'frame' | 'accent';
  tone: 'violet' | 'cyan' | 'amber' | 'rose' | 'emerald' | 'indigo';
  symbol: 'book' | 'spark' | 'bolt' | 'trophy' | 'leaf' | 'target';
  owned?: boolean;
  earnedAt?: string | null;
};
export type Showcase = { version: number; equipped: Cosmetic[] };
export type ChallengeTemplate = {
  code: string;
  title: string;
  description: string;
  kind: string;
  target: number;
  reward_code: string;
  featured: boolean;
};
export type ChallengeEnrollment = {
  id: string;
  code: string;
  edition: string;
  title: string;
  kind: string;
  target: number;
  reward_code: string;
  starts_at: string;
  ends_at: string;
  progress: number;
  completed_at: string | null;
  claimed_at: string | null;
};
export type Challenges = {
  premium: boolean;
  week: string;
  theme: string;
  serverTime: string;
  templates: ChallengeTemplate[];
  enrollments: ChallengeEnrollment[];
  cosmetics: Cosmetic[];
  showcase: Showcase;
};
export type SprintState = {
  id: string;
  enrollmentId: string;
  startedAt: string;
  completedAt: string | null;
  serverTime: string;
  elapsedSeconds: number;
  answered: number;
  correct: number;
  total: number;
  accessible: boolean;
  exercise: Exercise | null;
};
export type SprintFeedback = {
  correct: boolean;
  explanation: string;
  state: SprintState;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const code = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(v);
export function challengeQuery(p: URLSearchParams) {
  if (
    [...p.keys()].some((k) => !['view', 'run'].includes(k)) ||
    p.getAll('view').length > 1 ||
    p.getAll('run').length > 1
  )
    throw Error('invalid query');
  const view = p.get('view') ?? 'dashboard',
    run = p.get('run');
  if (
    !['dashboard', 'showcase', 'sprint'].includes(view) ||
    (view === 'sprint' ? !uuid(run) : run !== null)
  )
    throw Error('invalid query');
  return { view, run };
}
export function challengeCommand(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('invalid command');
  const b = input as Record<string, unknown>,
    keys = Object.keys(b).sort().join();
  if (
    b.action === 'enroll' &&
    keys === 'action,code,requestId' &&
    code(b.code) &&
    uuid(b.requestId)
  )
    return { action: 'enroll' as const, code: b.code, requestId: b.requestId };
  if (
    b.action === 'claim' &&
    keys === 'action,enrollmentId' &&
    uuid(b.enrollmentId)
  )
    return { action: 'claim' as const, enrollmentId: b.enrollmentId };
  if (
    b.action === 'equip' &&
    keys === 'action,code,slot,version' &&
    ['badge', 'frame', 'accent'].includes(String(b.slot)) &&
    (b.code === null || code(b.code)) &&
    Number.isInteger(b.version) &&
    Number(b.version) >= 0
  )
    return {
      action: 'equip' as const,
      slot: b.slot as Cosmetic['slot'],
      code: b.code as string | null,
      version: Number(b.version),
    };
  if (
    b.action === 'sprint_start' &&
    keys === 'action,enrollmentId,requestId' &&
    uuid(b.enrollmentId) &&
    uuid(b.requestId)
  )
    return {
      action: 'sprint_start' as const,
      enrollmentId: b.enrollmentId,
      requestId: b.requestId,
    };
  if (
    b.action === 'sprint_answer' &&
    keys === 'action,answer,position,requestId,runId' &&
    uuid(b.runId) &&
    uuid(b.requestId) &&
    Number.isInteger(b.position) &&
    Number(b.position) >= 1 &&
    Number(b.position) <= 5 &&
    (typeof b.answer === 'string' || (b.answer && typeof b.answer === 'object'))
  )
    return {
      action: 'sprint_answer' as const,
      runId: b.runId,
      requestId: b.requestId,
      position: Number(b.position),
      answer: b.answer as Answer,
    };
  throw Error('invalid command');
}

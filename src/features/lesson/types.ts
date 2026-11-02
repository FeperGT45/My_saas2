import type { Rewards } from '@/features/gamification/types';
// Browser DTOs deliberately contain no answer key, correctness flags or pre-check explanations.
export type Kind =
  'single_choice' | 'sentence' | 'gap' | 'matching' | 'grammar' | 'listening';
export type Item = { id: string; label: string };
export type Payload = {
  options?: Item[];
  tokens?: Item[];
  left?: Item[];
  right?: Item[];
  sentence?: string;
  text?: string;
  lang?: string;
};
export type Exercise = {
  position: number;
  kind: Kind;
  prompt: string;
  payload: Payload;
};
export type LessonState = {
  attemptId: string;
  lessonId: string;
  status: 'started' | 'completed' | 'abandoned';
  total: number;
  answered: number;
  correct: number;
  score: number | null;
  xp: number;
  rewards?: Rewards;
  exercise: Exercise | null;
};
export type Answer = string | string[] | Record<string, string>;
export type Feedback = {
  correct: boolean;
  explanation: string;
  state: LessonState;
};
export const defaultLessonId = '40000000-0000-0000-0000-000000000002';

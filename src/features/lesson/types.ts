import type { Rewards } from '@/features/gamification/types';
// Browser DTOs deliberately contain no answer key, correctness flags or pre-check explanations.
export type {
  ExerciseKind as Kind,
  ExerciseItem as Item,
  ExercisePayload as Payload,
} from '@/lib/exercises/contracts';
import type {
  ExerciseKind as Kind,
  ExercisePayload as Payload,
} from '@/lib/exercises/contracts';
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
  details?: { questionId: string; correct: boolean; explanation: string }[];
};
export const defaultLessonId = '40000000-0000-0000-0000-000000000002';

export type Entity = 'course' | 'unit' | 'lesson' | 'exercise';
export type AdminView =
  | 'overview'
  | 'users'
  | 'courses'
  | 'units'
  | 'lessons'
  | 'exercises'
  | 'languages'
  | 'activity'
  | 'subscriptions'
  | 'audit';
export type {
  ExerciseKind,
  ExerciseItem as Option,
  ExercisePayload,
  ExerciseKey as AnswerKey,
} from '@/lib/exercises/contracts';
import type {
  ExerciseKind,
  ExercisePayload,
  ExerciseKey as AnswerKey,
} from '@/lib/exercises/contracts';
export type AdminRow = {
  id: string;
  title?: string;
  display_name?: string;
  name?: string;
  code?: string;
  language_id?: string;
  course_id?: string;
  unit_id?: string;
  lesson_id?: string;
  slug?: string;
  level?: string;
  access_tier?: string;
  published?: boolean;
  free_preview?: boolean;
  position?: number;
  xp_reward?: number;
  admin_version?: number;
  kind?: ExerciseKind;
  prompt?: string;
  explanation?: string;
  premium_only?: boolean;
  public_payload?: ExercisePayload;
  answer_key?: AnswerKey;
  xp?: number;
  completions?: number;
  attempts?: number;
  average_score?: number | null;
  last_active_at?: string | null;
  created_at?: string;
  started_at?: string;
  completed_at?: string | null;
  score?: number | null;
  status?: string;
  lesson_title?: string;
  plan?: string;
  starts_at?: string;
  ends_at?: string;
  payment_state?: string | null;
  entity?: Entity;
  entity_id?: string;
  actor_name?: string;
  action?: string;
  version?: number;
};
export type AdminData = {
  items: AdminRow[];
  total: number;
  summary?: {
    users: number;
    activeUsers7d: number;
    started7d: number;
    completed7d: number;
    completionRate: number;
    averageScore7d: number;
    courses: number;
    publishedLessons: number;
  };
};

export const exerciseKinds = [
  'single_choice',
  'multiple_choice',
  'sentence',
  'translation',
  'gap',
  'matching',
  'word_order',
  'error_identification',
  'correction',
  'context_choice',
  'listening',
  'dictation',
  'reading',
  'dialogue',
  'response_choice',
  'spelling',
  'tenses',
  'synonym_antonym',
  'word_review',
  'unit_test',
  'grammar',
] as const;
export type ExerciseKind = (typeof exerciseKinds)[number];
export const exerciseLabels: Record<ExerciseKind, string> = {
  single_choice: 'Выбор перевода',
  multiple_choice: 'Несколько верных ответов',
  sentence: 'Собери предложение',
  translation: 'Перевод предложения',
  gap: 'Пропущенное слово',
  matching: 'Найди пары',
  word_order: 'Порядок слов',
  error_identification: 'Найди грамматическую ошибку',
  correction: 'Исправь предложение',
  context_choice: 'Слово по контексту',
  listening: 'Аудирование',
  dictation: 'Диктант',
  reading: 'Чтение с вопросом',
  dialogue: 'Мини-диалог',
  response_choice: 'Подходящая реплика',
  spelling: 'Собери слово',
  tenses: 'Английские времена',
  synonym_antonym: 'Синонимы и антонимы',
  word_review: 'Повторение слов',
  unit_test: 'Контрольный блок',
  grammar: 'Грамматика',
};
export type ExerciseItem = { id: string; label: string };
export type CheckpointQuestion = {
  id: string;
  prompt: string;
  options: ExerciseItem[];
};
export type ExercisePayload = {
  options?: ExerciseItem[];
  tokens?: ExerciseItem[];
  left?: ExerciseItem[];
  right?: ExerciseItem[];
  sentence?: string;
  text?: string;
  lang?: string;
  source?: string;
  passage?: string;
  context?: string;
  word?: string;
  relation?: 'synonym' | 'antonym';
  lines?: { speaker: string; text: string }[];
  questions?: CheckpointQuestion[];
};
// Only authoring/server code uses keys. Never include these fields in a learner DTO.
export type ExerciseKey = {
  value?: string | string[];
  accepted?: string[];
  pairs?: Record<string, string>;
  answers?: Record<string, string>;
  explanations?: Record<string, string>;
};
export const choiceKinds: readonly ExerciseKind[] = [
  'single_choice',
  'grammar',
  'listening',
  'error_identification',
  'context_choice',
  'reading',
  'dialogue',
  'response_choice',
  'tenses',
  'synonym_antonym',
  'word_review',
];
export const orderedKinds: readonly ExerciseKind[] = [
  'sentence',
  'word_order',
  'spelling',
];
export const openKinds: readonly ExerciseKind[] = [
  'translation',
  'correction',
  'dictation',
];

export const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof cefrLevels)[number];
export type Category = 'grammar' | 'vocabulary' | 'reading';
export type PlacementQuestion = {
  id: string;
  category: Category;
  prompt: string;
  passage: string | null;
  options: { id: string; label: string }[];
};
export type Assessment = {
  level: CefrLevel;
  source: 'adaptive' | 'beginner';
  confidence: number | null;
  interval: { from: CefrLevel; to: CefrLevel } | null;
  questions: number;
  categories: Partial<
    Record<Category, { answered: number; correct: number; accuracy: number }>
  >;
  strengths: Category[];
  improvements: string[];
  assessedAt: string;
};
export type PlacementStatus = {
  onboarded: boolean;
  attempt: {
    id: string;
    status: 'active' | 'completed';
    answered: number;
    minimum: number;
    maximum: number;
    question: PlacementQuestion | null;
    result: Assessment | null;
  } | null;
  assessment: Assessment | null;
  routeLevel: CefrLevel;
  recommendations: {
    course_id: string;
    course_title: string;
    level: CefrLevel;
    unit_title: string;
    lesson_id: string;
    lesson_title: string;
    review?: boolean;
  }[];
  history: {
    id: string;
    level: CefrLevel;
    confidence: number;
    completedAt: string;
  }[];
};
export type PlacementFeedback = {
  questionId: string;
  correct: boolean;
  correctOption: string;
  explanation: string;
};
export type PlacementResponse = {
  status: PlacementStatus;
  feedback?: PlacementFeedback;
};
export const categoryNames: Record<Category, string> = {
  grammar: 'Грамматика',
  vocabulary: 'Словарный запас',
  reading: 'Чтение',
};
export const levelDetails: Record<
  CefrLevel,
  { name: string; description: string; focus: string }
> = {
  A1: {
    name: 'Beginner',
    description:
      'Начинаем с простых слов, знакомых фраз и коротких предложений о себе.',
    focus: 'Базовые слова и простые предложения',
  },
  A2: {
    name: 'Elementary',
    description:
      'Можно переходить к повседневным ситуациям, простым сообщениям и диалогам.',
    focus: 'Повседневные диалоги и простая грамматика',
  },
  B1: {
    name: 'Intermediate',
    description:
      'Есть основа для понимания связных текстов и обсуждения знакомых тем.',
    focus: 'Сложные предложения и разговорные темы',
  },
  B2: {
    name: 'Upper-Intermediate',
    description:
      'Следующий шаг — аргументация, более сложные тексты и точный выбор конструкций.',
    focus: 'Продвинутые грамматические конструкции',
  },
  C1: {
    name: 'Advanced',
    description:
      'Полезно развивать понимание нюансов и точность в академических и рабочих контекстах.',
    focus: 'Академическая и профессиональная лексика',
  },
  C2: {
    name: 'Proficiency',
    description:
      'Следующий ориентир — тонкие смысловые различия, авторская позиция и стилистика сложных текстов.',
    focus: 'Сложные тексты и стилистические особенности',
  },
};
export const placementDisclaimer =
  'Это предварительная оценка CEFR по короткому тесту, а не сертификат. Она не заменяет полную проверку всех навыков: говорение, письмо и аудирование здесь не оценивались.';

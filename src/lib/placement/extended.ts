export type ExtendedResult = {
  level: string;
  from: string;
  to: string;
  confidence: number;
  categories: Record<
    string,
    { answered: number; correct: number; accuracy: number }
  >;
  questions: number;
};
export type ExtendedQuestion = {
  id: string;
  category: string;
  prompt: string;
  passage: string | null;
  options: { id: string; label: string }[];
};
export type ExtendedData = {
  id: string | null;
  status: string | null;
  answered: number;
  total: number;
  question: ExtendedQuestion | null;
  result: ExtendedResult | null;
  review: (Omit<ExtendedQuestion, 'id'> & {
    position: number;
    selected: string;
    correct: boolean;
    correctOption: string;
    explanation: string;
    level: string;
  })[];
  history: { id: string; completedAt: string; result: ExtendedResult }[];
  recommendations: { id: string; title: string; level: string }[];
};

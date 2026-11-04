import { PageTitle } from '@/components/ui/game';
import { WeakTrainingPanel } from '@/features/learning/weak-training-panel';
export const metadata = { title: 'Тренировка слабых тем · Voklumi' };
export default function WeakTrainingPage() {
  return (
    <>
      <PageTitle
        eyebrow="Точечная практика"
        title="Тренировка слабых тем"
        description="Разберись с тем, что пока вызывает трудности, и проверь улучшение."
      />
      <WeakTrainingPanel />
    </>
  );
}

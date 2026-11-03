import { PageTitle } from '@/components/ui/game';
import { LearningPanel } from '@/features/learning/learning-panel';
export const metadata = { title: 'Мой учебный план' };
export default function LearningPlanPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой английский"
        title="Мой учебный план"
        description="Следующие шаги с учётом уровня, цели и результатов."
      />
      <LearningPanel />
    </>
  );
}

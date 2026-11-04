import { PageTitle } from '@/components/ui/game';
import { LearningPanel } from '@/features/learning/learning-panel';
import { WeeklyPlanPanel } from '@/features/learning/weekly-panel';
export const metadata = { title: 'Мой учебный план' };
export default function LearningPlanPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой английский"
        title="Мой учебный план"
        description="Базовые рекомендации — для всех. Персональный календарь на неделю — в Premium."
      />
      <WeeklyPlanPanel />
      <details open className="rounded-2xl border px-4">
        <summary className="min-h-12 cursor-pointer py-4 font-bold">
          Базовые рекомендации · бесплатно
        </summary>
        <LearningPanel />
      </details>
    </>
  );
}

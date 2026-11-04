import { PageTitle } from '@/components/ui/game';
import { AnalyticsPanel } from '@/features/learning/analytics-panel';
export const metadata = { title: 'Аналитика английского · Voklumi' };
export default function AnalyticsPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твои результаты"
        title="Аналитика английского"
        description="Навыки, сложные темы и изменения по твоим сохранённым ответам."
      />
      <AnalyticsPanel />
    </>
  );
}

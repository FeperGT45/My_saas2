import { PageTitle } from '@/components/ui/game';
import { LearnerOverviewPanel } from '@/features/learning/overview-panel';
export const metadata = { title: 'Карта уроков · Voklumi' };
export default function LearnPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой маршрут"
        title="К звёздам, шаг за шагом"
        description="Карта доступных уроков, твои результаты и следующий шаг."
      />
      <LearnerOverviewPanel mode="map" />
    </>
  );
}

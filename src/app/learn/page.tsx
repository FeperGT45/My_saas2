import { PageTitle } from '@/components/ui/game';
import { LearnerOverviewPanel } from '@/features/learning/overview-panel';
export const metadata = { title: 'Карта уроков · Voklumi' };
export default function LearnPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой маршрут"
        title="Мои уроки"
        description="Начни с рекомендованного урока или выбери тему ниже. Пройденные уроки отмечены галочкой."
      />
      <LearnerOverviewPanel mode="map" />
    </>
  );
}

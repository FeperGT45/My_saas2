import { PageTitle } from '@/components/ui/game';
import Link from 'next/link';
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
      <Link
        href="/stories"
        className="border-primary/30 bg-primary/10 text-primary mt-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Читай и выбирай · интерактивные истории →
      </Link>
    </>
  );
}

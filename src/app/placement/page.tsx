import { PageTitle } from '@/components/ui/game';
import { PlacementPanel } from '@/features/placement/placement-panel';
export const metadata = { title: 'Мой уровень английского' };
export default async function PlacementPage({
  searchParams,
}: {
  searchParams: Promise<{ retest?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageTitle
        eyebrow="Твоя точка старта"
        title="Уровень английского"
        description="Короткий адаптивный тест и рекомендации для обучения."
      />
      <PlacementPanel retest={params.retest === '1'} />
    </>
  );
}

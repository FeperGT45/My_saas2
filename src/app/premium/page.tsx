import { PageTitle } from '@/components/ui/game';
import { PremiumPanel } from '@/features/premium/premium-panel';
import { PremiumFeatureHub } from '@/features/premium/feature-hub';
export const metadata = { title: 'Premium' };
export default function PremiumPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой следующий шаг"
        title="Voklumi Premium"
        description="Все расширенные возможности в одном месте. Выбери, чем заняться сегодня."
      />
      <PremiumPanel>
        <PremiumFeatureHub />
      </PremiumPanel>
    </>
  );
}

import { PageTitle } from '@/components/ui/game';
import { PremiumPanel } from '@/features/premium/premium-panel';
export const metadata = { title: 'Premium' };
export default function PremiumPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой следующий шаг"
        title="Voklumi Premium"
        description="Учись в своём темпе — возможности под твои цели."
      />
      <PremiumPanel />
    </>
  );
}

import { PageTitle } from '@/components/ui/game';
import { ChallengesPanel } from '@/features/challenges/challenges-panel';
export const metadata = { title: 'Испытания и награды · Voklumi' };
export default function ChallengesPage() {
  return (
    <>
      <PageTitle
        eyebrow="В своём ритме"
        title="Испытания и награды"
        description="Необязательные цели на неделю. Выбери то, что интересно тебе."
      />
      <ChallengesPanel />
    </>
  );
}

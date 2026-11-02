import { PageTitle } from '@/components/ui/game';
import { SocialPanel } from '@/features/social/social-panel';
export const metadata = { title: 'Рейтинг' };
export default function LeaderboardPage() {
  return (
    <>
      <PageTitle
        eyebrow="Вместе интереснее"
        title="На волне побед"
        description="Твой прогресс среди тех, кто выбрал открытый профиль."
      />
      <SocialPanel />
    </>
  );
}

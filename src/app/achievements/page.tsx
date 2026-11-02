import { PageTitle } from '@/components/ui/game';
import { GameDashboard } from '@/features/gamification/dashboard';
export const metadata = { title: 'Достижения' };
export default function AchievementsPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твоя коллекция"
        title="Маленькие триумфы"
        description="Каждая награда — настоящий шаг вперёд."
      />
      <GameDashboard onlyAchievements />
    </>
  );
}

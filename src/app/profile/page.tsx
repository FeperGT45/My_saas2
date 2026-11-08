import { LearningPlanLink } from '@/features/learning/learning-panel';
import { ChallengeProfileStyle } from '@/features/challenges/cosmetics';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { PageTitle } from '@/components/ui/game';
import { TelegramAccount } from '@/features/telegram/account';
import { PlacementProfile } from '@/features/placement/placement-panel';
import { GameDashboard } from '@/features/gamification/dashboard';
import { LearnerOverviewPanel } from '@/features/learning/overview-panel';
export const metadata = { title: 'Профиль' };
export default function ProfilePage() {
  return (
    <>
      <PageTitle
        eyebrow="Твоя история"
        title="Мой профиль"
        action={
          <Link
            href="/settings"
            aria-label="Настройки профиля"
            className="bg-muted rounded-xl p-3"
          >
            <Settings size={20} />
          </Link>
        }
      />
      <TelegramAccount />
      <ChallengeProfileStyle />
      <PlacementProfile />
      <LearnerOverviewPanel mode="profile" />
      <LearningPlanLink />
      <Link
        href="/review"
        className="text-primary my-3 inline-flex min-h-11 items-center"
      >
        Повторить слова →
      </Link>
      <Link
        href="/leaderboard"
        className="text-primary my-3 flex min-h-11 items-center"
      >
        Рейтинг учеников →
      </Link>
      <GameDashboard />
      <nav
        aria-label="Дополнительно в профиле"
        className="mt-5 space-y-2 border-t pt-4"
      >
        <Link
          href="/friends"
          className="text-primary flex min-h-12 items-center text-sm"
        >
          Друзья и приглашения →
        </Link>
        <Link
          href="/admin"
          className="text-muted-foreground flex min-h-11 items-center text-xs"
        >
          Администрирование →
        </Link>
      </nav>
    </>
  );
}

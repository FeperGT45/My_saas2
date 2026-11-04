import { LearningPlanLink } from '@/features/learning/learning-panel';
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
      <Link
        href="/stories"
        className="border-primary/30 bg-primary/10 text-primary mb-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Интерактивные истории →
      </Link>
      <Link
        href="/dictionary"
        className="border-primary/30 bg-primary/10 text-primary mb-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Мой словарь →
      </Link>
      <Link
        href="/analytics"
        className="border-primary/40 bg-primary/10 text-primary mb-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Аналитика английского · Premium →
      </Link>
      <Link
        href="/friends"
        className="border-border bg-card text-primary mb-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Друзья и приглашения →
      </Link>
      <Link
        href="/premium"
        className="border-primary/40 bg-primary/10 text-primary mb-4 flex min-h-12 items-center rounded-2xl border px-4 text-sm font-bold"
      >
        Premium · статус и возможности →
      </Link>
      <Link
        href="/admin"
        className="text-muted-foreground mb-5 flex min-h-11 items-center text-xs"
      >
        Администрирование →
      </Link>
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
    </>
  );
}

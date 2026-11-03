import { LearningPlanLink } from '@/features/learning/learning-panel';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { PageTitle } from '@/components/ui/game';
import { TelegramAccount } from '@/features/telegram/account';
import { PlacementProfile } from '@/features/placement/placement-panel';
import { GameDashboard } from '@/features/gamification/dashboard';
export const metadata = { title: 'Профиль' };
export default function ProfilePage() {
  return (
    <>
      <PageTitle
        eyebrow="Твоя история"
        title="Капитан своего пути"
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
      <LearningPlanLink />
      <GameDashboard />
    </>
  );
}

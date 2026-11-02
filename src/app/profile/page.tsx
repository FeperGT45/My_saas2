import Link from 'next/link';
import { Settings } from 'lucide-react';
import { PageTitle } from '@/components/ui/game';
import { TelegramAccount } from '@/features/telegram/account';
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
      <GameDashboard />
    </>
  );
}

'use client';
import Link from 'next/link';
import { useTelegram } from '@/features/telegram/provider';
import { PlacementHome } from '@/features/placement/placement-panel';
import { LearnerOverviewPanel } from './overview-panel';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
export function HomeLearning() {
  const { status, account, authError } = useTelegram();
  if (status === 'loading')
    return <p role="status">Готовим твой учебный план…</p>;
  if (account?.mode !== 'telegram')
    return (
      <Card className="border-primary/30">
        <h2 className="text-xl font-bold">Первый раз в Voklumi?</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          {authError
            ? 'Не удалось войти в аккаунт. Закрой приложение и открой его снова через кнопку в Telegram-боте.'
            : 'Открой приложение через кнопку в Telegram-боте. После входа выбери старт с нуля или пройди тест уровня — результаты будут сохраняться.'}
        </p>
        <Button asChild className="mt-4 w-full" variant="outline">
          <Link href="/courses">Посмотреть доступные уроки</Link>
        </Button>
        <p className="text-muted-foreground mt-3 text-xs">
          Сейчас можно посмотреть каталог. Для сохранения обучения нужен вход
          через Telegram.
        </p>
      </Card>
    );
  return (
    <div className="space-y-4">
      <PlacementHome />
      <LearnerOverviewPanel mode="home" />
    </div>
  );
}

'use client';
import { fetchWithTimeout } from '@/lib/http/client';
import { useState } from 'react';
import { useTelegram } from './provider';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useAppearance } from '@/features/personalization/appearance';
export function TelegramAccount() {
  const { account, authError, refresh } = useTelegram();
  const [error, setError] = useState(false);
  const appearance = useAppearance().data?.effective;
  if (!account)
    return authError ? (
      <Card className="mb-4">
        <p role="alert" className="text-sm text-rose-300">
          Не удалось войти. Закрой и снова открой Mini App. Проверь подключение;
          демоверсия остаётся доступной.
        </p>
      </Card>
    ) : null;
  return (
    <Card className="mb-4">
      <p className="eyebrow mb-3">
        {account.mode === 'local'
          ? 'Локальная тестовая сессия'
          : 'Аккаунт Telegram'}
      </p>
      <div
        className="appearance-identity flex items-center gap-3 rounded-2xl"
        data-frame={appearance?.frame}
        data-decoration={appearance?.decoration}
      >
        {account.avatarUrl ? (
          // Telegram-signed remote avatar; no server proxy or credentials sent to image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatarUrl}
            alt="Аватар Telegram"
            width={48}
            height={48}
            referrerPolicy="no-referrer"
            className="appearance-avatar size-12 rounded-2xl object-cover"
          />
        ) : (
          <span
            className="appearance-avatar border-primary flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 font-bold"
            aria-label="Аватар"
          >
            {account.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words">
            {account.name}
            {appearance?.badge === 'star'
              ? ' ✦'
              : appearance?.badge === 'leaf'
                ? ' ❧'
                : ''}
          </p>
          {account.telegramId && (
            <p className="text-muted-foreground text-xs">
              Telegram ID: {account.telegramId}
            </p>
          )}
        </div>
      </div>
      <p className="text-muted-foreground my-3 text-xs">
        Данные аккаунта подтверждены. Прогресс и награды ниже загружаются с
        сервера.
      </p>
      <Button
        variant="outline"
        onClick={async () => {
          setError(false);
          try {
            const r = await fetchWithTimeout('/api/auth/logout', {
              method: 'POST',
            });
            if (!r.ok) throw new Error();
            await refresh();
          } catch {
            setError(true);
          }
        }}
      >
        Выйти
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          Не удалось завершить сессию.
        </p>
      )}
    </Card>
  );
}

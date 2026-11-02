'use client';
import { useState } from 'react';
import { useTelegram } from './provider';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
export function TelegramAccount() {
  const { account, authError, refresh } = useTelegram();
  const [error, setError] = useState(false);
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
      <div className="flex items-center gap-3">
        {account.avatarUrl && (
          // Telegram-signed remote avatar; no server proxy or credentials sent to image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatarUrl}
            alt="Аватар Telegram"
            width={48}
            height={48}
            referrerPolicy="no-referrer"
            className="size-12 rounded-2xl object-cover"
          />
        )}
        <div>
          <p className="font-bold">{account.name}</p>
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
            const r = await fetch('/api/auth/logout', { method: 'POST' });
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

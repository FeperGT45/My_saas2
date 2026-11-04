'use client';
import { useTelegram } from './provider';
export function TelegramStatus() {
  const { status, account, authError } = useTelegram();
  const labels = {
    loading: 'Проверяем Telegram…',
    demo: 'Локальный режим',
    telegram: account
      ? 'Telegram · вход выполнен'
      : authError
        ? 'Telegram · ошибка входа'
        : 'Telegram · вход не выполнен',
    outside: 'Обзор в браузере',
    error: 'Telegram недоступен · обзор',
  };
  return (
    <p
      role="status"
      className="text-muted-foreground flex items-center gap-2 rounded-lg bg-white/[.03] px-3 py-2 text-xs"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-teal-300" />
      <span>
        {labels[status]} ·{' '}
        {account?.mode === 'telegram'
          ? 'сохранение уроков включено'
          : 'для сохранения уроков нужен вход'}
      </span>
    </p>
  );
}

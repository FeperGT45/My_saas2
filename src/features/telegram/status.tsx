'use client';
import { useTelegram } from './provider';
export function TelegramStatus() {
  const { status } = useTelegram();
  const labels = {
    loading: 'Проверяем окружение…',
    demo: 'Локальный деморежим · данные не сохраняются',
    telegram: 'Telegram подключён · вход ещё не реализован',
    outside: 'Откройте приложение в Telegram. Сейчас доступен только обзор.',
    error: 'Не удалось запустить Telegram SDK. Доступен только обзор.',
  };
  return (
    <p
      role="status"
      className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-center text-xs"
    >
      {labels[status]}
    </p>
  );
}

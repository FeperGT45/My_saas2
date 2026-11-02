'use client';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
export function AdminAccessMessage({
  unavailable = false,
}: {
  unavailable?: boolean;
}) {
  const router = useRouter();
  return (
    <Card>
      <ShieldAlert className="text-primary mb-4" size={32} />
      <h2 className="text-lg font-bold">
        {unavailable ? 'Панель временно недоступна' : 'Доступ ограничен'}
      </h2>
      <p className="text-muted-foreground my-4 text-sm">
        {unavailable
          ? 'Не удалось проверить серверную сессию. Повтори попытку позже.'
          : 'Нужен вход через Telegram и права администратора. После входа обнови доступ. Локальный деморежим панель не открывает.'}
      </p>
      <Button variant="outline" onClick={() => router.refresh()}>
        Обновить доступ
      </Button>
    </Card>
  );
}

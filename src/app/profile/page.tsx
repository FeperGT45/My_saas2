import type { Metadata } from 'next';
import { UserRound, ShieldCheck } from 'lucide-react';
export const metadata: Metadata = { title: 'Профиль' };
export default function ProfilePage() {
  return (
    <>
      <h1 className="text-3xl font-bold">Профиль</h1>
      <section className="border-border bg-card mt-7 rounded-3xl border p-6">
        <UserRound size={42} className="text-primary" />
        <h2 className="mt-4 text-xl font-bold">Будем знакомы</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Вход через Telegram будет доступен после подключения серверной
          проверки. Личные данные пока не загружаются.
        </p>
      </section>
      <dl className="mt-6 space-y-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Язык интерфейса</dt>
          <dd>Русский</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Изучаемый язык</dt>
          <dd>Английский</dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-7 flex gap-2 text-xs leading-relaxed">
        <ShieldCheck size={20} className="shrink-0" />
        Демонстрационный режим не создаёт учётную запись и не сохраняет
        прогресс.
      </p>
    </>
  );
}

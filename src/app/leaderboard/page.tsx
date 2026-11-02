import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
export const metadata: Metadata = { title: 'Рейтинг' };
export default function LeaderboardPage() {
  return (
    <>
      <h1 className="text-3xl font-bold">Рейтинг</h1>
      <p className="text-muted-foreground mt-3 text-sm">
        Учиться вместе интереснее.
      </p>
      <section className="border-border bg-card mt-8 rounded-3xl border p-8 text-center">
        <Trophy size={48} className="text-primary mx-auto" />
        <h2 className="mt-5 text-xl font-bold">Здесь будут победы</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Лиги и таблица лидеров появятся после запуска уроков. Пока здесь нет
          участников и результатов.
        </p>
      </section>
    </>
  );
}

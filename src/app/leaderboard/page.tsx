'use client';
import { useState } from 'react';
import { Crown, Trophy, Users, ArrowUpRight } from 'lucide-react';
import { PageTitle, Card, EmptyState } from '@/components/ui/game';
import { demoRanking } from '@/features/demo/data';
import { cn } from '@/lib/utils';
export default function LeaderboardPage() {
  const [tab, setTab] = useState('league');
  const winner = demoRanking[0];
  return (
    <>
      <PageTitle
        eyebrow="Вместе интереснее"
        title="На волне побед"
        description="Каждое новое слово поднимает тебя выше."
      />
      <div
        role="group"
        aria-label="Вид рейтинга"
        className="bg-muted mb-5 grid grid-cols-2 gap-1 rounded-2xl p-1"
      >
        {[
          { id: 'league', label: 'Лига' },
          { id: 'friends', label: 'Друзья' },
        ].map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-11 rounded-xl text-sm font-bold',
              tab === t.id
                ? 'bg-card text-foreground shadow'
                : 'text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'friends' ? (
        <EmptyState
          icon={<Users />}
          title="Твоя команда ещё в пути"
          text="Приглашения друзей появятся в полной версии. Сейчас это только демо."
        />
      ) : (
        <>
          <Card className="starfield border-primary/25 bg-gradient-to-br from-purple-500/15 to-blue-500/10 text-center">
            <span className="border-primary/30 bg-primary/15 text-primary inline-flex rounded-2xl border p-3">
              <Trophy size={30} />
            </span>
            <h2 className="mt-3 text-lg font-bold">Аметистовая лига</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Пример недельного соревнования
            </p>
            <div className="mt-5 flex items-end justify-center gap-3">
              {[demoRanking[1], winner, demoRanking[2]].map((p, i) => (
                <div
                  key={p.name}
                  className={cn(
                    'flex w-1/3 flex-col items-center rounded-t-2xl bg-white/5 p-3',
                    i === 1 && 'border-primary/40 bg-primary/15 border-t pb-7',
                  )}
                >
                  <span className="text-primary mb-2 text-xs">
                    {i === 1 ? <Crown size={20} /> : i === 0 ? '2' : '3'}
                  </span>
                  <span className="bg-primary/20 flex size-10 items-center justify-center rounded-full text-xs font-bold">
                    {p.initials}
                  </span>
                  <p className="mt-2 text-xs font-bold">{p.name}</p>
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    {p.xp} XP
                  </p>
                </div>
              ))}
            </div>
          </Card>
          <div className="mt-5 space-y-2">
            {demoRanking.map((player, i) => (
              <div
                key={player.name}
                className={cn(
                  'border-border bg-card flex items-center gap-3 rounded-2xl border p-4',
                  i === 3 && 'border-primary/50 bg-primary/10',
                )}
              >
                <span className="text-muted-foreground w-4 text-xs">
                  {i + 1}
                </span>
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold">
                  {player.initials}
                </span>
                <span className="flex-1 text-sm font-bold">
                  {player.name}
                  {i === 3 && (
                    <span className="text-primary ml-2 text-[10px]">
                      ты · демо
                    </span>
                  )}
                </span>
                <span className="text-xs font-bold text-teal-200">
                  {player.xp} XP
                </span>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
            <ArrowUpRight size={15} />
            Все игроки и результаты вымышлены.
          </p>
        </>
      )}
    </>
  );
}

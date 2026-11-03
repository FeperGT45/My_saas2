'use client';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTelegram } from '@/features/telegram/provider';
import { Card, Progress } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import {
  Coins,
  Flame,
  Medal,
  ChevronRight,
  Target,
  Zap,
  CalendarCheck,
} from 'lucide-react';
import type { GameSummary } from './types';
export function GameDashboard({
  onlyAchievements = false,
  compact = false,
}: {
  onlyAchievements?: boolean;
  compact?: boolean;
}) {
  const { account, status } = useTelegram();
  const [data, setData] = useState<GameSummary | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState('UTC');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!account || account.mode !== 'telegram') return;
    let active = true;
    void fetchWithTimeout('/api/game', { cache: 'no-store' })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(body.error);
        if (active) {
          setData(body);
          setOwner(account.id);
          setZone(body.timeZone);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message ?? 'Не удалось загрузить прогресс.');
      });
    return () => {
      active = false;
    };
  }, [account, retry]);
  if (status === 'loading')
    return (
      <p role="status" className="text-muted-foreground animate-pulse text-sm">
        Проверяем аккаунт…
      </p>
    );
  if (!account || account.mode !== 'telegram')
    return (
      <Card>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Войди через Telegram, чтобы увидеть свои XP, монеты и достижения.
          Локальная сессия не начисляет реальные награды.
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/learn">К учебным урокам</Link>
        </Button>
        {!onlyAchievements && (
          <Link
            href="/achievements"
            className="text-primary mt-3 flex min-h-11 items-center text-sm"
          >
            Мои достижения
          </Link>
        )}
      </Card>
    );
  if ((!data || owner !== account.id) && !error)
    return (
      <div role="status" className="animate-pulse space-y-3">
        <p className="text-muted-foreground text-sm">
          Загружаем твой прогресс…
        </p>
        <div className="bg-muted h-48 rounded-3xl" />
      </div>
    );
  if (!data || owner !== account.id)
    return (
      <Card>
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => setRetry((v) => v + 1)}
        >
          Повторить загрузку
        </Button>
      </Card>
    );
  const badges = (
    <div className="grid grid-cols-2 gap-3">
      {data.achievements.map((badge) => (
        <Card
          key={badge.code}
          className={
            badge.unlocked ? 'border-primary/40 bg-primary/10' : 'opacity-70'
          }
        >
          <Medal
            size={28}
            className={
              badge.unlocked ? 'text-primary' : 'text-muted-foreground'
            }
          />
          <h3 className="mt-3 text-sm font-bold">{badge.title}</h3>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {badge.description}
          </p>
          <p className="mt-3 text-[10px] text-amber-200">
            {badge.unlocked ? 'Получено' : 'Впереди'} · {badge.coins} монет
          </p>
        </Card>
      ))}
    </div>
  );
  if (onlyAchievements) return badges;
  if (compact)
    return (
      <Card>
        <h2 className="font-bold">Твой прогресс</h2>
        <p className="mt-3">
          {data.xp} XP · {data.streak.current} дней подряд ·{' '}
          {data.completedLessons} зачтённых уроков
        </p>
        <Link
          className="text-primary inline-flex min-h-11 items-center"
          href="/profile"
        >
          Статистика и награды →
        </Link>
      </Card>
    );
  return (
    <>
      <Card className="starfield">
        <p className="eyebrow">Твой настоящий прогресс</p>
        <h2 className="mt-2 text-2xl font-extrabold">
          Уровень опыта {data.level}
        </h2>
        <p className="text-muted-foreground mt-2 text-xs">
          {data.xp} XP всего · следующий уровень с {data.nextLevelXp} XP
        </p>
        <Progress
          className="mt-4"
          value={data.levelProgress}
          label="До следующего уровня"
        />
        <p className="text-muted-foreground mt-2 text-[10px]">
          {data.xp - data.levelFloor} / {data.nextLevelXp - data.levelFloor} XP
          на этом уровне
        </p>
      </Card>
      <div className="my-4 grid grid-cols-3 gap-2">
        {[
          {
            icon: Coins,
            label: 'Монеты',
            value: data.coins,
            color: 'text-amber-200',
          },
          {
            icon: Flame,
            label: 'Дней подряд',
            value: data.streak.current,
            color: 'text-orange-300',
          },
          {
            icon: CalendarCheck,
            label: 'Зачтено уроков',
            value: data.completedLessons,
            color: 'text-teal-300',
          },
        ].map(({ icon: Icon, label, value, color }) => (
          <Card key={label} className="!p-3 text-center">
            <Icon size={20} className={`mx-auto ${color}`} />
            <p className="mt-2 font-extrabold">{value}</p>
            <p className="text-muted-foreground mt-1 text-[10px]">{label}</p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Target size={18} className="text-teal-300" />
          Ежедневные цели
        </h2>
        <p className="text-muted-foreground mt-2 text-[10px]">
          {data.today} · {data.timeZone}
        </p>
        <div className="mt-4 space-y-4">
          {data.daily.map((quest) => (
            <div key={quest.id}>
              <div className="mb-2 flex justify-between gap-2 text-xs">
                <span>{quest.title}</span>
                <span className="text-amber-200">
                  {quest.claimed ? 'Получено' : `+${quest.coins} монет`}
                </span>
              </div>
              <Progress
                value={(quest.progress / quest.target) * 100}
                label={quest.title}
              />
              <p className="text-muted-foreground mt-1 text-[10px]">
                {quest.progress} / {quest.target} впервые зачтённых уроков
              </p>
            </div>
          ))}
        </div>
      </Card>
      <Card className="mt-4">
        <h2 className="text-sm font-bold">Календарь занятий</h2>
        <p className="text-muted-foreground mt-2 text-xs">
          Рекорд: {data.streak.longest} дн. · Часовой пояс: {data.timeZone}
        </p>
        {data.timeZoneLocked ? (
          <p className="text-muted-foreground mt-3 text-[11px]">
            Часовой пояс закреплён после первого занятия. Это защищает
            ежедневные награды.
          </p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              try {
                const response = await fetchWithTimeout('/api/game/timezone', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ timeZone: zone }),
                });
                const result = await readJson(response);
                if (!response.ok) throw new Error(result.error);
                setRetry((v) => v + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Ошибка сохранения.');
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block text-xs">
              Часовой пояс IANA
              <input
                value={zone}
                maxLength={80}
                onChange={(e) => setZone(e.target.value)}
                className="border-border bg-background mt-2 min-h-12 w-full rounded-xl border px-3 text-sm"
                placeholder="Europe/Moscow"
              />
            </label>
            <button
              type="button"
              className="text-primary min-h-11 text-xs"
              onClick={() =>
                setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
              }
            >
              Определить по устройству
            </button>
            <Button disabled={pending} variant="outline" className="w-full">
              {pending ? 'Сохраняем…' : 'Сохранить до первого занятия'}
            </Button>
            <p className="text-muted-foreground text-[10px]">
              После первого зачтённого занятия зона фиксируется. Без выбора
              используется UTC.
            </p>
          </form>
        )}
      </Card>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      <Link
        href="/achievements"
        className="my-5 flex min-h-12 items-center justify-between text-sm font-bold"
      >
        <span className="flex items-center gap-2">
          <Medal className="text-primary" size={20} />
          Мои достижения
        </span>
        <ChevronRight size={18} />
      </Link>
      {badges}
      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Zap className="text-primary" size={18} />
          Пройденные разделы
        </h2>
        {data.sections.length ? (
          data.sections.map((s, i) => (
            <p
              key={`${s.kind}:${s.title}:${i}`}
              className="mt-3 flex justify-between gap-2 text-xs"
            >
              <span>{s.title}</span>
              <span className="shrink-0 text-amber-200">+{s.coins} монет</span>
            </p>
          ))
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">
            Заверши все опубликованные уроки блока или курса с результатом от
            60%, чтобы получить бонус.
          </p>
        )}
      </Card>
      <p className="text-muted-foreground mt-5 text-[11px] leading-relaxed">
        Монеты — внутренняя учебная валюта без денежной стоимости. Покупки на
        этом этапе не подключены.
      </p>
    </>
  );
}

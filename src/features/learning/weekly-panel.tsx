'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Sparkles } from 'lucide-react';
import { useTelegram } from '@/features/telegram/provider';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/game';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import { learningGoals, type LearningGoal } from '@/lib/learning/recommend';
import {
  dailyMinutes,
  weeklyStatistics,
  type DailyMinutes,
  type WeeklyCommand,
  type WeeklyPlan,
} from '@/lib/learning/weekly';
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(
    new Date(date + 'T12:00:00Z'),
  );
export function WeeklyPlanPanel() {
  const { account } = useTelegram();
  return <AccountWeek key={account?.id ?? 'anonymous'} />;
}
function AccountWeek() {
  const { account, status } = useTelegram();
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [goal, setGoal] = useState<LearningGoal>('general');
  const [minutes, setMinutes] = useState<DailyMinutes>(10);
  const [selected, setSelected] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const locked = useRef(false),
    active = useRef(false);
  const load = useCallback(async (command: WeeklyCommand) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body = await readJson(response);
      if (!active.current) return;
      if (!response.ok) {
        setCode(response.status === 403 ? 'premium' : (body.code ?? ''));
        // Never leave paid content visible after an access failure or expired session.
        setPlan(null);
        throw Error(body.error ?? 'Не удалось загрузить неделю.');
      }
      setPlan(body);
      setCode('');
      setGoal(body.goal);
      setMinutes(body.minutes);
      setSelected((current) =>
        body.days.some((d: { date: string }) => d.date === current)
          ? current
          : body.today,
      );
      setDestination('');
      if (command.action === 'settings')
        setNotice('Цель и нагрузка сохранены. Будущие задания обновлены.');
      if (command.action === 'move')
        setNotice('Занятия поменялись днями. Выполненные задания сохранены.');
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : 'Не удалось загрузить неделю.',
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(() => {
      if (account?.mode === 'telegram') void load({ action: 'refresh' });
    }, 0);
    return () => {
      active.current = false;
      clearTimeout(timer);
    };
  }, [account, load]);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void load({ action: 'refresh' });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    // Also recheck expiry while the calendar stays open.
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, [account, load]);
  if (status === 'loading') return <p role="status">Проверяем вход…</p>;
  if (account?.mode !== 'telegram' || code === 'premium')
    return (
      <Card className="border-primary/30 mb-5">
        <Sparkles className="text-primary" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-bold">Твоя неделя английского</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Premium подбирает занятия на семь дней: по твоему уровню, цели и
          ошибкам. Выбери 5–20 минут в день и переноси занятия, когда удобно.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href={account?.mode === 'telegram' ? '/premium' : '/profile'}>
            {account?.mode === 'telegram'
              ? 'Мой Premium'
              : 'Вход через Telegram'}
          </Link>
        </Button>
        <p className="text-muted-foreground mt-3 text-xs">
          Базовые рекомендации ниже доступны бесплатно. Реальные платежи пока
          выключены.
        </p>
      </Card>
    );
  const stats = plan ? weeklyStatistics(plan) : null;
  const day = plan?.days.find((d) => d.date === selected);
  const ordered = plan
    ? [...plan.days].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  return (
    <section
      aria-label="Персональный план на 7 дней"
      className="mb-6 space-y-4"
      aria-busy={busy}
    >
      {error && (
        <Card>
          <p role="alert">{error}</p>
          {code === 'level_required' ? (
            <Button asChild className="mt-3">
              <Link href="/placement">Выбрать свой уровень</Link>
            </Button>
          ) : (
            <Button
              className="mt-3"
              disabled={busy}
              onClick={() => void load({ action: 'refresh' })}
            >
              Обновить план
            </Button>
          )}
        </Card>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-200">
          {notice}
        </p>
      )}
      {!plan && !error && (
        <p role="status">Составляем неделю по твоим результатам…</p>
      )}
      {plan && stats && (
        <>
          <Card className="starfield border-primary/30">
            <p className="eyebrow flex items-center gap-2">
              <CalendarDays size={16} aria-hidden="true" />
              План на 7 дней · Premium
            </p>
            <h2 className="mt-3 text-xl font-bold">
              {dateLabel(plan.start, { day: 'numeric', month: 'long' })} —{' '}
              {dateLabel(ordered[6].date, { day: 'numeric', month: 'long' })}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {learningGoals[plan.goal]} · около {plan.minutes} мин в день
            </p>
            <Progress
              className="mt-4"
              value={stats.total ? (100 * stats.completed) / stats.total : 0}
              label="Выполнение недельного плана"
            />
            <p className="mt-3 text-sm">
              {stats.completed} из {stats.total} заданий · {stats.completedDays}{' '}
              из 7 занятий завершено
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              {stats.completedMinutes} из {stats.plannedMinutes} плановых минут
              выполнено. Это оценка нагрузки, а не замер времени.
            </p>
          </Card>
          <div
            className="grid grid-cols-7 gap-1"
            role="group"
            aria-label="Дни занятий"
          >
            {ordered.map((d) => (
              <button
                key={d.index}
                type="button"
                disabled={busy}
                aria-pressed={selected === d.date}
                aria-label={`${dateLabel(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${d.tasks.length && d.tasks.every((t) => t.completedAt) ? ', выполнено' : ''}`}
                onClick={() => {
                  setSelected(d.date);
                  setDestination('');
                }}
                className={`flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border py-2 text-xs ${selected === d.date ? 'border-primary bg-primary/15 text-primary' : 'bg-card border-border'}`}
              >
                <span>{dateLabel(d.date, { weekday: 'short' })}</span>
                <span className="text-base font-bold">
                  {dateLabel(d.date, { day: 'numeric' })}
                </span>
                <span aria-hidden="true">
                  {d.tasks.length && d.tasks.every((t) => t.completedAt)
                    ? '✓'
                    : d.date === plan.today
                      ? '●'
                      : '·'}
                </span>
              </button>
            ))}
          </div>
          {day && (
            <Card>
              <h3 className="font-bold">
                {day.date === plan.today ? 'Сегодня · ' : ''}
                {dateLabel(day.date, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </h3>
              <p className="text-muted-foreground mt-2 text-xs">
                Занятие {day.index + 1} · даты учитывают часовой пояс{' '}
                {plan.timeZone}.
              </p>
              {day.tasks.length === 0 && (
                <p className="text-muted-foreground mt-4 text-sm">
                  Подходящих заданий пока нет. Пройди базовый урок или выбери
                  другую цель и обнови план.
                </p>
              )}
              <ol className="mt-4 space-y-3">
                {day.tasks.map((t) => (
                  <li key={t.position} className="rounded-2xl border p-3">
                    <p className="text-primary flex items-center gap-2 text-xs">
                      {t.completedAt ? (
                        <CheckCircle2 size={15} aria-hidden="true" />
                      ) : (
                        <Clock3 size={15} aria-hidden="true" />
                      )}
                      {t.completedAt
                        ? 'Выполнено'
                        : t.kind === 'practice'
                          ? 'Дополнительная практика'
                          : 'Урок'}{' '}
                      · ≈ {t.minutes} мин
                    </p>
                    <p className="mt-2 font-semibold break-words">{t.title}</p>
                    {t.kind === 'practice' && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Повторение материала для закрепления; при наличии слабых
                        тем они получают приоритет.
                      </p>
                    )}
                    {!t.ready && !t.completedAt && (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Сначала рекомендуем закончить предыдущие уроки курса.
                      </p>
                    )}
                    {!t.completedAt && (
                      <Button asChild className="mt-3 w-full">
                        <Link href={`/lesson?lesson=${t.lessonId}`}>
                          {t.kind === 'practice'
                            ? 'Начать практику'
                            : 'Начать урок'}
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
              {day.date >= plan.today &&
                !day.tasks.some((t) => t.completedAt) && (
                  <details className="mt-4">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">
                      Перенести занятие
                    </summary>
                    <p className="text-muted-foreground mb-3 text-xs">
                      Выбранное занятие и занятие другого дня поменяются
                      местами. Дни с выполненными заданиями переносить нельзя.
                    </p>
                    <label className="block text-sm">
                      Новая дата
                      <select
                        className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
                        value={destination}
                        disabled={busy}
                        onChange={(e) => setDestination(e.target.value)}
                      >
                        <option value="">Выбери день</option>
                        {ordered
                          .filter(
                            (d) =>
                              d.date >= plan.today &&
                              d.index !== day.index &&
                              !d.tasks.some((t) => t.completedAt),
                          )
                          .map((d) => (
                            <option key={d.index} value={d.date}>
                              {dateLabel(d.date, {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              })}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      className="mt-3 w-full"
                      disabled={busy || !destination}
                      onClick={() =>
                        void load({
                          action: 'move',
                          day: day.index,
                          date: destination,
                          revision: plan.revision,
                        })
                      }
                    >
                      Перенести
                    </Button>
                  </details>
                )}
            </Card>
          )}
          <details className="bg-card rounded-2xl border px-4">
            <summary className="min-h-12 cursor-pointer py-4 font-bold">
              Цель и время занятий
            </summary>
            <form
              className="mb-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void load({ action: 'settings', goal, minutes });
              }}
            >
              <label className="block text-sm">
                Зачем тебе английский?
                <select
                  className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
                  value={goal}
                  disabled={busy}
                  onChange={(e) => setGoal(e.target.value as LearningGoal)}
                >
                  {Object.entries(learningGoals).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset disabled={busy}>
                <legend className="text-sm">
                  Сколько времени в день удобно?
                </legend>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {dailyMinutes.map((n) => (
                    <label
                      key={n}
                      className={`flex min-h-12 cursor-pointer items-center justify-center gap-1 rounded-xl border text-sm ${minutes === n ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      <input
                        type="radio"
                        name="daily-minutes"
                        value={n}
                        checked={minutes === n}
                        onChange={() => setMinutes(n)}
                        className="accent-primary"
                      />
                      {n} мин
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-muted-foreground text-xs">
                Один блок — примерно 5 минут. Выполненные и прошедшие занятия
                сохранятся при смене цели и нагрузки.
              </p>
              <Button className="w-full" disabled={busy}>
                Сохранить и обновить неделю
              </Button>
            </form>
          </details>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void load({ action: 'refresh' })}
          >
            {busy ? 'Обновляем…' : 'Обновить по результатам уроков'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Задание засчитывается после успешного завершения урока. Рекомендации
            пересчитываются при открытии календаря и после возвращения из урока.
            Новый план начинается после окончания текущих семи дней.
          </p>
        </>
      )}
    </section>
  );
}

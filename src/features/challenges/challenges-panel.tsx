'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Sparkles, Trophy, Timer, LockKeyhole } from 'lucide-react';
import { Card, Progress } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { useSoundEffects } from '@/features/sound/sound-provider';
import {
  ExerciseControls,
  answerReady,
} from '@/features/lesson/interactive-controls';
import type { Answer } from '@/features/lesson/types';
import type {
  Challenges,
  SprintState,
  SprintFeedback,
} from '@/lib/learning/challenges';
import { CosmeticIcon, StylePreview } from './cosmetics';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
async function read<T>(
  view = 'dashboard',
  run?: string,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetchWithTimeout(
    '/api/challenges?view=' +
      view +
      (run ? '&run=' + encodeURIComponent(run) : ''),
    { cache: 'no-store', signal },
  );
  const d = await readJson(r);
  if (!r.ok) throw Error(d.error ?? 'Не удалось открыть испытания.');
  return d;
}
const links: Record<string, { href: string; label: string }> = {
  word_new: { href: '/review', label: 'Повторить новые слова' },
  word_review: { href: '/review', label: 'Повторить слова' },
  lesson: { href: '/learn', label: 'Выбрать урок' },
  grammar: { href: '/weak-training', label: 'Тренировки грамматики' },
  story: { href: '/stories', label: 'Выбрать историю' },
};
function SprintClock({ run }: { run: SprintState }) {
  const [seconds, setSeconds] = useState(run.elapsedSeconds),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    const base = performance.now();
    const tick = () =>
      setSeconds(
        run.elapsedSeconds + Math.floor((performance.now() - base) / 1000),
      );
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [run.elapsedSeconds]);
  return (
    <div className="border-border rounded-2xl border p-3 text-xs">
      <p className="flex items-center gap-2">
        <Timer size={16} aria-hidden="true" />
        Ориентир — 5 минут
      </p>
      {!hidden && (
        <p className="text-muted-foreground mt-2">
          После старта: {Math.floor(seconds / 60)} мин {seconds % 60} с, включая
          паузы.
        </p>
      )}
      <p className="text-muted-foreground mt-2">
        {seconds >= 300
          ? 'Можно спокойно продолжать. Награда остаётся той же.'
          : 'Не нужно торопиться: медленные ответы и ошибки не уменьшают награду.'}
      </p>
      <button
        className="text-primary min-h-11"
        onClick={() => setHidden((v) => !v)}
      >
        {hidden ? 'Показать время' : 'Скрыть время'}
      </button>
    </div>
  );
}
export function ChallengesPanel() {
  const { account } = useTelegram();
  return <AccountChallenges key={account?.id ?? 'anonymous'} />;
}
function AccountChallenges() {
  const { account } = useTelegram(),
    reduced = useReducedMotion(),
    sound = useSoundEffects();
  const [data, setData] = useState<Challenges | null>(null),
    [run, setRun] = useState<SprintState | null>(null),
    [feedback, setFeedback] = useState<SprintFeedback | null>(null),
    [answer, setAnswer] = useState<Answer>(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [celebration, setCelebration] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const active = useRef(true),
    locked = useRef(false),
    pending = useRef<{ signature: string; id: string } | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    if (account?.mode === 'telegram') {
      const id = new URL(window.location.href).searchParams.get('sprint');
      void Promise.all([
        read<Challenges>('dashboard', undefined, controller.signal),
        id
          ? read<SprintState>('sprint', id, controller.signal)
          : Promise.resolve(null),
      ])
        .then(([d, s]) => {
          if (!controller.signal.aborted) {
            setData(d);
            setRun(s);
            setError('');
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError((e as Error).message);
        });
    }
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [account?.id, account?.mode, refresh]);
  useEffect(() => {
    if (run) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [run]);
  function address(id?: string) {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('sprint', id);
    else u.searchParams.delete('sprint');
    window.history.replaceState(null, '', u);
  }
  async function send(body: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setCelebration(null);
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    const payload = ['enroll', 'sprint_start', 'sprint_answer'].includes(
      String(body.action),
    )
      ? { ...body, requestId: pending.current!.id }
      : body;
    try {
      const r = await fetchWithTimeout('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await readJson(r);
      if (!r.ok) throw Error(d.error ?? 'Не удалось сохранить действие.');
      if (!active.current) return;
      pending.current = null;
      if (body.action === 'sprint_start') {
        setRun(d);
        setFeedback(null);
        setAnswer('');
        address(d.id);
      } else if (body.action === 'sprint_answer') {
        setFeedback(d);
        sound(d.correct ? 'correct' : 'incorrect');
      } else if (body.action === 'claim') {
        setData(d.dashboard);
        if (d.awarded) {
          setCelebration(String(body.enrollmentId));
          sound('complete');
        }
      } else setData(d);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function back() {
    setRun(null);
    setFeedback(null);
    setAnswer('');
    address();
    setRefresh((v) => v + 1);
  }
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <Sparkles className="text-primary mb-3" aria-hidden="true" />
        <h2 className="font-bold">Небольшие цели, свой темп</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Войди через Telegram, чтобы видеть испытания и свою коллекцию наград.
        </p>
        <Link
          href="/profile"
          className="text-primary mt-3 inline-flex min-h-11 items-center"
        >
          Вход и профиль →
        </Link>
      </Card>
    );
  return (
    <div className="space-y-4">
      {error && (
        <Card>
          <p role="alert" className="text-sm">
            {error}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            className="mt-3"
            onClick={() => {
              setFeedback(null);
              setAnswer('');
              setRefresh((v) => v + 1);
            }}
          >
            Обновить состояние
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            className="mt-3"
            onClick={back}
          >
            К испытаниям
          </Button>
        </Card>
      )}
      {run ? (
        <>
          <button
            disabled={busy}
            className="text-primary min-h-11 text-sm"
            onClick={back}
          >
            ← Все испытания
          </button>
          <h2
            ref={heading}
            tabIndex={-1}
            className="scroll-mt-4 text-xl font-bold outline-none"
          >
            Пять минут для себя
          </h2>
          {!run.accessible ? (
            <Card>
              <p>
                Для продолжения нужен Premium и доступ к исходным урокам. Твоё
                место сохранено.
              </p>
              <Link
                href="/premium"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Статус Premium →
              </Link>
            </Card>
          ) : run.completedAt ? (
            <Card>
              <Trophy className="mb-3 text-amber-300" aria-hidden="true" />
              <h3 className="font-bold">Короткая практика завершена</h3>
              <p className="mt-3">
                Ответов: {run.total}. Верно: {run.correct}.
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                После старта прошло {Math.floor(run.elapsedSeconds / 60)} мин,
                включая паузы. Время не влияет на награду.
              </p>
              <Button className="mt-4 w-full" onClick={back}>
                К наградам
              </Button>
            </Card>
          ) : (
            run.exercise && (
              <>
                <SprintClock run={run} />
                <Progress
                  value={(100 * run.answered) / run.total}
                  label="Прогресс короткой практики"
                />
                <p className="text-muted-foreground text-xs">
                  Задание {run.exercise.position} из 5
                </p>
                <h3 className="text-lg font-bold">{run.exercise.prompt}</h3>
                <ExerciseControls
                  key={run.id + ':' + run.exercise.position}
                  exercise={run.exercise}
                  answer={answer}
                  onChange={setAnswer}
                  disabled={busy || Boolean(feedback)}
                />
                {feedback && (
                  <Card>
                    <p role="status" className="font-bold">
                      {feedback.correct ? 'Верно!' : 'Разберём ответ'}
                    </p>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {feedback.explanation}
                    </p>
                  </Card>
                )}
                <Button
                  disabled={
                    busy || (!feedback && !answerReady(run.exercise, answer))
                  }
                  className="w-full"
                  onClick={() => {
                    if (feedback) {
                      setRun(feedback.state);
                      setFeedback(null);
                      setAnswer('');
                    } else
                      void send({
                        action: 'sprint_answer',
                        runId: run.id,
                        position: run.exercise!.position,
                        answer,
                      });
                  }}
                >
                  {busy
                    ? 'Сохраняем…'
                    : feedback
                      ? feedback.state.completedAt
                        ? 'Показать результат'
                        : 'Дальше'
                      : 'Проверить'}
                </Button>
              </>
            )
          )}
        </>
      ) : !data ? (
        <p role="status" className="text-muted-foreground">
          Открываем испытания…
        </p>
      ) : (
        <>
          <Card className="border-primary/30 bg-gradient-to-br from-violet-500/15 to-cyan-400/5">
            <p className="eyebrow">Тема недели</p>
            <h2 className="mt-2 text-xl font-extrabold">{data.theme}</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              Выбери одно интересное испытание — проходить все не нужно. После
              вступления есть полные 7 дней, без ежедневной серии и штрафов.
              Награды возвращаются в следующие недели.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Изменится тема — начатое испытание продолжится до своей даты.
            </p>
          </Card>
          {!data.premium && (
            <Card>
              <LockKeyhole className="text-primary mb-2" aria-hidden="true" />
              <h2 className="font-bold">Дополнительные цели с Premium</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                За испытания выдаются только косметические предметы. Базовые
                задания и достижения доступны по-прежнему.
              </p>
              <Link
                href="/premium"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Возможности Premium →
              </Link>
              <Link
                href="/achievements"
                className="text-primary flex min-h-11 items-center"
              >
                Базовые достижения →
              </Link>
            </Card>
          )}
          {celebration && (
            <motion.div
              key={celebration}
              role="status"
              aria-label="Испытание завершено"
              initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4 }}
            >
              <Card className="border-amber-300/50 bg-amber-300/5">
                <Trophy className="mb-3 text-amber-300" aria-hidden="true" />
                <h2 className="font-bold">Достижение в твоей коллекции</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Косметический предмет можно выбрать ниже. Уже полученные
                  предметы не дублируются.
                </p>
              </Card>
            </motion.div>
          )}
          <section aria-label="Испытания этой недели" className="space-y-4">
            {[...data.templates]
              .sort((a, b) => Number(b.featured) - Number(a.featured))
              .map((t) => {
                const joined = data.enrollments.find(
                    (e) => e.code === t.code && e.edition === data.week,
                  ),
                  asset = data.cosmetics.find((c) => c.code === t.reward_code)!;
                return (
                  <Card key={t.code}>
                    <div className="flex items-center gap-3">
                      <CosmeticIcon asset={asset} />
                      <div className="min-w-0">
                        <p className="text-primary text-xs">
                          {t.featured
                            ? 'В теме недели'
                            : 'Можно выбрать вместо других'}
                        </p>
                        <h2 className="mt-1 font-bold">{t.title}</h2>
                      </div>
                    </div>
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                      {t.description}
                    </p>
                    <p className="mt-3 text-xs">
                      Награда: {asset.title}
                      {asset.owned ? ' · уже в коллекции' : ''}
                    </p>
                    {joined ? (
                      <div className="text-primary mt-4 text-sm">
                        <p>
                          {joined.completed_at
                            ? 'Цель достигнута'
                            : 'Ты участвуешь'}{' '}
                          · {joined.progress} / {joined.target}
                        </p>
                        <a
                          href="#challenge-progress"
                          className="inline-flex min-h-11 items-center"
                        >
                          Открыть прогресс →
                        </a>
                      </div>
                    ) : (
                      <Button
                        disabled={busy || !data.premium}
                        className="mt-4 w-full"
                        onClick={() =>
                          void send({ action: 'enroll', code: t.code })
                        }
                      >
                        Участвовать · {t.title}
                      </Button>
                    )}
                  </Card>
                );
              })}
          </section>
          <section
            id="challenge-progress"
            aria-label="Мои испытания"
            className="space-y-4"
          >
            <h2 className="text-lg font-bold">Мои испытания и история</h2>
            {!data.enrollments.length && (
              <p className="text-muted-foreground text-sm">
                Начни с одной цели. Прогресс появится после вступления.
              </p>
            )}
            {data.enrollments.map((e) => {
              const expired = new Date(e.ends_at) <= new Date(data.serverTime),
                link = links[e.kind];
              return (
                <Card key={e.id}>
                  <h3 className="font-bold">{e.title}</h3>
                  <p className="text-muted-foreground mt-2 text-xs">
                    До {new Date(e.ends_at).toLocaleDateString('ru-RU')} ·{' '}
                    {e.progress} / {e.target}
                  </p>
                  <div className="mt-3">
                    <Progress
                      value={(100 * e.progress) / e.target}
                      label={'Прогресс: ' + e.title}
                    />
                  </div>
                  {e.claimed_at ? (
                    <p className="text-primary mt-3 text-sm">
                      Завершено · награда получена
                    </p>
                  ) : e.completed_at ? (
                    <Button
                      disabled={busy || !data.premium}
                      className="mt-4 w-full"
                      onClick={() =>
                        void send({ action: 'claim', enrollmentId: e.id })
                      }
                    >
                      Получить награду · {e.title}
                    </Button>
                  ) : expired ? (
                    <p className="text-muted-foreground mt-3 text-sm">
                      Период завершён. Прогресс сохранён, можно выбрать новую
                      цель.
                    </p>
                  ) : e.kind === 'sprint' ? (
                    <Button
                      disabled={busy || !data.premium}
                      className="mt-4 w-full"
                      onClick={() =>
                        void send({
                          action: 'sprint_start',
                          enrollmentId: e.id,
                        })
                      }
                    >
                      Открыть короткую практику
                    </Button>
                  ) : (
                    link && (
                      <Link
                        href={link.href}
                        className="text-primary mt-3 inline-flex min-h-11 items-center text-sm"
                      >
                        {link.label} →
                      </Link>
                    )
                  )}
                </Card>
              );
            })}
          </section>
          <section aria-label="Косметические награды" className="space-y-4">
            <h2 className="text-lg font-bold">Твоя коллекция</h2>
            <StylePreview assets={data.showcase.equipped} name={account.name} />
            <p className="text-muted-foreground text-xs">
              Выбранный стиль виден в профиле. Предметы сохраняются после
              окончания Premium и снова доступны в следующих неделях.
            </p>
            {data.cosmetics.map((a) => {
              const equipped = data.showcase.equipped.some(
                (c) => c.code === a.code,
              );
              return (
                <Card key={a.code}>
                  <div className="flex items-center gap-3">
                    <CosmeticIcon asset={a} />
                    <div className="min-w-0">
                      <h3 className="font-bold">{a.title}</h3>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {a.slot === 'frame'
                          ? 'Рамка'
                          : a.slot === 'badge'
                            ? 'Значок'
                            : 'Цвет витрины'}{' '}
                        · {a.owned ? 'В коллекции' : 'За испытание'}
                      </p>
                    </div>
                  </div>
                  <p className="text-muted-foreground mt-3 text-sm">
                    {a.description}
                  </p>
                  {a.owned && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      className="mt-3 w-full"
                      onClick={() =>
                        void send({
                          action: 'equip',
                          slot: a.slot,
                          code: equipped ? null : a.code,
                          version: data.showcase.version,
                        })
                      }
                    >
                      {equipped ? 'Снять' : 'Выбрать'} · {a.title}
                    </Button>
                  )}
                </Card>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Target, Trophy, LockKeyhole } from 'lucide-react';
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
  WeakDashboard,
  WeakState,
  WeakFeedback,
} from '@/lib/learning/weak';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
async function get<T>(run?: string, signal?: AbortSignal): Promise<T> {
  const r = await fetchWithTimeout(
    '/api/weak-training' + (run ? '?run=' + encodeURIComponent(run) : ''),
    { cache: 'no-store', signal },
  );
  const d = await readJson(r);
  if (!r.ok) throw Error(d.error ?? 'Не удалось открыть тренировку.');
  return d;
}
function address(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('run', id);
  else url.searchParams.delete('run');
  window.history.replaceState(null, '', url);
}
export function WeakTrainingPanel() {
  const { account } = useTelegram();
  return <AccountTraining key={account?.id ?? 'anonymous'} />;
}
function AccountTraining() {
  const { account } = useTelegram(),
    sound = useSoundEffects();
  const [data, setData] = useState<WeakDashboard | null>(null),
    [run, setRun] = useState<WeakState | null>(null),
    [feedback, setFeedback] = useState<WeakFeedback | null>(null),
    [answer, setAnswer] = useState<Answer>(''),
    [topic, setTopic] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const active = useRef(true),
    locked = useRef(false),
    pending = useRef<{ signature: string; id: string } | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    if (account?.mode === 'telegram') {
      const id = new URL(window.location.href).searchParams.get('run');
      void Promise.all([
        get<WeakDashboard>(undefined, controller.signal),
        id ? get<WeakState>(id, controller.signal) : Promise.resolve(null),
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
  async function load(id: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const s = await get<WeakState>(id);
      if (active.current) {
        setRun(s);
        setFeedback(null);
        setAnswer('');
        pending.current = null;
        address(id);
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function send(command: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const signature = JSON.stringify(command);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    try {
      const r = await fetchWithTimeout('/api/weak-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, requestId: pending.current!.id }),
      });
      const d = await readJson(r);
      if (!r.ok) throw Error(d.error ?? 'Не удалось сохранить ответ.');
      if (!active.current) return;
      pending.current = null;
      if (command.action === 'start') {
        setRun(d);
        setFeedback(null);
        setAnswer('');
        address(d.id);
      } else {
        setFeedback(d);
        sound(d.correct ? 'correct' : 'incorrect');
      }
      void get<WeakDashboard>()
        .then((d) => {
          if (active.current) setData(d);
        })
        .catch(() => {});
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function catalog() {
    setTopic('');
    setRun(null);
    setFeedback(null);
    setAnswer('');
    pending.current = null;
    address();
    setRefresh((v) => v + 1);
  }
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <Target className="text-primary mb-3" aria-hidden="true" />
        <h2 className="font-bold">Практика по твоим ошибкам</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Войди через Telegram. Premium подберёт упражнения по сохранённой
          истории ответов.
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
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run ? void load(run.id) : setRefresh((v) => v + 1)
              }
            >
              Загрузить сохранённое
            </Button>
            <Button variant="outline" disabled={busy} onClick={catalog}>
              К темам
            </Button>
          </div>
        </Card>
      )}
      {run ? (
        <>
          <button
            disabled={busy}
            className="text-primary min-h-11 text-sm"
            onClick={catalog}
          >
            ← Все темы
          </button>
          <h2
            ref={heading}
            tabIndex={-1}
            className="scroll-mt-4 text-xl font-extrabold outline-none"
          >
            {run.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {run.level} · персональная практика
          </p>
          {!run.accessible ? (
            <Card>
              <LockKeyhole className="text-primary mb-3" aria-hidden="true" />
              <h3 className="font-bold">Продолжение сейчас недоступно</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Прогресс сохранён. Проверь Premium; если исходный урок снят с
                публикации, выбери другую тему.
              </p>
              <Link
                href="/premium"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Статус Premium →
              </Link>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load(run.id)}
              >
                Проверить доступ
              </Button>
            </Card>
          ) : run.status === 'completed' ? (
            <Card className="border-primary/30 bg-gradient-to-br from-violet-500/10 to-cyan-400/5">
              <Trophy className="mb-3 text-amber-300" aria-hidden="true" />
              <h3 className="text-lg font-bold">Тренировка завершена</h3>
              <p className="mt-3">
                Верно {run.correct} из {run.total} · {run.score}%
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3">
                  <dt className="text-muted-foreground text-xs">По теме до</dt>
                  <dd className="mt-1 text-xl font-bold">{run.before}%</dd>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <dt className="text-muted-foreground text-xs">
                    По теме после
                  </dt>
                  <dd className="text-primary mt-1 text-xl font-bold">
                    {run.after === null ? 'Нет данных' : run.after + '%'}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-sm">
                Исправлено прежних ошибок: {run.recovered}.
              </p>
              <p className="text-primary mt-2 font-bold">
                +{run.xp} XP за улучшение
              </p>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                5 XP выдаются один раз за упражнение, в котором прежнюю ошибку
                сменил правильный ответ. Новые задания и повторные исправления
                XP не дают.
              </p>
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                До и после — последние ответы на разные задания темы. Состав
                выборки может меняться. Это статистика практики, не сертификация
                CEFR.
              </p>
              <Button className="mt-4 w-full" onClick={catalog}>
                Вернуться к темам
              </Button>
            </Card>
          ) : run.status === 'abandoned' ? (
            <Card>
              <p>
                Начата другая тренировка. Эта попытка сохранена без награды.
              </p>
              <Button className="mt-3" onClick={catalog}>
                Выбрать тему
              </Button>
            </Card>
          ) : (
            run.exercise && (
              <>
                <Progress
                  value={(100 * run.answered) / run.total}
                  label="Прогресс тренировки"
                />
                <p className="text-muted-foreground text-xs">
                  Задание {run.exercise.position} из {run.total} ·{' '}
                  {run.exercise.wasWrong
                    ? 'Ранее была ошибка'
                    : run.exercise.isNew
                      ? 'Ещё не решалось'
                      : 'Практика'}
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
                  <Card
                    className={
                      feedback.correct
                        ? 'border-teal-300/40'
                        : 'border-rose-400/40'
                    }
                  >
                    <p role="status" className="font-bold">
                      {feedback.correct ? 'Верно!' : 'Разберём ошибку'}
                    </p>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {feedback.explanation}
                    </p>
                  </Card>
                )}
                <Button
                  className="w-full"
                  disabled={
                    busy || (!feedback && !answerReady(run.exercise, answer))
                  }
                  onClick={() => {
                    if (feedback) {
                      setRun(feedback.state);
                      setAnswer('');
                      setFeedback(null);
                      if (feedback.state.status === 'completed')
                        sound('complete');
                    } else
                      void send({
                        action: 'answer',
                        runId: run.id,
                        position: run.exercise!.position,
                        answer,
                      });
                  }}
                >
                  {busy
                    ? 'Сохраняем…'
                    : feedback
                      ? feedback.state.status === 'completed'
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
          Изучаем историю ответов…
        </p>
      ) : !data.premium ? (
        <Card>
          <LockKeyhole className="text-primary mb-3" aria-hidden="true" />
          <h2 className="font-bold">Точечная практика с Premium</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Тренировки используют твои ошибки и задания из уроков. Базовые
            рекомендации и бесплатное повторение остаются доступны.
          </p>
          <Link
            href="/premium"
            className="text-primary mt-4 inline-flex min-h-11 items-center"
          >
            Возможности Premium →
          </Link>
          <Link
            href="/review"
            className="text-primary flex min-h-11 items-center"
          >
            Базовое повторение →
          </Link>
        </Card>
      ) : (
        <>
          <Card className="border-primary/30 bg-gradient-to-br from-violet-500/10 to-cyan-400/5">
            <Target className="text-primary mb-3" aria-hidden="true" />
            <h2 className="font-bold">Меньше случайных повторений</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              До 6 заданий: прежние ошибки и новая практика той же темы.
              Анализируем разные упражнения за последние 90 дней. Освоенные темы
              не включаем.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Уровень подбора: {data.level}. При отсутствии предварительной
              оценки используется A1.
            </p>
          </Card>
          {data.activeId && (
            <Button
              disabled={busy}
              className="w-full"
              onClick={() => void load(data.activeId!)}
            >
              Продолжить тренировку
            </Button>
          )}
          {!data.enough ? (
            <Card>
              <h2 className="font-bold">Пока мало данных об ошибках</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Пройди хотя бы два урока и ответь минимум на 10 разных заданий
                подходящего уровня. Для анализа отдельной темы нужны 5 разных
                ответов.
              </p>
              <Link
                href="/learn"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Перейти к урокам →
              </Link>
              <Link
                href="/placement"
                className="text-primary flex min-h-11 items-center"
              >
                Уточнить уровень →
              </Link>
            </Card>
          ) : (
            <>
              <h2 className="text-lg font-bold">Сейчас стоит повторить</h2>
              {data.topics.some((t) => t.status === 'weak') ? (
                <>
                  <Button
                    disabled={busy}
                    className="w-full"
                    onClick={() =>
                      void send({ action: 'start', topicId: null })
                    }
                  >
                    Подобрать тренировку
                  </Button>
                  {data.topics
                    .filter((t) => t.status === 'weak')
                    .map((t) => (
                      <Card key={t.id}>
                        <h3 className="font-bold">{t.title}</h3>
                        <p className="text-muted-foreground mt-2 text-sm">
                          Ошибки: {t.wrong} из {t.answered} · верно {t.accuracy}
                          %
                        </p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          className="mt-3 w-full"
                          onClick={() =>
                            void send({ action: 'start', topicId: t.id })
                          }
                        >
                          Тренировать эту тему
                        </Button>
                      </Card>
                    ))}
                </>
              ) : (
                <Card>
                  <p className="font-bold">Выраженных слабых тем сейчас нет</p>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Продолжай уроки. Темы с точностью от 80% на пяти и более
                    разных заданиях исключены из дополнительных тренировок.
                  </p>
                </Card>
              )}
              <Card>
                <h2 className="font-bold">Выбрать тему вручную</h2>
                <label className="mt-3 block text-sm">
                  Тема
                  <select
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={busy}
                    className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
                  >
                    <option value="">Выбери тему</option>
                    {data.topics.map((t) => (
                      <option
                        key={t.id}
                        value={t.id}
                        disabled={!['weak', 'developing'].includes(t.status)}
                      >
                        {t.title} ·{' '}
                        {t.accuracy === null ? 'мало данных' : t.accuracy + '%'}
                        {t.status === 'mastered'
                          ? ' · освоено'
                          : t.status === 'insufficient'
                            ? ' · мало данных'
                            : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={
                    busy ||
                    !data.topics.some(
                      (t) =>
                        t.id === topic &&
                        ['weak', 'developing'].includes(t.status),
                    )
                  }
                  className="mt-3 w-full"
                  onClick={() => void send({ action: 'start', topicId: topic })}
                >
                  Начать по теме
                </Button>
              </Card>
            </>
          )}
          <Card>
            <h2 className="font-bold">Как меняются результаты</h2>
            {data.history.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                Здесь появятся результаты завершённых тренировок.
              </p>
            ) : (
              <ul className="mt-3 space-y-4">
                {data.history.map((h) => (
                  <li key={h.id} className="border-border border-t pt-3">
                    <p className="font-bold">{h.title}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {h.before}% →{' '}
                      {h.after === null ? 'Нет данных' : h.after + '%'} · +
                      {h.xp} XP
                    </p>
                    <time
                      dateTime={h.completedAt}
                      className="text-muted-foreground text-xs"
                    >
                      {new Date(h.completedAt).toLocaleDateString('ru-RU')}
                    </time>
                    <button
                      className="text-primary block min-h-11 text-sm"
                      disabled={busy}
                      onClick={() => void load(h.id)}
                    >
                      Открыть результат
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

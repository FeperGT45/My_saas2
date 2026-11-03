'use client';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { X, ArrowRight, RotateCcw, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/game';
import { RewardBurst } from '@/features/gamification/reward-burst';
import { Mascot } from '@/components/ui/mascot';
import { ExerciseControls, answerReady } from './exercise-controls';
import {
  defaultLessonId,
  type LessonState,
  type Answer,
  type Feedback,
} from './types';
const labels = {
  single_choice: 'Выбор перевода',
  sentence: 'Собери предложение',
  gap: 'Пропущенное слово',
  matching: 'Найди пары',
  grammar: 'Грамматика',
  listening: 'Аудирование',
};
const subscribeHydration = () => () => {};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await readJson(response);
  if (!response.ok)
    throw new Error(data.error ?? 'Не удалось связаться с сервером.');
  return data;
}
export function LessonPlayer({
  lessonId = defaultLessonId,
  initialAttempt,
}: {
  lessonId?: string;
  initialAttempt?: string;
}) {
  const [state, setState] = useState<LessonState | null>(null);
  const [answer, setAnswer] = useState<Answer>('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(Boolean(initialAttempt));
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const requestId = useRef<string | null>(null);
  const reduced = useReducedMotion();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  useEffect(() => {
    if (!initialAttempt) return;
    let active = true;
    void api<LessonState>(`/api/lessons/${encodeURIComponent(initialAttempt)}`)
      .then((data) => {
        if (active) setState(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialAttempt]);
  async function start(fresh = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    if (fresh && requestId.current === state?.attemptId)
      requestId.current = null;
    requestId.current ??= crypto.randomUUID();
    try {
      const next = await api<LessonState>('/api/lessons/start', {
        lessonId,
        requestId: requestId.current,
      });
      setState(next);
      setFeedback(null);
      setAnswer('');
      window.history.replaceState(
        null,
        '',
        `/lesson?lesson=${next.lessonId}&attempt=${next.attemptId}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить урок.');
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  async function check() {
    if (!state?.exercise || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Feedback>(
        `/api/lessons/${state.attemptId}/answer`,
        { position: state.exercise.position, answer },
      );
      setFeedback(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить ответ.');
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  const visible = feedback?.state ?? state;
  const complete = state?.status === 'completed';
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/learn"
          aria-label="Выйти из урока"
          className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl"
        >
          <X size={20} />
        </Link>
        <Progress
          value={visible?.total ? (visible.answered / visible.total) * 100 : 0}
          label="Прогресс урока"
          className="flex-1"
        />
        <span className="text-primary text-xs">
          {visible?.answered ?? 0}/{visible?.total ?? '—'}
        </span>
      </div>
      {complete ? (
        <div className="text-center">
          <p className="eyebrow">Миссия выполнена</p>
          <Mascot className="mx-auto w-48" />
          <h1 className="text-3xl font-extrabold">Отличный полёт!</h1>
          <Card className="my-6 grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-black text-teal-300">
                {state.correct} / {state.total}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Верных ответов · {state.score}%
              </p>
            </div>
            <div>
              <p className="text-primary text-2xl font-black">{state.xp} XP</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {state.xp
                  ? 'Начислено за урок'
                  : state.rewards?.eligible === false
                    ? 'Нужно от 60%'
                    : 'Награда уже получена'}
              </p>
            </div>
          </Card>
          <p className="mb-5 text-xs text-teal-200">
            Результат сохранён на сервере.
          </p>
          <RewardBurst rewards={state.rewards} />
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => start(true)}
          >
            <RotateCcw size={16} />
            Пройти ещё раз
          </Button>
          <Button asChild variant="outline" className="mt-3 w-full">
            <Link href="/learn">Вернуться на карту</Link>
          </Button>
        </div>
      ) : state?.exercise ? (
        <>
          <p className="eyebrow">
            Задание {state.exercise.position} из {state.total}
          </p>
          <h1 className="my-3 text-2xl font-extrabold">
            {labels[state.exercise.kind]}
          </h1>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            {state.exercise.prompt}
          </p>
          <ExerciseControls
            key={`${state.attemptId}:${state.exercise.position}`}
            exercise={state.exercise}
            answer={answer}
            onChange={setAnswer}
            disabled={busy || Boolean(feedback)}
          />
          {feedback && (
            <motion.div
              role="status"
              aria-live="polite"
              key={state.exercise.position}
              initial={
                reduced
                  ? false
                  : { opacity: 0, x: feedback.correct ? 0 : -6, scale: 0.98 }
              }
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ duration: 0.25 }}
              className="mt-5"
            >
              <Card
                className={
                  feedback.correct
                    ? 'border-teal-300/40 bg-teal-300/5'
                    : 'border-rose-400/40 bg-rose-400/5'
                }
              >
                <p
                  className={`flex items-center gap-2 text-sm font-bold ${feedback.correct ? 'text-teal-300' : 'text-rose-300'}`}
                >
                  {feedback.correct ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <Info size={18} />
                  )}
                  {feedback.correct
                    ? 'Точно в цель!'
                    : 'Новый опыт — тоже прогресс'}
                </p>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {feedback.explanation}
                </p>
              </Card>
            </motion.div>
          )}
          <Button
            className="mt-5 w-full"
            disabled={
              busy || (!feedback && !answerReady(state.exercise, answer))
            }
            onClick={() => {
              if (feedback) {
                setState(feedback.state);
                setFeedback(null);
                setAnswer('');
              } else void check();
            }}
          >
            {busy
              ? 'Сохраняем…'
              : feedback
                ? feedback.state.status === 'completed'
                  ? 'Завершить урок'
                  : 'Дальше'
                : 'Проверить'}
            <ArrowRight size={18} />
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-extrabold">Новый урок — новый мир</h1>
          <Mascot className="mx-auto my-5 w-44" />
          <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
            Шесть форматов заданий, проверка ответов и сохранение прогресса. Для
            начала войди через Telegram.
          </p>
          <Button
            className="w-full"
            disabled={busy || !hydrated}
            onClick={() => start()}
          >
            {busy ? 'Загружаем…' : 'Начать урок'}
          </Button>
        </>
      )}
      {busy && (
        <p
          role="status"
          className="text-muted-foreground mt-3 animate-pulse text-center text-xs"
        >
          Связываемся с сервером…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200"
        >
          <p>{error}</p>
          <p className="mt-2 text-xs">
            Повтори запрос той же кнопкой: ответ не будет засчитан дважды. Для
            обновления попытки перезагрузи страницу.
          </p>
        </div>
      )}
      <p className="text-muted-foreground mt-5 text-center text-[10px]">
        Ответы проверяются сервером · XP за урок начисляется один раз
      </p>
    </>
  );
}

'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  Sparkles,
  CheckCircle2,
  BookOpen,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import { Card, Progress } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { Mascot } from '@/components/ui/mascot';
import {
  cefrLevels,
  levelDetails,
  categoryNames,
  placementDisclaimer,
  type PlacementStatus,
  type PlacementQuestion,
  type PlacementFeedback,
} from '@/lib/placement/types';
import { usePlacement } from './use-placement';
import { useTelegram } from '@/features/telegram/provider';

function Welcome({
  name,
  busy,
  onStart,
  onBeginner,
}: {
  name: string;
  busy: boolean;
  onStart: () => void;
  onBeginner?: () => void;
}) {
  return (
    <Card className="starfield border-primary/30">
      <p className="eyebrow mb-3">Привет, {name} ✦</p>
      <Mascot className="float-right ml-2 w-20" />
      <h2 className="text-2xl font-extrabold">
        Узнаем твой уровень английского?
      </h2>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        За 12–20 вопросов подберём удобную точку старта. Проверим грамматику,
        словарный запас и понимание текстов. Сложность подстроится под ответы.
      </p>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        Уже занимался здесь? Пройденные уроки и награды сохранятся. Прерванный
        тест можно продолжить.
      </p>
      <Button className="mt-5 w-full" disabled={busy} onClick={onStart}>
        {busy ? 'Подготавливаем тест…' : 'Начать тест'}
        <ArrowRight size={18} />
      </Button>
      {onBeginner && (
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={busy}
          onClick={onBeginner}
        >
          Я новичок, начать с нуля
        </Button>
      )}
      <p className="text-muted-foreground mt-4 text-[11px] leading-relaxed">
        {placementDisclaimer}
      </p>
    </Card>
  );
}
function Result({
  data,
  busy,
  onRoute,
  onRetest,
}: {
  data: PlacementStatus;
  busy: boolean;
  onRoute: (level: (typeof cefrLevels)[number]) => void;
  onRetest: () => void;
}) {
  const reduced = useReducedMotion();
  const assessment = data.assessment!;
  const detail = levelDetails[assessment.level];
  const first = data.recommendations[0];
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <Card className="starfield border-primary/30 text-center">
        <Sparkles className="mx-auto text-teal-200" size={30} />
        <p className="eyebrow mt-3">
          {assessment.source === 'beginner'
            ? 'Твоя точка старта'
            : 'Предварительный уровень'}
        </p>
        <h2 className="text-primary mt-3 text-5xl font-black">
          {assessment.level}
        </h2>
        <p className="mt-2 text-xl font-bold">{detail.name}</p>
        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
          {detail.description}
        </p>
        {assessment.source === 'adaptive' && (
          <div className="mt-4 text-left">
            <p className="mb-2 text-xs">
              Определённость оценки:{' '}
              {Math.round((assessment.confidence ?? 0) * 100)}%
            </p>
            <Progress
              value={(assessment.confidence ?? 0) * 100}
              label="Определённость предварительной оценки"
            />
            {assessment.interval && (
              <p className="text-muted-foreground mt-3 text-xs">
                Возможный диапазон: {assessment.interval.from}–
                {assessment.interval.to}.{' '}
                {(assessment.confidence ?? 0) < 0.8
                  ? 'Результат стоит уточнить более полным тестированием.'
                  : 'Оценка достаточно устойчива в рамках этого короткого теста.'}
              </p>
            )}
          </div>
        )}
      </Card>
      <Card>
        <h3 className="font-bold">Проверенные навыки</h3>
        {assessment.source === 'beginner' ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Выбран старт с A1. Тест не проходился, навыки пока не оценивались.
          </p>
        ) : (
          Object.entries(categoryNames).map(([key, label]) => {
            const score =
              assessment.categories[key as keyof typeof categoryNames];
            return score ? (
              <div key={key} className="mt-4">
                <p className="mb-2 flex justify-between gap-2 text-sm">
                  <span>{label}</span>
                  <span>
                    {score.correct}/{score.answered}
                  </span>
                </p>
                <Progress value={score.accuracy} label={label} />
                <p className="text-muted-foreground mt-1 text-xs">
                  Верно в этой попытке: {score.accuracy}%
                </p>
              </div>
            ) : null;
          })
        )}
      </Card>
      {assessment.source === 'adaptive' && (
        <Card>
          <h3 className="font-bold">Сильные стороны</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            {assessment.strengths.length
              ? assessment.strengths.map((c) => categoryNames[c]).join(' · ')
              : 'Пока мало оснований выделить устойчивые сильные стороны. Базовые уроки помогут закрепить основу.'}
          </p>
          <h3 className="mt-5 font-bold">Темы для улучшения</h3>
          <ul className="text-muted-foreground mt-2 space-y-2 text-sm">
            {assessment.improvements.length ? (
              assessment.improvements.map((topic) => (
                <li key={topic}>• {topic}</li>
              ))
            ) : (
              <li>
                В этой попытке ошибок не было. Продолжай развивать навыки на
                более разнообразных материалах.
              </li>
            )}
          </ul>
        </Card>
      )}
      <Card>
        <h3 className="font-bold">Рекомендуемый старт</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {levelDetails[data.routeLevel].focus}
        </p>
        {first ? (
          <>
            <p className="mt-4 font-semibold">
              {first.course_title} · {first.level}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {first.unit_title} → {first.lesson_title}
            </p>
            {first.review && (
              <p className="text-muted-foreground mt-3 text-xs">
                Можно повторить знакомый урок. Прежний результат сохранится.
              </p>
            )}
            {first.level !== data.routeLevel && (
              <p className="text-muted-foreground mt-3 text-xs">
                Для маршрута {data.routeLevel} предлагаем ближайшие доступные
                материалы уровня {first.level} с учётом пройденных уроков.
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            Подходящие материалы ещё готовятся. Открой каталог, чтобы посмотреть
            доступные направления.
          </p>
        )}
        <label className="mt-5 block text-sm">
          Изменить учебный маршрут
          <select
            value={data.routeLevel}
            disabled={busy}
            onChange={(e) =>
              onRoute(e.target.value as (typeof cefrLevels)[number])
            }
            className="border-border bg-background mt-2 min-h-12 w-full rounded-xl border px-3 text-base"
          >
            {cefrLevels.map((l) => (
              <option key={l} value={l}>
                {l} · {levelDetails[l].name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground mt-2 text-xs">
          Меняется только рекомендация. Результат теста и учебный прогресс
          сохранятся; другие уровни остаются доступны.
        </p>
      </Card>
      <Button asChild className="w-full">
        <Link href="/learning-plan">
          Начать обучение
          <ArrowRight size={18} />
        </Link>
      </Button>
      <Button variant="outline" className="w-full" onClick={onRetest}>
        <RotateCcw size={17} />
        Пройти тест повторно
      </Button>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {placementDisclaimer}
      </p>
    </motion.div>
  );
}
export function PlacementPanel(props: { retest?: boolean }) {
  const { account } = useTelegram();
  return (
    <PlacementPanelForAccount key={account?.id ?? 'anonymous'} {...props} />
  );
}
function PlacementPanelForAccount({ retest = false }: { retest?: boolean }) {
  const model = usePlacement();
  const { data, account, busy, error, refresh, mutate } = model;
  const reduced = useReducedMotion();
  const [retake, setRetake] = useState(retest);
  const [selected, setSelected] = useState('');
  const [feedback, setFeedback] = useState<{
    data: PlacementFeedback;
    question: PlacementQuestion;
  } | null>(null);
  const startRequest = useRef<string | null>(null);
  const answerRequest = useRef<{ question: string; id: string } | null>(null);
  async function start() {
    startRequest.current ??= crypto.randomUUID();
    const r = await mutate({
      action: 'start',
      requestId: startRequest.current,
    });
    if (r) {
      setRetake(false);
      setSelected('');
      setFeedback(null);
      window.history.replaceState(null, '', '/placement');
    }
  }
  async function beginner() {
    const r = await mutate({ action: 'beginner' });
    if (r) {
      setRetake(false);
      setFeedback(null);
    }
  }
  async function check() {
    const a = data?.attempt;
    const q = a?.question;
    if (!a || !q || !selected) return;
    if (answerRequest.current?.question !== q.id)
      answerRequest.current = { question: q.id, id: crypto.randomUUID() };
    const r = await mutate({
      action: 'answer',
      attemptId: a.id,
      questionId: q.id,
      requestId: answerRequest.current.id,
      option: selected,
    });
    if (r?.feedback) {
      setRetake(false);
      setFeedback({ data: r.feedback, question: q });
    }
  }
  if (
    model.telegramStatus === 'loading' ||
    (model.telegramStatus === 'telegram' && !account && !model.authError)
  )
    return <p role="status">Проверяем аккаунт…</p>;
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <h2 className="font-bold">Тест доступен после входа через Telegram</h2>
        <p className="text-muted-foreground mt-3 text-sm">
          Открой Voklumi через бота, чтобы сохранить результат и продолжать тест
          на другом устройстве.
        </p>
        <Button asChild className="mt-4 w-full">
          <a href="https://t.me/Voklumi_bot">Открыть бота</a>
        </Button>
      </Card>
    );
  const question = feedback?.question ?? data?.attempt?.question;
  return (
    <div className="space-y-4">
      {!data && !error && (
        <p role="status" className="animate-pulse text-sm">
          Загружаем сохранённый тест…
        </p>
      )}
      {data && question ? (
        <>
          <div>
            <p className="mb-2 text-sm">
              Сохранено ответов:{' '}
              {data.attempt?.answered ?? data.assessment?.questions ?? 0} из
              максимум 20
            </p>
            <Progress
              value={
                ((data.attempt?.answered ?? data.assessment?.questions ?? 0) /
                  20) *
                100
              }
              label="Прогресс тестирования"
            />
            <p className="text-muted-foreground mt-2 text-xs">
              Тест завершится после 12–20 вопросов, когда данных будет
              достаточно.
            </p>
          </div>
          <Card>
            <p className="eyebrow">{categoryNames[question.category]}</p>
            <h2 className="my-4 text-xl font-bold">{question.prompt}</h2>
            {question.passage && (
              <p
                lang="en"
                className="border-border bg-background mb-5 rounded-xl border p-4 text-base leading-relaxed"
              >
                {question.passage}
              </p>
            )}
            <div
              role="group"
              aria-label="Варианты ответа теста"
              className="grid gap-3"
            >
              {question.options.map((o) => (
                <button
                  key={o.id}
                  aria-pressed={selected === o.id}
                  disabled={busy || Boolean(feedback)}
                  onClick={() => setSelected(o.id)}
                  className={`min-h-14 rounded-2xl border-2 border-b-4 p-4 text-left text-sm font-semibold break-words ${selected === o.id ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Card>
          {feedback && (
            <motion.div
              role="status"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card
                className={
                  feedback.data.correct
                    ? 'border-teal-300/40'
                    : 'border-rose-300/40'
                }
              >
                <h3 className="flex items-center gap-2 font-bold">
                  <CheckCircle2 size={18} />
                  {feedback.data.correct ? 'Верно!' : 'Разберём ответ'}
                </h3>
                <p className="mt-3 text-sm">
                  Правильный вариант:{' '}
                  {
                    feedback.question.options.find(
                      (o) => o.id === feedback.data.correctOption,
                    )?.label
                  }
                </p>
                <p className="text-muted-foreground mt-2 text-sm">
                  {feedback.data.explanation}
                </p>
              </Card>
            </motion.div>
          )}
          <Button
            className="w-full"
            disabled={busy || (!feedback && !selected)}
            onClick={() => {
              if (feedback) {
                setFeedback(null);
                setSelected('');
              } else void check();
            }}
          >
            {busy
              ? 'Сохраняем ответ…'
              : feedback
                ? data.attempt
                  ? 'Следующий вопрос'
                  : 'Посмотреть результат'
                : 'Проверить ответ'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Ответы сохраняются после каждого вопроса. Можно закрыть Mini App и
            вернуться позже. За тест XP не начисляется.
          </p>
        </>
      ) : data && (!data.onboarded || !data.assessment || retake) ? (
        <Welcome
          name={account.name}
          busy={busy}
          onStart={() => void start()}
          onBeginner={data.assessment ? undefined : () => void beginner()}
        />
      ) : data?.assessment ? (
        <Result
          data={data}
          busy={busy}
          onRoute={(level) => void mutate({ action: 'route', level })}
          onRetest={() => {
            startRequest.current = null;
            setRetake(true);
            setFeedback(null);
            setSelected('');
          }}
        />
      ) : null}
      {busy && (
        <p role="status" className="text-muted-foreground text-sm">
          Сохраняем изменения…
        </p>
      )}
      {error && (
        <Card>
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
          <Button
            variant="outline"
            className="mt-3 w-full"
            disabled={busy}
            onClick={() => {
              setFeedback(null);
              setSelected('');
              refresh();
            }}
          >
            Обновить состояние теста
          </Button>
        </Card>
      )}
    </div>
  );
}
export function PlacementHome() {
  const { account } = useTelegram();
  return <PlacementHomeForAccount key={account?.id ?? 'anonymous'} />;
}
function PlacementHomeForAccount() {
  const { account, data, busy, error, mutate, refresh } = usePlacement();
  const router = useRouter();
  const request = useRef<string | null>(null);
  if (account?.mode !== 'telegram') return null;
  if (error)
    return (
      <Card className="mb-5">
        <p role="alert">{error}</p>
        <Button variant="outline" className="mt-3 w-full" onClick={refresh}>
          Повторить загрузку теста
        </Button>
      </Card>
    );
  if (!data)
    return (
      <p role="status" className="mb-5 text-sm">
        Проверяем твою точку старта…
      </p>
    );
  if (data.onboarded && !data.attempt) return null;
  if (data.attempt)
    return (
      <Card className="border-primary/30 mb-5">
        <h2 className="font-bold">Тест можно продолжить</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Сохранено ответов: {data.attempt.answered}. Твой учебный прогресс не
          изменён.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href="/placement">Продолжить тест</Link>
        </Button>
      </Card>
    );
  return (
    <div className="mb-5">
      <Welcome
        name={account.name}
        busy={busy}
        onStart={() => {
          request.current ??= crypto.randomUUID();
          void mutate({ action: 'start', requestId: request.current }).then(
            (r) => {
              if (r) router.push('/placement');
            },
          );
        }}
        onBeginner={() => {
          void mutate({ action: 'beginner' }).then((r) => {
            if (r) router.push('/placement');
          });
        }}
      />
    </div>
  );
}
export function PlacementProfile() {
  const { account, data, error, refresh } = usePlacement();
  return (
    <Card className="mb-4">
      <h2 className="flex items-center gap-2 font-bold">
        <BookOpen size={19} className="text-teal-200" />
        Мой уровень английского
      </h2>
      {account?.mode !== 'telegram' ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Войди через Telegram, чтобы сохранить оценку и получить рекомендации.
        </p>
      ) : error ? (
        <>
          <p role="alert" className="mt-3 text-sm text-rose-200">
            {error}
          </p>
          <Button variant="outline" className="mt-3" onClick={refresh}>
            Повторить загрузку уровня
          </Button>
        </>
      ) : !data ? (
        <p role="status" className="mt-3 animate-pulse text-sm">
          Загружаем уровень…
        </p>
      ) : (
        <>
          {data.assessment ? (
            <>
              <p className="mt-3 text-xl font-bold">
                {data.assessment.level} ·{' '}
                {levelDetails[data.assessment.level].name}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                {data.assessment.source === 'beginner'
                  ? 'Старт выбран самостоятельно'
                  : 'Предварительная оценка'}{' '}
                ·{' '}
                {new Date(data.assessment.assessedAt).toLocaleDateString(
                  'ru-RU',
                )}
              </p>
              {data.recommendations[0] && (
                <p className="text-muted-foreground mt-3 text-sm">
                  Рекомендуемый курс: {data.recommendations[0].course_title}
                </p>
              )}
              <details className="mt-4 text-sm">
                <summary className="min-h-11 cursor-pointer py-3">
                  История оценок ({data.history.length})
                </summary>
                {data.history.length ? (
                  data.history.map((h) => (
                    <p
                      key={h.id}
                      className="text-muted-foreground my-2 text-xs"
                    >
                      {new Date(h.completedAt).toLocaleDateString('ru-RU')} ·{' '}
                      {h.level}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Тест ещё не проходился.
                  </p>
                )}
              </details>
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              Уровень пока не определён. Пройди короткий тест — ранее пройденные
              уроки сохранятся.
            </p>
          )}
          <Button asChild className="mt-4 w-full">
            <Link
              href={
                data.attempt
                  ? '/placement'
                  : data.assessment
                    ? '/placement?retest=1'
                    : '/placement'
              }
            >
              {data.attempt
                ? 'Продолжить тест'
                : data.assessment
                  ? 'Пройти тест повторно'
                  : 'Определить уровень'}
            </Link>
          </Button>
          {data.assessment && (
            <Link
              href="/placement"
              className="text-primary mt-3 flex min-h-11 items-center text-sm"
            >
              Результат и учебный маршрут →
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Flag, Play, BookOpen, RotateCcw } from 'lucide-react';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import { Card, Progress } from '@/components/ui/game';
import type { LearnerOverview } from '@/lib/learning/map';
const names = {
  grammar: 'Грамматика',
  vocabulary: 'Лексика',
  reading: 'Чтение',
  listening: 'Задания с аудио',
};
const reasons = {
  practice: 'Повторим тему с ошибками',
  foundation: 'Укрепим основу',
  advance: 'Попробуем следующий уровень',
  goal: 'Подходит твоей цели',
  continue: 'Следующий шаг программы',
};
export function LearnerOverviewPanel({
  mode = 'map',
}: {
  mode?: 'map' | 'profile' | 'home';
}) {
  const { account, status, authError } = useTelegram();
  if (status === 'loading') return <p role="status">Проверяем вход…</p>;
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <h2 className="font-bold">Твой личный прогресс</h2>
        <p className="mt-2 text-sm">
          {authError
            ? 'Не удалось проверить аккаунт. Открой профиль и повтори вход.'
            : 'Открой Voklumi через Telegram, чтобы увидеть свою карту и результаты.'}
        </p>
        <Link
          className="text-primary inline-flex min-h-11 items-center"
          href="/library"
        >
          Посмотреть библиотеку →
        </Link>
      </Card>
    );
  return <AccountOverview key={account.id} mode={mode} />;
}
function AccountOverview({ mode }: { mode: 'map' | 'profile' | 'home' }) {
  const [data, setData] = useState<LearnerOverview | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [course, setCourse] = useState(''),
    [saving, setSaving] = useState(false);
  const reduced = useReducedMotion(),
    active = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void fetchWithTimeout('/api/overview', {
      cache: 'no-store',
      signal: c.signal,
    })
      .then(async (r) => {
        const d = await readJson(r);
        if (!r.ok) throw Error(d.error);
        if (!c.signal.aborted) {
          setData(d);
          setCourse(d.plan.courseId ?? '');
          setError('');
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e.message ?? 'Не удалось загрузить прогресс.');
      });
    return () => c.abort();
  }, [retry]);
  async function saveCourse() {
    if (!data || locked.current) return;
    locked.current = true;
    setSaving(true);
    setError('');
    try {
      const r = await fetchWithTimeout('/api/learning-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preferences',
          goal: data.plan.goal,
          courseId: course || null,
        }),
      });
      const d = await readJson(r);
      if (!r.ok) throw Error(d.error);
      if (active.current) {
        setData(null);
        setRetry((v) => v + 1);
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : 'Не удалось сохранить курс.');
    } finally {
      locked.current = false;
      if (active.current) setSaving(false);
    }
  }
  if (error)
    return (
      <Card>
        <p role="alert">{error}</p>
        <button
          className="min-h-11 underline"
          onClick={() => {
            setError('');
            setData(null);
            setRetry((v) => v + 1);
          }}
        >
          Повторить загрузку
        </button>
      </Card>
    );
  if (!data) return <p role="status">Загружаем твою карту и статистику…</p>;
  const stats = data.statistics;
  const selectedCourse = data.plan.courses.find(
    (c) => c.id === data.plan.courseId,
  );
  if (mode === 'home' && !data.plan.level) return null;
  return (
    <div className="space-y-4">
      <button
        className="text-primary min-h-11 text-sm"
        disabled={saving}
        onClick={() => {
          setData(null);
          setRetry((v) => v + 1);
        }}
      >
        Обновить прогресс
      </button>
      <Card>
        <h2 className="font-bold">
          {mode === 'profile' ? 'Мой учебный план' : 'Следующий урок'}
        </h2>
        {data.next ? (
          <>
            <p className="mt-2 text-xs text-teal-200">
              {selectedCourse && data.next.reason === 'advance'
                ? `Урок из выбранного курса ${selectedCourse.level}`
                : reasons[data.next.reason]}
            </p>
            <Link
              className="bg-primary text-primary-foreground mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold"
              href={`/lesson?lesson=${data.next.id}`}
            >
              Начать: {data.next.title}
              <Play size={16} />
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm">
            {data.plan.level
              ? 'Новых шагов в выбранной программе пока нет. Можно повторить материал или выбрать другой курс.'
              : 'Пройди определение уровня или выбери «Я совсем новичок», чтобы получить рекомендации.'}
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            className="text-primary inline-flex min-h-11 items-center"
            href="/placement"
          >
            Определить уровень →
          </Link>
          <Link
            className="text-primary inline-flex min-h-11 items-center"
            href="/learning-plan"
          >
            Цель и рекомендации →
          </Link>
        </div>
        {data.plan.level && (
          <p className="text-muted-foreground text-xs">
            Ориентир маршрута: {data.plan.targetLevel ?? data.plan.level}. Это
            не сертификат CEFR.
          </p>
        )}
        {selectedCourse && (
          <div className="text-muted-foreground mt-3 text-xs">
            <p>
              Выбран курс: {selectedCourse.title}. Чтобы вернуть подбор по
              уровню, на карте выбери «Все доступные курсы».
            </p>
            <Link
              className="text-primary inline-flex min-h-11 items-center"
              href="/learn"
            >
              Изменить выбранный курс →
            </Link>
          </div>
        )}
      </Card>
      <Link
        href="/review"
        className="border-primary/30 bg-primary/10 flex min-h-14 items-center gap-3 rounded-2xl border p-4 font-bold"
      >
        <RotateCcw size={20} />
        {stats.dueWords
          ? `Повторить слова · ${stats.dueWords} на сегодня`
          : 'Повторение слов'}
      </Link>
      {mode === 'profile' && (
        <Card>
          <h2 className="font-bold">Моя статистика</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            {[
              ['Зачтено уроков', stats.passedLessons],
              ['Завершено попыток', stats.completedAttempts],
              ['Слова из пройденных уроков', stats.words],
              ['Выполнено повторений', stats.reviews],
              [
                'Правильных ответов',
                stats.accuracy === null
                  ? 'Нет ответов'
                  : `${stats.accuracy}% (${stats.correct}/${stats.answered})`,
              ],
              [
                'Время завершённых попыток',
                stats.attemptMinutes === null
                  ? 'Нет данных'
                  : `${stats.attemptMinutes} мин`,
              ],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="mt-1 font-bold break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-4 text-xs">
            Точность включает повторные попытки. Время считается от открытия до
            завершения и включает паузы; это не замер активного обучения.
            Наличие слова в уроке не доказывает его запоминание.
          </p>
        </Card>
      )}
      {mode !== 'home' && !!data.plan.skills.length && (
        <Card>
          <h2 className="font-bold">Навыки и рекомендуемые темы</h2>
          {data.plan.skills.map((s) => (
            <div key={s.skill} className="mt-4">
              <p className="text-sm">
                {names[s.skill]} · {s.correct}/{s.answered} ·{' '}
                {s.weak ? 'Нужно закрепить' : 'Хороший результат'}
              </p>
              <Progress
                value={Math.round((100 * s.correct) / s.answered)}
                label={names[s.skill]}
                className="mt-2"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                Источник:{' '}
                {s.source === 'lessons'
                  ? 'ответы в уроках'
                  : 'ориентировочный тест'}
              </p>
            </div>
          ))}
        </Card>
      )}
      {mode === 'map' && (
        <>
          <Card>
            <label className="block text-sm">
              Выбранный курс
              <select
                className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
                value={course}
                disabled={saving}
                onChange={(e) => setCourse(e.target.value)}
              >
                <option value="">Все доступные курсы</option>
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.level} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-primary mt-2 min-h-11 font-bold"
              disabled={saving}
              onClick={() => void saveCourse()}
            >
              {saving ? 'Сохраняем…' : 'Сохранить выбор'}
            </button>
          </Card>
          {data.courses
            .filter((c) => !data.plan.courseId || c.id === data.plan.courseId)
            .map((c) => (
              <section key={c.id} className="space-y-4">
                <h2 className="text-lg font-bold">
                  {c.title} · {c.level}
                </h2>
                {c.chapters.map((ch) => (
                  <Card key={ch.title}>
                    <h3 className="font-bold">{ch.title}</h3>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Зачтено {ch.completed} из {ch.total}
                    </p>
                    <Progress
                      className="mt-3"
                      value={ch.progress}
                      label={`Прогресс: ${ch.title}`}
                    />
                    {ch.completed === ch.total && ch.total > 0 && (
                      <p className="mt-3 text-teal-200">
                        Глава пройдена ✓ Награды — в профиле.
                      </p>
                    )}
                    <ol className="border-primary/30 mt-5 ml-3 space-y-5 border-l-2 pl-5">
                      {ch.lessons.map((l) => (
                        <motion.li
                          initial={reduced ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={l.id}
                          className={`rounded-2xl border p-3 ${l.id === data.next?.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="mt-1 text-teal-200">
                              {l.state === 'completed' ? (
                                <Check size={20} />
                              ) : l.checkpoint ? (
                                <Flag size={20} />
                              ) : (
                                <BookOpen size={20} />
                              )}
                            </span>
                            <div className="min-w-0">
                              <h4 className="font-bold break-words">
                                {l.title}
                              </h4>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {l.state === 'completed'
                                  ? `Зачтено · лучший результат ${l.bestScore}%${l.id === data.next?.id ? ' · Рекомендуем закрепить' : ''}`
                                  : l.state === 'recommended'
                                    ? 'Рекомендуем сейчас'
                                    : l.state === 'foundation'
                                      ? 'Сначала рекомендуются предыдущие темы'
                                      : 'Доступно для самостоятельного выбора'}
                                {l.checkpoint ? ' · Контрольная точка' : ''}
                              </p>
                              <Link
                                className="text-primary inline-flex min-h-11 items-center text-sm"
                                href={`/lesson?lesson=${l.id}`}
                              >
                                {l.state === 'completed'
                                  ? 'Повторить урок'
                                  : 'Открыть урок'}{' '}
                                →
                              </Link>
                            </div>
                          </div>
                        </motion.li>
                      ))}
                    </ol>
                  </Card>
                ))}
              </section>
            ))}
          {!data.courses.length && (
            <Card>
              Нет доступных опубликованных уроков. Попробуй обновить библиотеку
              позже.
            </Card>
          )}
        </>
      )}
    </div>
  );
}

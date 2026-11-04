'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, Clock3, Target } from 'lucide-react';
import { Card, Progress } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import {
  accuracyChange,
  analyticsSegments,
  analyticsSkills,
  difficultTopics,
  type EnglishAnalytics,
} from '@/lib/learning/analytics';
const date = (s: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(s.slice(0, 10) + 'T12:00:00Z'));
export function elapsed(seconds: number | null) {
  if (seconds === null) return 'Нет данных';
  const minutes = Math.round(seconds / 60);
  return minutes < 1
    ? 'Менее 1 мин'
    : minutes < 60
      ? `${minutes} мин`
      : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}
function Trend({ report }: { report: EnglishAnalytics }) {
  const segments = analyticsSegments(report.daily);
  if (!segments.length)
    return (
      <p className="text-muted-foreground mt-4 text-sm">
        Пока нет проверенных ответов за этот период. График появится после
        завершения урока.
      </p>
    );
  return (
    <>
      <svg
        viewBox="0 0 600 120"
        role="img"
        aria-label={`Динамика правильных ответов за ${report.days} дней. Пропуски означают отсутствие данных.`}
        className="text-primary mt-5 h-auto w-full"
      >
        {[10, 60, 110].map((y) => (
          <line
            key={y}
            x1="20"
            x2="580"
            y1={y}
            y2={y}
            stroke="currentColor"
            opacity="0.15"
          />
        ))}
        {segments.map((segment, i) => (
          <g key={i}>
            <polyline
              points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {segment.map((p) => (
              <circle key={p.x} cx={p.x} cy={p.y} r="3" fill="currentColor" />
            ))}
          </g>
        ))}
      </svg>
      <div className="text-muted-foreground flex justify-between gap-3 text-xs">
        <span>{date(report.start)}</span>
        <span>{date(report.end)}</span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Снизу вверх: 0%, 50%, 100%. День без ответов — разрыв линии.
      </p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          Данные графика по дням
        </summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              Дневная точность по завершённым попыткам
            </caption>
            <thead>
              <tr>
                <th className="p-2">День</th>
                <th className="p-2">Верно / всего</th>
                <th className="p-2">Точность</th>
              </tr>
            </thead>
            <tbody>
              {report.daily.map((d) => (
                <tr key={d.date}>
                  <th scope="row" className="p-2">
                    {date(d.date)}
                  </th>
                  <td className="p-2">
                    {d.correct} / {d.answered}
                  </td>
                  <td className="p-2">
                    {d.accuracy === null ? 'Нет данных' : `${d.accuracy}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function AnalyticsPanel() {
  const { account } = useTelegram();
  return <AccountAnalytics key={account?.id ?? 'anonymous'} />;
}
function AccountAnalytics() {
  const { account, status } = useTelegram();
  const [days, setDays] = useState<7 | 30 | 90>(30),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [topicLimit, setTopicLimit] = useState(8);
  const [result, setResult] = useState<{
    key: string;
    data: EnglishAnalytics | null;
    error: string;
    denied: boolean;
  } | null>(null);
  const key = `${days}:${offset}`;
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const controller = new AbortController();
    void fetchWithTimeout(`/api/analytics?days=${days}&offset=${offset}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await readJson(r);
        if (!controller.signal.aborted)
          setResult({
            key,
            data: r.ok ? body : null,
            error: r.ok ? '' : (body.error ?? 'Не удалось загрузить отчёт.'),
            denied: r.status === 403 || r.status === 401,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error:
              'Не удалось загрузить отчёт. Проверь подключение и повтори запрос.',
            denied: false,
          });
      });
    return () => controller.abort();
  }, [account, key, days, offset, revision]);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const refresh = () => {
      if (document.visibilityState === 'visible') setRevision((v) => v + 1);
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, [account]);
  const current = result?.key === key ? result : null,
    report = current?.data ?? null,
    busy = account?.mode === 'telegram' && !current;
  if (status === 'loading') return <p role="status">Проверяем вход…</p>;
  if (account?.mode !== 'telegram' || current?.denied)
    return (
      <Card className="border-primary/30">
        <BarChart3 className="text-primary" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-bold">Узнай, что уже получается</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          В Premium доступны навыки, сложные темы, динамика и история занятий.
          Отчёт строится только по твоим сохранённым результатам.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href={account?.mode === 'telegram' ? '/premium' : '/profile'}>
            {account?.mode === 'telegram'
              ? 'Мой Premium'
              : 'Вход через Telegram'}
          </Link>
        </Button>
        <Link
          href="/profile"
          className="text-primary mt-3 flex min-h-11 items-center text-sm"
        >
          Базовый прогресс и XP →
        </Link>
      </Card>
    );
  const change = report
    ? accuracyChange(report.current, report.previous)
    : null;
  const hard = report ? difficultTopics(report.topics) : [];
  return (
    <section
      className="space-y-4"
      aria-label="Подробный отчёт об английском"
      aria-busy={busy}
    >
      <div
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label="Период аналитики"
      >
        {([7, 30, 90] as const).map((n) => (
          <button
            key={n}
            className={`min-h-12 rounded-2xl border px-2 text-sm font-bold ${days === n ? 'border-primary bg-primary/15 text-primary' : 'bg-card'}`}
            aria-pressed={days === n}
            onClick={() => {
              setDays(n);
              setOffset(0);
              setTopicLimit(8);
            }}
          >
            {n} дней
          </button>
        ))}
      </div>
      {busy && <p role="status">Считаем результаты по сохранённым ответам…</p>}
      {current?.error && (
        <Card>
          <p role="alert">{current.error}</p>
          <Button className="mt-3" onClick={() => setRevision((v) => v + 1)}>
            Повторить загрузку
          </Button>
        </Card>
      )}
      {report && (
        <>
          <Card className="starfield border-primary/30">
            <p className="eyebrow">Твой английский · Premium</p>
            <h2 className="mt-3 text-xl font-bold">
              {date(report.start)} — {date(report.end)}
            </h2>
            <p className="text-muted-foreground mt-2 text-xs">
              Часовой пояс: {report.timeZone}. Текущий день ещё не завершён.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {[
                [
                  'Точность',
                  report.current.accuracy === null
                    ? 'Нет данных'
                    : `${report.current.accuracy}%`,
                ],
                ['Проверено заданий', report.current.answered],
                ['Завершено попыток', report.current.attempts],
                ['Время попыток', elapsed(report.current.elapsedSeconds)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className="mt-1 text-lg font-bold">{value}</p>
                </div>
              ))}
            </div>
          </Card>
          {report.current.answered === 0 && (
            <Card>
              <h3 className="font-bold">Пока недостаточно данных</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                За выбранный период нет проверенных заданий в завершённых
                уроках. Выбери другой период или пройди урок. Если старые
                попытки сохранены без ответов, они останутся в истории.
              </p>
              <Button asChild className="mt-3 w-full">
                <Link href="/learn">Перейти к урокам</Link>
              </Button>
            </Card>
          )}
          <Card>
            <h3 className="flex items-center gap-2 font-bold">
              <Target size={18} aria-hidden="true" />
              По сравнению с прошлым периодом
            </h3>
            <p className="text-muted-foreground mt-2 text-xs">
              {date(report.previousStart)} — {date(report.previousEnd)} · те же{' '}
              {report.days} дней
            </p>
            <p className="mt-3 text-lg font-bold">
              {change === null
                ? 'Недостаточно данных для сравнения'
                : `${change > 0 ? '+' : ''}${change} п. п. к точности`}
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Сейчас: {report.current.correct}/{report.current.answered} ·
              раньше: {report.previous.correct}/{report.previous.answered}
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Для сравнения нужно минимум 5 заданий в каждом периоде. Темы и
              сложность могли различаться; это описание результатов, а не
              доказательство роста уровня.
            </p>
          </Card>
          <Card>
            <h3 className="font-bold">Динамика правильных ответов</h3>
            <Trend report={report} />
          </Card>
          <Card>
            <h3 className="font-bold">Четыре навыка</h3>
            <div className="mt-4 space-y-5">
              {report.skills.map((s) => {
                const delta = accuracyChange(s, {
                  answered: s.previousAnswered,
                  accuracy: s.previousAccuracy,
                });
                return (
                  <div key={s.skill}>
                    <div className="flex justify-between gap-2 text-sm">
                      <h4 className="font-semibold">
                        {analyticsSkills[s.skill]}
                      </h4>
                      <span>
                        {s.accuracy === null ? 'Нет данных' : `${s.accuracy}%`}
                      </span>
                    </div>
                    {s.accuracy !== null && (
                      <Progress
                        className="mt-2"
                        value={s.accuracy}
                        label={`${analyticsSkills[s.skill]}: правильных ${s.correct} из ${s.answered}`}
                      />
                    )}
                    <p className="text-muted-foreground mt-2 text-xs">
                      {s.answered
                        ? `${s.correct} из ${s.answered} заданий${s.answered < 5 ? ' · малая выборка' : ''}`
                        : 'Ещё нет заданий с однозначно определённым навыком.'}
                      {delta === null
                        ? ''
                        : ` · ${delta > 0 ? '+' : ''}${delta} п. п. к прошлому периоду`}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-4 text-xs">
              Навык определяется по сохранённому типу упражнения. Без
              однозначного навыка: {report.unclassified} заданий. Они включены в
              общую точность и статистику тем.
            </p>
          </Card>
          <Card>
            <h3 className="font-bold">Наиболее сложные темы</h3>
            {hard.length ? (
              <ul className="mt-3 space-y-3">
                {hard.map((t) => (
                  <li key={t.lessonId} className="rounded-xl border p-3">
                    <p className="text-sm font-semibold">{t.title}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.accuracy}% · {t.correct}/{t.answered} верно
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                Пока нет тем с точностью ниже 60% и хотя бы 5 проверенными
                заданиями. Это не означает, что все темы освоены.
              </p>
            )}
          </Card>
          <Card>
            <h3 className="font-bold">Точность по темам уроков</h3>
            {report.topics.length ? (
              <>
                <ul className="mt-3 space-y-4">
                  {report.topics.slice(0, topicLimit).map((t) => (
                    <li key={t.lessonId}>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <h4 className="min-w-0 font-semibold break-words">
                          {t.title}
                        </h4>
                        <span className="shrink-0 text-teal-200">
                          {t.accuracy}%
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t.course} · {t.unit}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t.correct}/{t.answered} верно
                        {t.answered < 5 ? ' · малая выборка' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                {topicLimit < report.topics.length && (
                  <Button
                    className="mt-4 w-full"
                    variant="outline"
                    onClick={() => setTopicLimit((n) => n + 10)}
                  >
                    Показать ещё темы ({report.topics.length - topicLimit})
                  </Button>
                )}
              </>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                Нет проверенных заданий по темам за этот период.
              </p>
            )}
          </Card>
          <Card>
            <h3 className="flex items-center gap-2 font-bold">
              <Clock3 size={18} aria-hidden="true" />
              Время занятий
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ['Всего сейчас', elapsed(report.current.elapsedSeconds)],
                [
                  'За предыдущий период',
                  elapsed(report.previous.elapsedSeconds),
                ],
                [
                  'В среднем на попытку',
                  elapsed(report.current.averageSeconds),
                ],
                ['Медиана попытки', elapsed(report.current.medianSeconds)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground mt-4 text-xs">
              От открытия до завершения урока, включая паузы и время в фоне. Это
              не активное учебное время. Попыток дольше двух часов:{' '}
              {report.current.longAttempts}.
            </p>
          </Card>
          <Card>
            <h3 className="font-bold">История уроков</h3>
            <p className="text-muted-foreground mt-2 text-xs">
              Повторные попытки показаны отдельно · всего {report.historyTotal}
            </p>
            {report.history.length ? (
              <ol className="mt-4 space-y-3">
                {report.history.map((h) => (
                  <li key={h.attemptId} className="rounded-xl border p-3">
                    <p className="text-sm font-semibold">{h.title}</p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {new Date(h.completedAt).toLocaleString('ru-RU', {
                        timeZone: report.timeZone,
                      })}{' '}
                      · {h.score}% · {elapsed(h.elapsedSeconds)}
                    </p>
                    {h.canOpen && (
                      <Link
                        className="text-primary mt-1 flex min-h-11 items-center text-sm"
                        href={`/lesson?lesson=${h.lessonId}`}
                      >
                        Открыть урок →
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                На этой странице нет завершённых попыток.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 20))}
              >
                Предыдущие
              </Button>
              <Button
                variant="outline"
                disabled={
                  offset + 20 >= report.historyTotal || offset + 20 > 100000
                }
                onClick={() => setOffset((n) => n + 20)}
              >
                Следующие
              </Button>
            </div>
          </Card>
          <Card>
            <h3 className="font-bold">Что изучать дальше</h3>
            {report.recommendations.length ? (
              report.recommendations.map((r) => (
                <Link
                  key={r.lessonId}
                  href={`/lesson?lesson=${r.lessonId}`}
                  className="mt-3 block rounded-xl border p-3"
                >
                  <span className="text-sm font-semibold">{r.title} →</span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {r.reason === 'weak_topic'
                      ? 'Закрепить тему с ошибками'
                      : 'Следующий шаг с учётом предварительного уровня и прогресса'}
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                Пока нет подходящих рекомендаций. Определи предварительный
                уровень или выбери урок самостоятельно.
              </p>
            )}
            <Link
              href="/learning-plan"
              className="text-primary mt-3 flex min-h-11 items-center text-sm"
            >
              Мой учебный план →
            </Link>
          </Card>
          <details className="rounded-2xl border px-4">
            <summary className="min-h-12 cursor-pointer py-4 font-bold">
              Как читать этот отчёт
            </summary>
            <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
              Только завершённые попытки уроков английского. Каждое проверенное
              задание — одна запись, включая комплексные задания с несколькими
              вопросами. Повторы учитываются; ответ относится к дню завершения
              попытки. Незавершённые уроки и тест определения уровня не
              включены. Тема — тема урока, а не автоматически угаданное
              грамматическое правило. Проценты не являются официальной
              сертификацией CEFR и не подтверждают владение языком.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

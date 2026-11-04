'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Progress } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import type { ExtendedData } from '@/lib/placement/extended';
const names: Record<string, string> = {
  grammar: 'Грамматика',
  vocabulary: 'Лексика',
  reading: 'Понимание текста',
};
export function ExtendedPanel() {
  const { account } = useTelegram();
  return <AccountTest key={account?.id ?? 'anonymous'} />;
}
function AccountTest() {
  const { account } = useTelegram();
  const [data, setData] = useState<ExtendedData | null>(null),
    [option, setOption] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const lock = useRef(false),
    active = useRef(true),
    pending = useRef<{ body: string; id: string } | null>(null);
  const load = useCallback(async (id?: string, signal?: AbortSignal) => {
    const r = await fetchWithTimeout(
      '/api/extended-test' + (id ? '?attempt=' + id : ''),
      { cache: 'no-store', signal },
    );
    const d = await readJson(r);
    if (!r.ok) throw Error(d.error);
    if (active.current && !signal?.aborted) {
      setData(d);
      setOption('');
      setError('');
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const c = new AbortController();
    if (account?.mode === 'telegram')
      void load(
        new URL(window.location.href).searchParams.get('attempt') ?? undefined,
        c.signal,
      ).catch((e) => {
        if (!c.signal.aborted) setError((e as Error).message);
      });
    return () => {
      active.current = false;
      c.abort();
    };
  }, [account?.id, account?.mode, retry, load]);
  async function send(body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const key = JSON.stringify(body);
    if (pending.current?.body !== key)
      pending.current = { body: key, id: crypto.randomUUID() };
    try {
      const r = await fetchWithTimeout('/api/extended-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requestId: pending.current!.id }),
      });
      const d = await readJson(r);
      if (!r.ok) throw Error(d.error);
      if (active.current) {
        setData(d);
        setOption('');
        pending.current = null;
        if (d.id)
          window.history.replaceState(
            null,
            '',
            '/extended-test?attempt=' + d.id,
          );
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold">36 вопросов · без таймера</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          По 12 вопросов на грамматику, лексику и понимание текста. Сложность
          адаптируется к ответам. Можно остановиться и продолжить позднее.
        </p>
        <p className="mt-3 text-sm">
          Предварительная оценка, не официальный экзамен CEFR. Аудирование,
          говорение и письмо не оцениваются: проверенного аудиобанка сейчас нет.
        </p>
      </Card>
      {account?.mode !== 'telegram' ? (
        <Link
          href="/profile"
          className="text-primary inline-flex min-h-11 items-center"
        >
          Вход и профиль →
        </Link>
      ) : error ? (
        <Card>
          <p role="alert">{error}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setRetry((n) => n + 1)}
          >
            Загрузить сохранённый тест
          </Button>
          <Link
            href="/premium"
            className="text-primary flex min-h-11 items-center"
          >
            Доступ Premium →
          </Link>
          <Link
            href="/placement"
            className="text-primary flex min-h-11 items-center"
          >
            Бесплатное определение уровня →
          </Link>
        </Card>
      ) : !data ? (
        <p role="status">Загружаем тест…</p>
      ) : (
        <>
          {data.question ? (
            <>
              <Progress
                value={(100 * data.answered) / 36}
                label="Прогресс расширенного теста"
              />
              <p className="text-muted-foreground text-xs">
                {data.answered + 1} / 36 · {names[data.question.category]}
              </p>
              {data.question.passage && (
                <Card>
                  <p lang="en" className="leading-relaxed">
                    {data.question.passage}
                  </p>
                </Card>
              )}
              <h2 className="text-lg font-bold">{data.question.prompt}</h2>
              <fieldset className="space-y-3">
                <legend className="sr-only">Варианты ответа</legend>
                {data.question.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    lang="en"
                    disabled={busy}
                    aria-pressed={option === o.id}
                    className={
                      'bg-card min-h-14 w-full rounded-2xl border-2 p-4 text-left text-sm ' +
                      (option === o.id ? 'border-primary' : 'border-border')
                    }
                    onClick={() => setOption(o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </fieldset>
              <Button
                className="w-full"
                disabled={busy || !option}
                onClick={() =>
                  void send({
                    action: 'answer',
                    attemptId: data.id,
                    questionId: data.question!.id,
                    option,
                  })
                }
              >
                Сохранить ответ
              </Button>
            </>
          ) : data.result ? (
            <>
              <Card className="border-primary/40">
                <h2 className="text-xl font-bold">
                  Твой ориентир: {data.result.level}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Расчётный диапазон: {data.result.from}–{data.result.to}. Это
                  модель по ограниченному банку, не сертификат и не доказанная
                  точность оценки.
                </p>
                <div className="mt-4 space-y-3">
                  {Object.entries(data.result.categories).map(([k, s]) => (
                    <div key={k}>
                      <p className="text-sm">
                        {names[k]}: {s.correct} / {s.answered} · {s.accuracy}%
                      </p>
                      <Progress value={s.accuracy} label={names[k]} />
                    </div>
                  ))}
                </div>
              </Card>
              <h2 className="font-bold">Следующие занятия</h2>
              {data.recommendations.map((r) => (
                <Link
                  key={r.id}
                  href={'/lesson?lesson=' + r.id}
                  className="text-primary flex min-h-11 items-center rounded-xl border p-3 text-sm"
                >
                  {r.level} · {r.title} →
                </Link>
              ))}
              <details className="border-border rounded-2xl border p-4">
                <summary className="min-h-8 cursor-pointer font-bold">
                  Подробный разбор всех ответов
                </summary>
                <ol className="mt-4 space-y-4">
                  {data.review.map((q) => (
                    <li
                      key={q.position}
                      className="border-border border-t pt-3"
                    >
                      <p className="text-xs">
                        {q.position}. {names[q.category]} · {q.level} ·{' '}
                        {q.correct ? 'Верно' : 'Разберём ошибку'}
                      </p>
                      <p className="mt-2 font-bold">{q.prompt}</p>
                      {q.passage && (
                        <p
                          lang="en"
                          className="text-muted-foreground mt-2 text-sm"
                        >
                          {q.passage}
                        </p>
                      )}
                      <p className="mt-2 text-sm">
                        Твой ответ:{' '}
                        {q.options.find((o) => o.id === q.selected)?.label}
                      </p>
                      <p className="text-primary mt-1 text-sm">
                        Верный ответ:{' '}
                        {q.options.find((o) => o.id === q.correctOption)?.label}
                      </p>
                      <p className="text-muted-foreground mt-2 text-sm">
                        {q.explanation}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
              <Button
                disabled={busy}
                className="w-full"
                onClick={() => void send({ action: 'start' })}
              >
                Новый расширенный тест
              </Button>
            </>
          ) : (
            <Button
              disabled={busy}
              className="w-full"
              onClick={() => void send({ action: 'start' })}
            >
              Начать расширенный тест
            </Button>
          )}
          <Card>
            <h2 className="font-bold">История и сравнение</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Адаптивные наборы могут отличаться; проценты описывают ответы в
              каждой попытке.
            </p>
            {data.history.length < 2 && (
              <p className="text-muted-foreground mt-2 text-sm">
                Для сравнения нужны два завершённых теста.
              </p>
            )}
            {data.history.slice(0, 2).map((h) => (
              <div key={h.id} className="mt-4 rounded-xl border p-3">
                <button
                  className="text-primary min-h-11 text-left text-sm"
                  onClick={() => {
                    window.history.replaceState(
                      null,
                      '',
                      '/extended-test?attempt=' + h.id,
                    );
                    void load(h.id).catch((e) =>
                      setError((e as Error).message),
                    );
                  }}
                >
                  {new Date(h.completedAt).toLocaleString('ru-RU')} ·{' '}
                  {h.result.level}
                </button>
                {Object.entries(h.result.categories).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground text-xs">
                    {names[k]}: {v.accuracy}%
                  </p>
                ))}
              </div>
            ))}
            <details className="mt-3">
              <summary className="min-h-8 cursor-pointer text-sm">
                Все предыдущие тесты
              </summary>
              {data.history.map((h) => (
                <button
                  key={h.id}
                  className="text-primary block min-h-11 text-sm"
                  onClick={() =>
                    void load(h.id).catch((e) => setError((e as Error).message))
                  }
                >
                  {new Date(h.completedAt).toLocaleString('ru-RU')} ·{' '}
                  {h.result.level}
                </button>
              ))}
            </details>
          </Card>
        </>
      )}
    </div>
  );
}

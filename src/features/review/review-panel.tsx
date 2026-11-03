'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
type Card = { key: string; front: string; back: string; version: number };
type Queue = {
  total: number;
  due: number;
  cards: Card[];
  nextDue: string | null;
};
async function api(body: unknown) {
  const r = await fetchWithTimeout('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await readJson(r);
  if (!r.ok) throw Error(data.error ?? 'Не удалось сохранить повторение.');
  return data;
}
export function ReviewPanel() {
  const { account, status } = useTelegram();
  if (status === 'loading') return <p>Проверяем вход…</p>;
  if (account?.mode !== 'telegram')
    return (
      <section>
        <h1>Повторить слова</h1>
        <p>
          Войди через Telegram. Здесь появятся слова из успешно пройденных
          уроков.
        </p>
        <Link href="/profile">Профиль →</Link>
      </section>
    );
  return <ReviewContent key={account.id} />;
}
function ReviewContent() {
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [queue, setQueue] = useState<Queue | null>(null),
    [error, setError] = useState(''),
    [shown, setShown] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const pending = useRef<{
    action: string;
    key: string;
    version: number;
    rating: number;
    requestId: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void api({ action: 'queue' })
      .then((q) => {
        if (active) setQueue(q);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function answer(rating: number) {
    const card = queue?.cards[0];
    if (!card || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      pending.current ??= {
        action: 'answer',
        key: card.key,
        version: card.version,
        rating,
        requestId: crypto.randomUUID(),
      };
      setPendingRating(pending.current.rating);
      await api(pending.current);
      if (!active.current) return;
      pending.current = null;
      setPendingRating(null);
      const q = await api({ action: 'queue' });
      if (active.current) {
        setQueue(q);
        setShown(false);
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : 'Ошибка повторения.');
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  const card = queue?.cards[0];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Повторить слова</h1>
      <p className="text-muted-foreground text-sm">
        Сначала вспомни перевод, затем открой ответ и честно оцени воспоминание.
        Это тренировка памяти, а не экзамен.
      </p>
      {queue && (
        <p role="status">
          К повторению: {queue.due} · В словаре: {queue.total}
        </p>
      )}
      {error && (
        <div role="alert">
          {error}
          <button
            className="min-h-11 underline"
            disabled={busy}
            onClick={() => {
              pending.current = null;
              setPendingRating(null);
              setQueue(null);
              setError('');
              setShown(false);
              setRevision((v) => v + 1);
            }}
          >
            Обновить очередь
          </button>
        </div>
      )}
      {!queue && !error && <p>Загружаем карточки…</p>}
      {card ? (
        <div
          className="bg-card space-y-4 rounded-2xl border p-5"
          key={card.key}
        >
          <h2 className="text-xl font-bold break-words">{card.front}</h2>
          {!shown ? (
            <button
              className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl p-3"
              onClick={() => setShown(true)}
            >
              Показать перевод
            </button>
          ) : (
            <>
              <p className="break-words">{card.back}</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    [0, 'Не вспомнил'],
                    [3, 'С трудом'],
                    [4, 'Помню'],
                    [5, 'Легко'],
                  ] as const
                ).map(([r, label]) => (
                  <button
                    className="min-h-12 rounded-xl border p-2"
                    disabled={
                      busy || (pendingRating !== null && pendingRating !== r)
                    }
                    key={r}
                    onClick={() => void answer(r)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        queue && (
          <p>
            {queue.total
              ? 'На сегодня готово! Новая карточка: ' +
                (queue.nextDue
                  ? new Date(queue.nextDue).toLocaleString('ru-RU')
                  : 'пока не назначена')
              : 'Пройди урок со словарём на 60% или выше — его слова появятся здесь.'}
          </p>
        )
      )}
      <Link
        className="text-primary inline-flex min-h-11 items-center"
        href="/library"
      >
        Открыть уроки →
      </Link>
    </section>
  );
}

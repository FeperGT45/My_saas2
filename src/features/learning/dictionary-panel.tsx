'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, RotateCcw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/game';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import type {
  DictionaryData,
  DictionaryWord,
  DictionaryCollection,
  DictionaryQueue,
} from '@/lib/learning/dictionary';
async function post(body: unknown) {
  const r = await fetchWithTimeout('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readJson(r);
  if (!r.ok) throw Error(data.error ?? 'Не удалось сохранить словарь.');
  return data;
}
export function DictionaryPanel() {
  const { account } = useTelegram();
  return <AccountDictionary key={account?.id ?? 'anonymous'} />;
}
function WordEditor({
  word,
  collections,
  busy,
  onSave,
  onCancel,
}: {
  word: DictionaryWord | null;
  collections: DictionaryCollection[];
  busy: boolean;
  onSave: (data: unknown) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(word?.front ?? ''),
    [back, setBack] = useState(word?.back ?? ''),
    [example, setExample] = useState(word?.example ?? ''),
    [collection, setCollection] = useState(word?.collectionId ?? '');
  return (
    <Card>
      <h2 className="font-bold">
        {word ? 'Редактировать слово' : 'Новое слово'}
      </h2>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: word?.id ?? null,
            version: word?.version ?? 0,
            front: front.trim(),
            back: back.trim(),
            example: example.trim(),
            collectionId: collection || null,
          });
        }}
      >
        <label className="block text-sm">
          Английское слово или выражение
          <input
            lang="en"
            required
            maxLength={200}
            value={front}
            onChange={(e) => setFront(e.target.value)}
            disabled={busy}
            className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
          />
        </label>
        <label className="block text-sm">
          Перевод
          <input
            required
            maxLength={200}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            disabled={busy}
            className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
          />
        </label>
        <p className="text-muted-foreground text-xs">
          Автоперевода нет. Если перевод неизвестен, узнай его и введи
          самостоятельно.
        </p>
        <label className="block text-sm">
          Примеры использования (необязательно)
          <textarea
            maxLength={2000}
            rows={3}
            value={example}
            onChange={(e) => setExample(e.target.value)}
            disabled={busy}
            className="bg-background mt-2 w-full rounded-xl border p-3"
          />
        </label>
        <label className="block text-sm">
          Коллекция слова
          <select
            value={collection}
            disabled={busy}
            onChange={(e) => setCollection(e.target.value)}
            className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
          >
            <option value="">Без коллекции</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy}>Сохранить слово</Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}
function Trainer({
  collection,
  onClose,
}: {
  collection: string;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<DictionaryQueue | null>(null),
    [flipped, setFlipped] = useState(false),
    [reverse, setReverse] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(0);
  const pending = useRef<{
      id: string;
      rating: number;
      requestId: string;
    } | null>(null),
    locked = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function load() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const q = await post({
        action: 'train',
        collectionId: collection || null,
      });
      if (active.current) {
        setQueue(q);
        setFlipped(false);
        pending.current = null;
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function answer(rating: number) {
    const card = queue?.cards[0];
    if (!card || locked.current || !flipped) return;
    locked.current = true;
    setBusy(true);
    setError('');
    pending.current =
      pending.current?.id === card.id && pending.current.rating === rating
        ? pending.current
        : { id: card.id, rating, requestId: crypto.randomUUID() };
    try {
      await post({
        action: 'answer',
        id: card.id,
        key: card.key,
        version: card.version,
        rating,
        requestId: pending.current.requestId,
      });
      if (active.current) {
        pending.current = null;
        setQueue((q) => (q ? { ...q, cards: q.cards.slice(1) } : null));
        setFlipped(false);
        setDone((n) => n + 1);
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const card = queue?.cards[0];
  return (
    <Card className="border-primary/40">
      <h2 className="font-bold">Карточки моего словаря</h2>
      <p className="text-muted-foreground mt-2 text-xs">
        До 20 карточек за подход. Если не вспомнил — нажми «Повторить»: слово
        вернётся завтра. Если вспомнил — «Знаю»: интервалы постепенно
        увеличатся.
      </p>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={reverse}
          disabled={busy}
          onChange={(e) => {
            setReverse(e.target.checked);
            setFlipped(false);
          }}
        />
        Начинать с перевода
      </label>
      {error && (
        <p role="alert" className="my-3 text-sm text-rose-200">
          {error} Можно обновить очередь; уже сохранённая отметка не потеряется.
        </p>
      )}
      {!queue && (
        <Button
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? 'Загружаем…' : 'Загрузить карточки'}
        </Button>
      )}
      {card && (
        <>
          <button
            type="button"
            aria-label="Перевернуть карточку"
            aria-pressed={flipped}
            disabled={busy}
            onClick={() => setFlipped((v) => !v)}
            className="bg-primary/10 border-primary/30 mt-4 flex min-h-48 w-full flex-col items-center justify-center rounded-3xl border p-5 text-center"
          >
            <span className="text-muted-foreground text-xs">
              {flipped ? 'Ответ' : 'Нажми, чтобы увидеть ответ'}
            </span>
            <span className="mt-3 text-2xl font-bold break-words">
              {flipped
                ? reverse
                  ? card.front
                  : card.back
                : reverse
                  ? card.back
                  : card.front}
            </span>
            {flipped && card.example && (
              <span className="text-muted-foreground mt-4 text-sm break-words whitespace-pre-wrap">
                {card.example}
              </span>
            )}
          </button>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              disabled={busy || !flipped}
              variant="outline"
              onClick={() => void answer(0)}
            >
              Повторить
            </Button>
            <Button disabled={busy || !flipped} onClick={() => void answer(4)}>
              Знаю
            </Button>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Осталось в подходе: {queue!.cards.length}. Отмечено: {done}.
          </p>
        </>
      )}
      {queue && !card && (
        <p role="status" className="mt-4 text-sm">
          Карточек на сейчас нет. Отмечено за подход: {done}.
          {queue.nextDue
            ? ` Следующее повторение: ${new Date(queue.nextDue).toLocaleString('ru-RU')}.`
            : ' Можно добавить слова или загрузить следующую порцию.'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {queue && (
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            Обновить очередь
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Закрыть тренировку
        </Button>
      </div>
    </Card>
  );
}
function AccountDictionary() {
  const { account, status } = useTelegram();
  const [source, setSource] = useState<'own' | 'lessons'>('own'),
    [collection, setCollection] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
      key: string;
      data: DictionaryData | null;
      error: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<DictionaryWord | null | undefined>(
      undefined,
    ),
    [training, setTraining] = useState(false),
    [collectionTitle, setCollectionTitle] = useState(''),
    [editingCollection, setEditingCollection] =
      useState<DictionaryCollection | null>(null),
    [importCollection, setImportCollection] = useState('');
  const [deleting, setDeleting] = useState<{
    type: 'word' | 'collection';
    id: string;
    version: number;
    title: string;
  } | null>(null);
  const pending = useRef<{ body: string; requestId: string } | null>(null),
    locked = useRef(false),
    active = useRef(true);
  const key = JSON.stringify([source, collection, query, offset]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      source,
      search: query,
      offset: String(offset),
    });
    if (collection && source === 'own') params.set('collection', collection);
    void fetchWithTimeout('/api/dictionary?' + params, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await readJson(r);
        if (!controller.signal.aborted)
          setResult({
            key,
            data: r.ok ? body : null,
            error: r.ok ? '' : (body.error ?? 'Не удалось загрузить словарь.'),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error: 'Не удалось загрузить словарь.',
          });
      });
    return () => controller.abort();
  }, [account, key, source, collection, query, offset, revision]);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const refresh = () => {
      if (document.visibilityState === 'visible' && !locked.current)
        setRevision((n) => n + 1);
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [account]);
  const current = result?.key === key ? result : null,
    data = current?.data ?? null;
  async function mutate(action: string, payload: unknown) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const body = JSON.stringify({ action, data: payload });
    pending.current =
      pending.current?.body === body
        ? pending.current
        : { body, requestId: crypto.randomUUID() };
    try {
      const saved = await post({
        action,
        requestId: pending.current.requestId,
        data: payload,
      });
      if (active.current) {
        pending.current = null;
        setEditing(undefined);
        setDeleting(null);
        setCollectionTitle('');
        setEditingCollection(null);
        if (action === 'delete_collection') {
          setCollection('');
          setImportCollection('');
          setTraining(false);
        }
        setNotice(
          saved.alreadyExists
            ? 'Это слово уже есть в моём словаре.'
            : 'Изменения сохранены.',
        );
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function reloadDictionary() {
    setCollection('');
    setImportCollection('');
    setOffset(0);
    setEditing(undefined);
    setTraining(false);
    setError('');
    setRevision((n) => n + 1);
  }
  if (status === 'loading') return <p role="status">Проверяем вход…</p>;
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <h2 className="font-bold">Сохрани свои слова</h2>
        <p className="text-muted-foreground mt-3 text-sm">
          Войди через Telegram, чтобы увидеть слова из завершённых уроков. Свои
          коллекции и расширенные карточки доступны в Premium.
        </p>
        <Link
          href="/profile"
          className="text-primary mt-3 flex min-h-11 items-center"
        >
          Вход и профиль →
        </Link>
      </Card>
    );
  return (
    <div className="space-y-4">
      <Link
        href="/review"
        className="text-primary flex min-h-11 items-center gap-2 text-xs font-semibold"
      >
        <RotateCcw size={18} aria-hidden="true" />
        Базовое повторение · бесплатно →
      </Link>
      <div
        className="grid grid-cols-2 gap-2"
        role="group"
        aria-label="Источник слов"
      >
        {(
          [
            ['own', 'Мои слова'],
            ['lessons', 'Из уроков'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={source === value}
            className={`min-h-12 rounded-2xl border px-2 text-sm font-bold ${source === value ? 'border-primary bg-primary/10 text-primary' : 'bg-card'}`}
            onClick={() => {
              setSource(value);
              setCollection('');
              setOffset(0);
              setTraining(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        Поиск по слову, переводу или примеру
        <input
          type="search"
          maxLength={200}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Например: travel или путешествие"
          className="bg-card mt-2 min-h-12 w-full rounded-2xl border px-4"
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-400/30 p-3 text-sm"
        >
          {error}
          <button
            className="mt-2 flex min-h-11 items-center underline"
            onClick={reloadDictionary}
          >
            Обновить словарь
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-200">
          {notice}
        </p>
      )}
      {!current && <p role="status">Загружаем слова…</p>}
      {current?.error && (
        <Card>
          <p role="alert">{current.error}</p>
          <Button className="mt-3" onClick={reloadDictionary}>
            Повторить загрузку
          </Button>
        </Card>
      )}
      {data && (
        <>
          {!data.canManage && (
            <Card className="border-primary/30">
              <p className="text-sm">
                Изученные слова и базовые повторения бесплатны. Premium
                добавляет свои слова, коллекции и расширенные карточки. При
                окончании Premium словарь сохраняется.
              </p>
              <Link
                href="/premium"
                className="text-primary mt-3 flex min-h-11 items-center text-sm"
              >
                Мой Premium →
              </Link>
            </Card>
          )}
          {source === 'own' && (
            <label className="block text-sm">
              Фильтр по коллекции
              <select
                value={collection}
                onChange={(e) => {
                  setCollection(e.target.value);
                  setOffset(0);
                  setTraining(false);
                }}
                className="bg-card mt-2 min-h-12 w-full rounded-xl border px-3"
              >
                <option value="">Все коллекции и слова без коллекции</option>
                {data.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.words}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data.canManage && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="min-w-0 px-2 text-xs"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                <Plus size={16} aria-hidden="true" />
                Добавить слово
              </Button>
              {data.canTrain && (
                <Button
                  className="min-w-0 px-2 text-xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setTraining((v) => !v)}
                >
                  Карточки коллекции
                </Button>
              )}
            </div>
          )}
          {training && data.canTrain && (
            <Trainer
              key={collection}
              collection={collection}
              onClose={() => {
                setTraining(false);
                setRevision((n) => n + 1);
              }}
            />
          )}
          {editing !== undefined && data.canManage && (
            <WordEditor
              key={editing?.id ?? 'new'}
              word={editing}
              collections={data.collections}
              busy={busy}
              onSave={(payload) => void mutate('save_word', payload)}
              onCancel={() => setEditing(undefined)}
            />
          )}
          <details className="bg-card rounded-2xl border px-4">
            <summary className="min-h-12 cursor-pointer py-4 font-bold">
              Мои коллекции ({data.collections.length})
            </summary>
            {data.canManage && (
              <form
                className="mb-4 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate('save_collection', {
                    id: editingCollection?.id ?? null,
                    version: editingCollection?.version ?? 0,
                    title: collectionTitle.trim(),
                  });
                }}
              >
                <label className="block text-sm">
                  Название коллекции
                  <input
                    required
                    maxLength={80}
                    value={collectionTitle}
                    onChange={(e) => setCollectionTitle(e.target.value)}
                    disabled={busy}
                    className="bg-background mt-2 min-h-12 w-full rounded-xl border px-3"
                  />
                </label>
                <Button disabled={busy}>
                  {editingCollection
                    ? 'Сохранить название'
                    : 'Создать коллекцию'}
                </Button>
                {editingCollection && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingCollection(null);
                      setCollectionTitle('');
                    }}
                  >
                    Отмена
                  </Button>
                )}
              </form>
            )}
            <ul className="mb-4 space-y-3">
              {data.collections.map((c) => (
                <li key={c.id} className="rounded-xl border p-3">
                  <p className="text-sm font-bold break-words">
                    {c.title} · {c.words}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.canManage && (
                      <button
                        className="text-primary min-h-11 text-xs"
                        disabled={busy}
                        onClick={() => {
                          setEditingCollection(c);
                          setCollectionTitle(c.title);
                        }}
                      >
                        Переименовать
                      </button>
                    )}
                    <button
                      className="min-h-11 text-xs text-rose-200"
                      disabled={busy}
                      onClick={() => setDeleting({ type: 'collection', ...c })}
                    >
                      Удалить коллекцию
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mb-4 text-xs">
              До 1000 коллекций и 50 000 слов на аккаунт. Удаление коллекции
              оставляет её слова без коллекции.
            </p>
          </details>
          {source === 'lessons' && data.canManage && (
            <label className="block text-sm">
              Коллекция для добавления из уроков
              <select
                value={importCollection}
                onChange={(e) => setImportCollection(e.target.value)}
                className="bg-card mt-2 min-h-12 w-full rounded-xl border px-3"
              >
                <option value="">Без коллекции</option>
                {data.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {deleting && (
            <Card className="border-rose-400/40">
              <h2 className="font-bold">Удалить «{deleting.title}»?</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {deleting.type === 'collection'
                  ? 'Слова и их расписание останутся.'
                  : 'Слово исчезнет из своего словаря. Если оно изучалось в уроке, оно останется среди слов уроков и в базовом повторении.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      deleting.type === 'word'
                        ? 'delete_word'
                        : 'delete_collection',
                      { id: deleting.id, version: deleting.version },
                    )
                  }
                >
                  Подтвердить удаление
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Отмена удаления
                </Button>
              </div>
            </Card>
          )}
          <section aria-label="Слова словаря">
            <p className="text-muted-foreground mb-3 text-sm">
              Найдено: {data.total}
            </p>
            {data.words.length ? (
              <ul className="space-y-3">
                {data.words.map((w) => (
                  <li key={w.key} className="bg-card rounded-2xl border p-4">
                    <h2 className="text-lg font-bold break-words" lang="en">
                      {w.front}
                    </h2>
                    <p className="text-primary mt-1 text-sm break-words">
                      {w.back}
                    </p>
                    {w.example && (
                      <p className="text-muted-foreground mt-3 text-sm break-words whitespace-pre-wrap">
                        {w.example}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3">
                      {source === 'own' && w.id && (
                        <>
                          {data.canManage && (
                            <button
                              className="text-primary min-h-11 text-xs"
                              disabled={busy}
                              onClick={() => setEditing(w)}
                            >
                              Редактировать слово
                            </button>
                          )}
                          <button
                            className="min-h-11 text-xs text-rose-200"
                            disabled={busy}
                            onClick={() =>
                              setDeleting({
                                type: 'word',
                                id: w.id!,
                                version: w.version,
                                title: w.front,
                              })
                            }
                          >
                            Удалить слово
                          </button>
                        </>
                      )}
                      {source === 'lessons' &&
                        (w.imported ? (
                          <span className="text-muted-foreground py-3 text-xs">
                            Уже в моём словаре
                          </span>
                        ) : (
                          data.canManage && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void mutate('import', {
                                  key: w.key,
                                  collectionId: importCollection || null,
                                })
                              }
                            >
                              Добавить в мой словарь
                            </Button>
                          )
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Card>
                <BookOpen className="text-primary" aria-hidden="true" />
                <h2 className="mt-3 font-bold">
                  {query
                    ? 'Ничего не найдено'
                    : source === 'lessons'
                      ? 'Пока нет слов из уроков'
                      : 'Здесь появятся твои слова'}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {query
                    ? 'Попробуй начало английского слова или перевода.'
                    : source === 'lessons'
                      ? 'Заверши урок: доступные слова появятся здесь. Слова из архивных уроков тоже сохраняются.'
                      : 'Добавь слово с переводом или выбери слова во вкладке «Из уроков».'}
                </p>
                {source === 'lessons' && (
                  <Link
                    href="/learn"
                    className="text-primary mt-3 flex min-h-11 items-center text-sm"
                  >
                    К урокам →
                  </Link>
                )}
              </Card>
            )}
          </section>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={offset === 0 || busy}
              onClick={() => setOffset((n) => Math.max(0, n - 30))}
            >
              Предыдущие
            </Button>
            <Button
              variant="outline"
              disabled={offset + 30 >= data.total || busy}
              onClick={() => setOffset((n) => n + 30)}
            >
              Следующие
            </Button>
          </div>
          {data.statistics && (
            <Card>
              <h2 className="font-bold">Как идут повторения</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                {[
                  ['Слов в своём словаре', data.statistics.total],
                  ['Пора повторить', data.statistics.due],
                  ['Повторялись хотя бы раз', data.statistics.reviewed],
                  ['3+ успешных подряд', data.statistics.established],
                  ['Отметок «Знаю»', data.statistics.known],
                  ['Отметок «Повторить»', data.statistics.repeats],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="mt-1 font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
              {data.statistics.known + data.statistics.repeats > 0 ? (
                <Progress
                  className="mt-4"
                  value={
                    (100 * data.statistics.known) /
                    (data.statistics.known + data.statistics.repeats)
                  }
                  label="Доля успешных самооценок повторения"
                />
              ) : (
                <p className="text-muted-foreground mt-3 text-xs">
                  Пока нет отметок повторения.
                </p>
              )}
              <p className="text-muted-foreground mt-4 text-xs">
                По твоим отметкам в SM-2, включая базовые повторения этих слов.
                Это статистика практики, а не доказательство запоминания.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

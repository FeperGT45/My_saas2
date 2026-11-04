'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  LockKeyhole,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import type { StoryCatalog, StoryState } from '@/lib/stories/types';

async function get<T>(attempt?: string, signal?: AbortSignal): Promise<T> {
  const r = await fetchWithTimeout(
    '/api/stories' + (attempt ? '?attempt=' + encodeURIComponent(attempt) : ''),
    { cache: 'no-store', signal },
  );
  const data = await readJson(r);
  if (!r.ok) throw Error(data.error ?? 'Не удалось открыть истории.');
  return data;
}
function setAddress(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('attempt', id);
  else url.searchParams.delete('attempt');
  window.history.replaceState(null, '', url);
}
export function StoriesPanel() {
  const { account } = useTelegram();
  return <AccountStories key={account?.id ?? 'anonymous'} />;
}
function AccountStories() {
  const { account } = useTelegram();
  const [catalog, setCatalog] = useState<StoryCatalog | null>(null),
    [run, setRun] = useState<StoryState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const locked = useRef(false),
    active = useRef(true),
    pending = useRef<{ signature: string; id: string } | null>(null),
    reader = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    if (account?.mode === 'telegram') {
      const attempt = new URL(window.location.href).searchParams.get('attempt');
      void Promise.all([
        get<StoryCatalog>(undefined, controller.signal),
        attempt
          ? get<StoryState>(attempt, controller.signal)
          : Promise.resolve(null),
      ])
        .then(([c, s]) => {
          if (!controller.signal.aborted) {
            setCatalog(c);
            setRun(s);
            setLoading(false);
            setError('');
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError((e as Error).message);
            setLoading(false);
          }
        });
    }
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [account?.id, account?.mode, refresh]);
  useEffect(() => {
    if (run) {
      reader.current?.focus({ preventScroll: true });
      reader.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [run]);

  async function perform(command: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const signature = JSON.stringify(command);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    try {
      const r = await fetchWithTimeout('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, requestId: pending.current!.id }),
      });
      const data = await readJson(r);
      if (!r.ok) throw Error(data.error ?? 'Не удалось сохранить выбор.');
      if (!active.current) return;
      pending.current = null;
      setRun(data);
      setAddress(data.id);
      // Refresh rewards separately: a catalog failure must not discard a saved answer.
      void get<StoryCatalog>()
        .then((c) => {
          if (active.current) setCatalog(c);
        })
        .catch(() => {});
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function resume(id: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const s = await get<StoryState>(id);
      if (active.current) {
        setRun(s);
        setAddress(id);
        pending.current = null;
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <BookOpen className="text-primary mb-3" aria-hidden="true" />
        <h2 className="font-bold">Твой выбор меняет историю</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Одна история A1 доступна бесплатно. Войди через Telegram, чтобы читать
          и сохранять прохождение.
        </p>
        <Link
          href="/profile"
          className="text-primary mt-4 inline-flex min-h-11 items-center"
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
              disabled={busy}
              variant="outline"
              onClick={() =>
                run ? void resume(run.id) : setRefresh((v) => v + 1)
              }
            >
              Загрузить сохранённое
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => {
                setAddress();
                setRun(null);
                setError('');
                setRefresh((v) => v + 1);
              }}
            >
              К каталогу
            </Button>
          </div>
        </Card>
      )}
      {loading && (
        <p role="status" className="text-muted-foreground">
          Открываем библиотеку историй…
        </p>
      )}
      {run ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRun(null);
              setAddress();
              pending.current = null;
            }}
            className="text-primary min-h-11 text-sm"
          >
            ← Все истории
          </button>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-primary rounded-full border px-3 py-1">
              {run.level} · чтение
            </span>
            <span className="text-muted-foreground">
              {run.visited} сцен прочитано
            </span>
          </div>
          <h2
            ref={reader}
            tabIndex={-1}
            className="scroll-mt-4 text-xl font-extrabold outline-none"
          >
            {run.title}
          </h2>
          {!run.accessible ? (
            <Card>
              <LockKeyhole className="text-primary mb-3" aria-hidden="true" />
              <h3 className="font-bold">Продолжение доступно с Premium</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Твоё место в истории и полученные концовки сохранены. После
                активации можно продолжить отсюда.
              </p>
              <Link
                href="/premium"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Возможности Premium →
              </Link>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void resume(run.id)}
              >
                Проверить доступ
              </Button>
            </Card>
          ) : (
            run.node && (
              <>
                {run.feedback && (
                  <div
                    role="status"
                    className="border-primary/30 bg-primary/10 rounded-2xl border p-4 text-sm"
                  >
                    <p className="font-bold">
                      {run.feedback.correct
                        ? 'Верно · продолжим историю'
                        : 'Разберём ответ'}
                    </p>
                    <p className="mt-2 leading-relaxed">
                      {run.feedback.explanation}
                    </p>
                  </div>
                )}
                {run.transcript.length > 0 && (
                  <details className="border-border rounded-2xl border p-4">
                    <summary className="min-h-7 cursor-pointer text-sm">
                      Ранее в этой истории
                    </summary>
                    <ol className="mt-4 space-y-4">
                      {run.transcript.map((entry, i) => (
                        <li
                          key={i}
                          className="border-primary/30 border-l-2 pl-3"
                        >
                          <p className="text-primary text-xs font-bold">
                            {entry.speaker}
                          </p>
                          <p lang="en" className="mt-1 text-sm leading-relaxed">
                            {entry.text}
                          </p>
                          <p
                            lang="en"
                            className="text-muted-foreground mt-2 text-xs"
                          >
                            → {entry.choice}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <Card className="border-primary/30 bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-400/5">
                  <p className="text-primary mb-3 text-xs font-bold tracking-widest uppercase">
                    {run.node.speaker}
                  </p>
                  <p
                    lang="en"
                    className="text-base leading-loose whitespace-pre-line"
                  >
                    {run.node.text}
                  </p>
                  <details className="border-border mt-5 border-t pt-3">
                    <summary className="text-primary min-h-9 cursor-pointer text-sm">
                      Слова и подсказки
                    </summary>
                    <dl className="mt-3 space-y-3">
                      {run.node.vocabulary.map((v) => (
                        <div key={v.word}>
                          <dt lang="en" className="font-bold">
                            {v.word}
                          </dt>
                          <dd className="text-muted-foreground mt-1 text-sm">
                            {v.translation}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {run.node.grammar && (
                      <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm leading-relaxed">
                        {run.node.grammar}
                      </p>
                    )}
                  </details>
                </Card>
                {run.status === 'active' ? (
                  <section aria-label="Выбор реплики" className="space-y-3">
                    <h3 className="text-sm font-bold">
                      {run.node.question ? 'Учебное задание' : 'Как ответишь?'}
                    </h3>
                    {run.node.question && (
                      <p lang="en" className="text-muted-foreground text-sm">
                        {run.node.question}
                      </p>
                    )}
                    {run.node.choices.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        lang="en"
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            action: 'choose',
                            attemptId: run.id,
                            version: run.version,
                            choiceId: c.id,
                          })
                        }
                        className="border-border bg-card hover:border-primary focus-visible:outline-primary flex min-h-14 w-full items-start gap-3 rounded-2xl border p-4 text-left text-sm leading-relaxed transition disabled:opacity-50"
                      >
                        <span
                          aria-hidden="true"
                          className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{c.text}</span>
                        <ChevronRight
                          size={16}
                          className="text-primary mt-1 shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                    <p role="status" className="text-muted-foreground text-xs">
                      {busy
                        ? 'Сохраняем выбор…'
                        : 'Каждый выбор сохраняется. Можно вернуться позже.'}
                    </p>
                  </section>
                ) : run.status === 'completed' ? (
                  <Card>
                    <Trophy
                      className="mb-3 text-amber-300"
                      aria-hidden="true"
                    />
                    <p className="eyebrow">Концовка получена</p>
                    <h3 className="mt-2 text-lg font-bold">
                      {run.node.ending?.title}
                    </h3>
                    <p className="text-primary mt-2 text-sm">{run.reward}</p>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {run.newEnding
                        ? 'Новый значок добавлен в твою коллекцию.'
                        : 'Эта концовка уже в коллекции. Повторная награда не начисляется.'}
                    </p>
                    <p className="mt-4 text-sm">
                      Учебные ответы: {run.correct} из {run.answered}. Это
                      результат заданий этой попытки, а не оценка CEFR.
                    </p>
                    <Button
                      disabled={busy}
                      className="mt-4 w-full"
                      onClick={() =>
                        void perform({ action: 'start', slug: run.slug })
                      }
                    >
                      Перепройти историю
                    </Button>
                  </Card>
                ) : (
                  <Card>
                    <p>
                      Эта попытка завершена при новом старте. Её текст сохранён.
                    </p>
                    <Button
                      disabled={busy}
                      className="mt-3"
                      onClick={() =>
                        void perform({ action: 'start', slug: run.slug })
                      }
                    >
                      Начать заново
                    </Button>
                  </Card>
                )}
              </>
            )
          )}
        </>
      ) : (
        catalog && (
          <>
            <div className="border-primary/25 rounded-3xl border bg-gradient-to-br from-violet-500/15 to-cyan-400/5 p-5">
              <Sparkles className="text-primary mb-3" aria-hidden="true" />
              <h2 className="font-bold">Не просто текст — твой маршрут</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Читай диалоги, открывай подсказки и выбирай реплики. Ошибки
                объясняются по ходу истории. Первая история бесплатна, полный
                каталог — с Premium.
              </p>
            </div>
            <section aria-label="Каталог историй" className="space-y-4">
              {catalog.stories.map((s) => (
                <Card key={s.slug} className="relative overflow-hidden">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-primary rounded-full border px-3 py-1 font-bold">
                      {s.level}
                    </span>
                    <span className="text-muted-foreground">
                      ≈ {s.minutes} мин
                    </span>
                    <span className="ml-auto rounded-full bg-white/5 px-3 py-1">
                      {s.free ? 'Бесплатно' : 'Premium'}
                    </span>
                  </div>
                  <h2 className="text-lg font-extrabold">{s.title}</h2>
                  <p lang="en" className="text-primary mt-1 text-xs">
                    {s.subtitle}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {s.description}
                  </p>
                  <p className="text-muted-foreground mt-3 text-xs">
                    {s.nodes} сюжетных узлов · {s.endings} концовки · открыто{' '}
                    {s.completed}
                  </p>
                  {s.accessible ? (
                    <Button
                      disabled={busy}
                      className="mt-4 w-full"
                      onClick={() =>
                        s.activeId
                          ? void resume(s.activeId)
                          : void perform({ action: 'start', slug: s.slug })
                      }
                    >
                      {s.activeId
                        ? 'Продолжить историю'
                        : s.completed
                          ? 'Перепройти историю'
                          : 'Читать историю'}
                    </Button>
                  ) : (
                    <Link
                      href="/premium"
                      className="text-primary mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-bold"
                    >
                      <LockKeyhole size={16} aria-hidden="true" />
                      Открыть с Premium
                    </Link>
                  )}
                </Card>
              ))}
            </section>
            {catalog.stories.length === 0 && (
              <Card>
                <p>Новые истории готовятся. Загляни позже.</p>
              </Card>
            )}
            <Card>
              <h2 className="flex items-center gap-2 font-bold">
                <Trophy
                  size={18}
                  className="text-amber-300"
                  aria-hidden="true"
                />
                Мои концовки
              </h2>
              {catalog.endings.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  Заверши первую историю — здесь появятся концовка и памятный
                  значок.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {catalog.endings.map((e) => (
                    <li
                      key={e.slug + e.ending}
                      className="border-border border-t pt-3"
                    >
                      <p className="text-muted-foreground text-xs">
                        {e.storyTitle}
                      </p>
                      <p className="mt-1 font-bold">{e.title}</p>
                      <p className="text-primary mt-1 text-sm">{e.reward}</p>
                      <time
                        dateTime={e.obtainedAt}
                        className="text-muted-foreground mt-1 block text-xs"
                      >
                        {new Date(e.obtainedAt).toLocaleDateString('ru-RU')}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}

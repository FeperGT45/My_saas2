'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import {
  themes,
  defaultAppearance,
  themeVariables,
  type Appearance,
  type AppearanceData,
} from '@/lib/premium/appearance';
const Context = createContext<{
  data: AppearanceData | null;
  refresh: () => void;
}>({ data: null, refresh: () => {} });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { account } = useTelegram();
  const [result, setResult] = useState<{
      owner: string;
      data: AppearanceData;
    } | null>(null),
    [revision, setRevision] = useState(0);
  const data = result?.owner === account?.id ? (result?.data ?? null) : null;
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    void fetchWithTimeout('/api/appearance', {
      cache: 'no-store',
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error('Appearance unavailable');
        const d = await readJson(r);
        if (c.signal.aborted) return;
        setResult({ owner: account.id, data: d });
        const boundary =
          d.premium && d.expiresAt
            ? Date.parse(d.expiresAt) - Date.parse(d.serverTime)
            : 60000;
        timer = setTimeout(
          () => setRevision((n) => n + 1),
          Math.max(500, Math.min(60000, boundary)),
        );
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setResult(null);
          timer = setTimeout(() => setRevision((n) => n + 1), 60000);
        }
      });
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [account?.id, account?.mode, revision]);
  return (
    <Context.Provider
      value={{ data, refresh: () => setRevision((n) => n + 1) }}
    >
      <div
        data-ui-theme={data?.effective.theme ?? 'base'}
        style={
          data
            ? (themeVariables(data.effective.theme) as CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useAppearance() {
  return useContext(Context);
}
export function StyledIdentity({
  settings = defaultAppearance,
  name,
}: {
  settings?: Appearance;
  name: string;
}) {
  return (
    <div
      data-frame={settings.frame}
      data-decoration={settings.decoration}
      style={themeVariables(settings.theme) as CSSProperties}
      className="appearance-identity bg-card flex min-w-0 items-center gap-3 rounded-2xl p-3"
    >
      <span
        className="appearance-avatar border-primary flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 font-bold"
        aria-label="Оформленный аватар"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 font-bold break-words">
        {name}
        {settings.badge !== 'none' && (
          <span
            aria-label={
              settings.badge === 'star' ? 'Значок звезды' : 'Значок листа'
            }
          >
            {' '}
            {settings.badge === 'star' ? '✦' : '❧'}
          </span>
        )}
      </span>
    </div>
  );
}
export function LessonFinishEffect() {
  const { data } = useAppearance();
  if (!data || data.effective.effect === 'none') return null;
  return (
    <div
      aria-hidden="true"
      className={'finish-effect ' + data.effective.effect}
    >
      ✦ · ✧ · ✦
    </div>
  );
}
export function AppearancePanel() {
  const { data, refresh } = useAppearance(),
    { account } = useTelegram();
  const [draft, setDraft] = useState<Appearance | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const preview = draft ?? data?.effective ?? defaultAppearance;
  async function save() {
    if (!data || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetchWithTimeout('/api/appearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: preview, version: data.version }),
      });
      const d = await readJson(r);
      if (!r.ok) throw Error(d.error);
      refresh();
      setDraft(null);
      setNotice('Оформление сохранено.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Три стандартные темы доступны бесплатно. Premium добавляет пять тем,
        рамки, значки и эффекты. Предпросмотр доступен всем.
      </p>
      <Card>
        <h2 className="font-bold">Предпросмотр</h2>
        <div
          className="bg-background mt-3 rounded-2xl p-4"
          style={themeVariables(preview.theme) as CSSProperties}
        >
          <StyledIdentity
            settings={preview}
            name={account?.name ?? 'Твой профиль'}
          />
          <Button className="mt-3 w-full" type="button">
            Пример кнопки
          </Button>
          {preview.effect !== 'none' && (
            <div
              key={preview.effect}
              aria-hidden="true"
              className={'finish-effect ' + preview.effect}
            >
              ✦ · ✧ · ✦
            </div>
          )}
          <p className="text-muted-foreground mt-3 text-sm">
            Так выглядит карточка и основной акцент.
          </p>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Системная настройка уменьшения движения учитывается автоматически.
          Анимации рамок короткие, без бесконечных циклов.
        </p>
      </Card>
      <section aria-label="Темы" className="grid grid-cols-2 gap-3">
        {Object.entries(themes).map(([id, t]) => (
          <button
            type="button"
            key={id}
            aria-pressed={preview.theme === id}
            className="border-border rounded-2xl border p-3 text-left text-sm"
            onClick={() =>
              setDraft({ ...preview, theme: id as Appearance['theme'] })
            }
          >
            <span className="mb-2 flex gap-1" aria-hidden="true">
              {t.colors.map((c) => (
                <span
                  key={c}
                  style={{ background: c }}
                  className="size-7 rounded-full border"
                />
              ))}
            </span>
            <span className="block font-bold">{t.name}</span>
            <span className="text-muted-foreground text-xs">
              {t.premium ? 'Premium' : 'Free'}
            </span>
          </button>
        ))}
      </section>
      {(
        [
          ['frame', 'Рамка', ['plain', 'orbit', 'pulse']],
          ['badge', 'Значок', ['none', 'star', 'leaf']],
          ['effect', 'Завершение урока', ['none', 'spark', 'ripple']],
          ['decoration', 'Украшение карточки', ['none', 'dots', 'grid']],
        ] as const
      ).map(([key, label, values]) => (
        <label key={key} className="block text-sm">
          {label}
          <select
            aria-label={label}
            className="bg-card mt-2 min-h-12 w-full rounded-xl border px-3"
            value={preview[key]}
            onChange={(e) => setDraft({ ...preview, [key]: e.target.value })}
          >
            {values.map((v) => (
              <option key={v} value={v}>
                {
                  (
                    {
                      plain: 'Обычная',
                      orbit: 'Орбита',
                      pulse: 'Свечение',
                      none: 'Без украшения',
                      star: 'Звезда',
                      leaf: 'Лист',
                      spark: 'Искры',
                      ripple: 'Волна',
                      dots: 'Созвездия',
                      grid: 'Линии',
                    } as Record<string, string>
                  )[v]
                }
              </option>
            ))}
          </select>
        </label>
      ))}
      {data ? (
        <Button disabled={busy} className="w-full" onClick={() => void save()}>
          Сохранить оформление
        </Button>
      ) : (
        <Link
          href="/profile"
          className="text-primary inline-flex min-h-11 items-center"
        >
          Вход и профиль →
        </Link>
      )}
      {!data?.premium && (
        <Link
          href="/premium"
          className="text-primary flex min-h-11 items-center"
        >
          Дополнительные варианты Premium →
        </Link>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

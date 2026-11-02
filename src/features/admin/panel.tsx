'use client';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Users,
  Activity,
  CreditCard,
  History,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Card, EmptyState } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { ContentEditor } from './content-editor';
import { kindLabels } from './exercise-fields';
import type { AdminData, AdminRow, AdminView, Entity } from './types';
const tabs = [
  { view: 'overview', label: 'Обзор', icon: BarChart3 },
  { view: 'courses', label: 'Контент', icon: BookOpen },
  { view: 'users', label: 'Ученики', icon: Users },
  { view: 'activity', label: 'Активность', icon: Activity },
  { view: 'subscriptions', label: 'Подписки', icon: CreditCard },
  { view: 'audit', label: 'Журнал', icon: History },
] as const;
const entities: Partial<Record<AdminView, Entity>> = {
  courses: 'course',
  units: 'unit',
  lessons: 'lesson',
  exercises: 'exercise',
};
const child: Partial<Record<AdminView, AdminView>> = {
  courses: 'units',
  units: 'lessons',
  lessons: 'exercises',
};
const childLabel: Partial<Record<AdminView, string>> = {
  courses: 'Разделы',
  units: 'Уроки',
  lessons: 'Задания',
};
const stateNames: Record<string, string> = {
  started: 'Начат',
  completed: 'Завершён',
  abandoned: 'Оставлен',
  active: 'Активна',
  expired: 'Истекла',
  cancelled: 'Отменена',
  refunded: 'Возвращён',
  refund_pending: 'Возврат ожидается',
  paid: 'Оплачен',
};
const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ru-RU') : '—';
export function AdminPanel({ owner }: { owner: string }) {
  const { account } = useTelegram();
  const [path, setPath] = useState<
    { view: AdminView; parent?: string; label: string }[]
  >([{ view: 'overview', label: 'Обзор' }]);
  const current = path[path.length - 1],
    entity = entities[current.view];
  const [offset, setOffset] = useState(0),
    [search, setSearch] = useState(''),
    [draftSearch, setDraftSearch] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{
      key: string;
      owner: string;
      data: AdminData;
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<AdminRow[]>([]),
    [editing, setEditing] = useState<{ row?: AdminRow } | null>(null),
    [notice, setNotice] = useState('');
  const query = new URLSearchParams({
    view: current.view,
    offset: String(offset),
    search,
    ...(current.parent ? { parent: current.parent } : {}),
  }).toString();
  const requestKey = `${query}:${refresh}`;
  const data =
    loaded?.key === requestKey && loaded.owner === account?.id
      ? loaded.data
      : null;
  useEffect(() => {
    if (!account || account.id !== owner || account.mode !== 'telegram') return;
    const abort = new AbortController();
    void fetch(`/api/admin?${query}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setLoaded({ key: requestKey, owner: account.id, data: result });
        setError(null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [query, requestKey, account, owner]);
  useEffect(() => {
    if (!account || account.id !== owner || current.view !== 'courses') return;
    const abort = new AbortController();
    void fetch('/api/admin?view=languages', {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setLanguages(data.items);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [account, current.view, owner]);
  function reset(view: AdminView, label: string) {
    setPath([{ view, label }]);
    setOffset(0);
    setSearch('');
    setDraftSearch('');
    setEditing(null);
    setNotice('');
    setError(null);
  }
  if (!account || account.id !== owner || account.mode !== 'telegram')
    return (
      <Card>
        <p role="status">Проверяем Telegram-сессию…</p>
      </Card>
    );
  return (
    <div className="space-y-5">
      <nav
        aria-label="Разделы администратора"
        className="grid grid-cols-3 gap-2"
      >
        {tabs.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            onClick={() => reset(view, label)}
            aria-current={path[0].view === view ? 'page' : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-xs ${path[0].view === view ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'}`}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {path.map((item, i) => (
          <button
            key={i}
            className="text-primary border-border min-h-11 max-w-full rounded-xl border px-3 py-2 text-left break-words"
            onClick={() => {
              setPath((old) => old.slice(0, i + 1));
              setOffset(0);
              setEditing(null);
              setError(null);
            }}
          >
            {i > 0 ? '› ' : ''}
            {item.label}
          </button>
        ))}
      </div>
      {notice && (
        <p
          role="status"
          className="rounded-2xl bg-teal-300/10 p-3 text-sm text-teal-200"
        >
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {entity && (
          <Button
            disabled={current.view === 'courses' && !languages.length}
            onClick={() => {
              setEditing({});
              setNotice('');
            }}
          >
            <Plus size={17} />
            Создать{' '}
            {
              {
                course: 'курс',
                unit: 'раздел',
                lesson: 'урок',
                exercise: 'задание',
              }[entity]
            }
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setRefresh((v) => v + 1);
            setError(null);
          }}
        >
          <RefreshCw size={16} />
          Обновить список
        </Button>
      </div>
      {['users', 'courses', 'activity', 'subscriptions'].includes(
        current.view,
      ) && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(draftSearch);
            setOffset(0);
            setEditing(null);
            setError(null);
          }}
        >
          <input
            aria-label="Поиск в панели"
            placeholder={
              current.view === 'courses' ? 'Название курса' : 'Имя ученика'
            }
            className="bg-card border-border min-w-0 flex-1 rounded-xl border p-3 text-sm"
            value={draftSearch}
            maxLength={80}
            onChange={(e) => setDraftSearch(e.target.value)}
          />
          <Button variant="outline" type="submit" size="sm">
            Найти
          </Button>
        </form>
      )}
      {editing && entity && (
        <ContentEditor
          key={`${entity}:${editing.row?.id ?? 'new'}:${editing.row?.admin_version ?? 0}`}
          entity={entity}
          row={editing.row}
          parent={current.parent}
          languages={languages}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice('Изменения сохранены. Действие записано в журнал.');
            setRefresh((n) => n + 1);
          }}
        />
      )}
      {error ? (
        <Card>
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        </Card>
      ) : !data ? (
        <Card>
          <p role="status">Загружаем данные…</p>
        </Card>
      ) : (
        <>
          {data.summary && (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries({
                'Всего учеников': data.summary.users,
                'Активны за 7 дней': data.summary.activeUsers7d,
                'Начато за 7 дней': data.summary.started7d,
                'Завершено за 7 дней': data.summary.completed7d,
                'Завершение новых попыток': `${data.summary.completionRate}%`,
                'Средний результат': `${data.summary.averageScore7d}%`,
                Курсов: data.summary.courses,
                'Опубликовано уроков': data.summary.publishedLessons,
              }).map(([label, value]) => (
                <Card key={label} className="min-w-0 p-4">
                  <p className="text-primary text-2xl font-extrabold">
                    {value}
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs">{label}</p>
                </Card>
              ))}
            </div>
          )}
          {current.view !== 'overview' &&
            (data.items.length ? (
              <div className="space-y-3">
                {data.items.map((row) => (
                  <Card key={row.id} className="min-w-0 p-4 break-words">
                    <h2 className="font-bold">
                      {row.title ??
                        row.display_name ??
                        row.prompt ??
                        row.actor_name ??
                        'Удалённый администратор'}
                    </h2>
                    <div className="text-muted-foreground my-3 space-y-1 text-xs leading-relaxed">
                      {entity && (
                        <p>
                          {row.admin_version
                            ? `Версия ${row.admin_version} · `
                            : ''}
                          {row.position ? `Позиция ${row.position} · ` : ''}
                          {typeof row.published === 'boolean'
                            ? row.published
                              ? 'Опубликовано'
                              : 'Черновик'
                            : ''}
                          {row.access_tier
                            ? ` · ${row.access_tier === 'premium' ? 'Premium' : 'Free'}`
                            : ''}
                          {row.kind ? kindLabels[row.kind] : ''}
                          {row.premium_only ? ' · Premium' : ''}
                        </p>
                      )}
                      {current.view === 'users' && (
                        <>
                          <p>
                            {row.xp} XP · Завершений: {row.completions}
                          </p>
                          <p>Регистрация: {date(row.created_at)}</p>
                          <p>Последнее занятие: {date(row.last_active_at)}</p>
                          <p className="break-all">UUID: {row.id}</p>
                        </>
                      )}
                      {current.view === 'lessons' && (
                        <p>
                          Попыток: {row.attempts} · Завершено: {row.completions}{' '}
                          · Средний результат: {row.average_score ?? '—'}%
                        </p>
                      )}
                      {current.view === 'activity' && (
                        <>
                          <p>{row.lesson_title}</p>
                          <p>
                            {stateNames[row.status ?? ''] ?? row.status} ·
                            Результат: {row.score ?? '—'}
                          </p>
                          <p>Начало: {date(row.started_at)}</p>
                          <p>Завершение: {date(row.completed_at)}</p>
                        </>
                      )}
                      {current.view === 'subscriptions' && (
                        <>
                          <p>
                            {row.plan} ·{' '}
                            {stateNames[row.status ?? ''] ?? row.status}
                          </p>
                          <p>
                            С {date(row.starts_at)} по {date(row.ends_at)}
                          </p>
                          <p>
                            Платёж:{' '}
                            {stateNames[row.payment_state ?? ''] ??
                              row.payment_state ??
                              'Нет подтверждённого Stars-заказа'}
                          </p>
                        </>
                      )}
                      {current.view === 'audit' && (
                        <>
                          <p>
                            {row.action === 'created' ? 'Создано' : 'Изменено'}:{' '}
                            {row.entity} · Версия {row.version}
                          </p>
                          <p className="break-all">{row.entity_id}</p>
                          <p>{date(row.created_at)}</p>
                        </>
                      )}
                    </div>
                    {entity && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditing({ row });
                            setNotice('');
                          }}
                        >
                          Редактировать
                        </Button>
                        {child[current.view] && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setPath((old) => [
                                ...old,
                                {
                                  view: child[current.view]!,
                                  parent: row.id,
                                  label: row.title ?? 'Раздел',
                                },
                              ]);
                              setOffset(0);
                              setSearch('');
                              setDraftSearch('');
                              setEditing(null);
                              setError(null);
                            }}
                          >
                            {childLabel[current.view]}
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen />}
                title="Пока нет записей"
                text="Измени поиск или создай первый материал в выбранном разделе."
              />
            ))}
          {current.view !== 'overview' && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => {
                  setOffset((v) => Math.max(0, v - 25));
                  setEditing(null);
                }}
              >
                Назад
              </Button>
              <span>
                Всего: {data.total} · Страница {Math.floor(offset / 25) + 1}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + 25 >= data.total}
                onClick={() => {
                  setOffset((v) => v + 25);
                  setEditing(null);
                }}
              >
                Далее
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Copy,
  Share2,
  Trophy,
  ShieldCheck,
  Users,
  ChevronRight,
  Coins,
} from 'lucide-react';
import { useTelegram } from '@/features/telegram/provider';
import { Card, EmptyState } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import type { SocialSummary } from './types';
export function SocialPanel({ friends = false }: { friends?: boolean }) {
  const { account, status } = useTelegram();
  const [scope, setScope] = useState<'weekly' | 'global'>('weekly');
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<{
    owner: string;
    data: SocialSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [alias, setAlias] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    let active = true;
    void fetch(`/api/social?scope=${scope}&offset=${offset}`, {
      cache: 'no-store',
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) {
          setLoaded({ owner: account.id, data });
          setAlias(data.privacy.alias);
          setVisible(data.privacy.visible);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message ?? 'Ошибка загрузки.');
      });
    return () => {
      active = false;
    };
  }, [account, scope, offset, retry]);
  const data =
    loaded?.owner === account?.id &&
    loaded?.data.scope === scope &&
    loaded?.data.offset === offset
      ? loaded.data
      : null;
  if (status === 'loading') return <p role="status">Проверяем аккаунт…</p>;
  if (!account || account.mode !== 'telegram')
    return (
      <Card>
        <p className="text-muted-foreground text-sm">
          Войди через Telegram, чтобы увидеть рейтинг и приглашать друзей.
          Приватные профили не публикуются.
        </p>
        <Link
          href="/friends"
          className="text-primary mt-3 flex min-h-11 items-center text-sm"
        >
          Друзья и приглашения
          <ChevronRight size={16} />
        </Link>
      </Card>
    );
  if (!data)
    return (
      <Card>
        {error ? (
          <>
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => setRetry((n) => n + 1)}
            >
              Повторить загрузку
            </Button>
          </>
        ) : (
          <p
            role="status"
            className="text-muted-foreground animate-pulse text-sm"
          >
            Загружаем сообщество…
          </p>
        )}
      </Card>
    );
  const invite = (
    <>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Users size={22} className="text-primary" />
          Учиться вместе интереснее
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Пригласи нового пользователя. Когда он впервые зачтёт урок с
          результатом от 60%, ты получишь {data.invitations.rewardCoins} монет.
          До {data.invitations.rewardLimit} наград за всё время.
        </p>
        <label className="text-muted-foreground mt-4 block text-xs">
          Твоя Telegram-ссылка
          <input
            readOnly
            value={data.invitations.url}
            onFocus={(e) => e.target.select()}
            className="border-border bg-background mt-2 min-h-12 w-full rounded-xl border px-3 text-xs"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.invitations.url);
                setNotice('Ссылка скопирована.');
              } catch {
                setNotice(
                  'Не удалось скопировать. Выдели ссылку и скопируй вручную.',
                );
              }
            }}
          >
            <Copy size={16} />
            Копировать
          </Button>
          <Button asChild>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(data.invitations.url)}&text=${encodeURIComponent('Присоединяйся к Voklumi — учим английский вместе!')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Share2 size={16} />
              Пригласить
            </a>
          </Button>
        </div>
        <p role="status" className="mt-3 text-xs text-teal-200">
          {notice}
        </p>
      </Card>
      <div className="my-4 grid grid-cols-2 gap-3">
        {[
          { title: 'Присоединились', value: data.invitations.invited },
          { title: 'Зачли первый урок', value: data.invitations.qualified },
          { title: 'Бонусов выдано', value: data.invitations.rewarded },
          { title: 'Монет за приглашения', value: data.invitations.coins },
        ].map((item) => (
          <Card key={item.title} className="!p-4">
            <p className="text-primary text-xl font-extrabold">{item.value}</p>
            <p className="text-muted-foreground mt-2 text-xs">{item.title}</p>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Присоединения по ссылке не равны отправленным сообщениям. Повторное
        приглашение и собственный аккаунт не дают бонус. Имена и контакты
        приглашённых здесь не раскрываются.
      </p>
    </>
  );
  if (friends) return invite;
  return (
    <>
      <div
        role="group"
        aria-label="Вид рейтинга"
        className="bg-muted mb-5 grid grid-cols-2 gap-1 rounded-2xl p-1"
      >
        {[
          { id: 'weekly' as const, label: 'За неделю' },
          { id: 'global' as const, label: 'За всё время' },
        ].map((tab) => (
          <button
            key={tab.id}
            aria-pressed={scope === tab.id}
            onClick={() => {
              setScope(tab.id);
              setOffset(0);
            }}
            className={`min-h-12 rounded-xl text-sm font-bold ${scope === tab.id ? 'bg-card text-primary' : 'text-muted-foreground'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Card className="border-primary/25 mb-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Trophy size={19} className="text-primary" />
          Твоя позиция: {data.myPosition ? `#${data.myPosition}` : '—'}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          {data.myXp} XP ·{' '}
          {data.privacy.visible
            ? 'Среди открытых профилей'
            : 'Профиль скрыт из рейтинга'}
        </p>
        <p className="text-muted-foreground mt-2 text-[10px]">
          {scope === 'weekly'
            ? 'Неделя: понедельник 00:00 — понедельник 00:00 UTC.'
            : 'Все серверные XP за всё время.'}{' '}
          Одинаковые XP — одинаковое место.
        </p>
      </Card>
      {data.entries.length ? (
        <div className="space-y-2">
          {data.entries.map((entry, i) => (
            <div
              key={`${entry.rank}:${i}`}
              className={`flex items-center gap-3 rounded-2xl border p-4 ${entry.isMe ? 'border-primary/50 bg-primary/10' : 'border-border bg-card'}`}
            >
              <span className="text-primary min-w-7 text-sm font-bold">
                {entry.rank}
              </span>
              <span className="min-w-0 flex-1 text-sm font-bold break-words">
                {entry.alias}
                {entry.isMe && (
                  <span className="text-primary ml-2 text-[10px]">ты</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-teal-200">
                {entry.xp} XP
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Trophy />}
          title="Здесь начнётся соревнование"
          text="Пока нет открытых профилей с XP за выбранный период."
        />
      )}
      <div className="my-4 flex justify-between gap-3">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 20))}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          disabled={offset + 20 >= data.total || offset >= 10000}
          onClick={() => setOffset((n) => n + 20)}
        >
          Дальше
        </Button>
      </div>
      <Card>
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck size={18} className="text-teal-300" />
          Приватность рейтинга
        </h2>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          По умолчанию профиль скрыт. При участии видны только выбранный
          псевдоним, XP и место. Не указывай контакты. Имя, аватар и ID Telegram
          не публикуются.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setNotice('');
            setError(null);
            try {
              const r = await fetch('/api/social/privacy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visible, alias }),
              });
              const result = await r.json();
              if (!r.ok) throw new Error(result.error);
              setNotice('Настройки приватности сохранены.');
              setRetry((n) => n + 1);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Ошибка сохранения.');
            } finally {
              setPending(false);
            }
          }}
        >
          <label className="block text-xs">
            Публичный псевдоним
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              minLength={2}
              maxLength={32}
              required
              className="border-border bg-background mt-2 min-h-12 w-full rounded-xl border px-3 text-sm"
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 text-xs">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
              className="size-5 accent-purple-400"
            />
            Участвовать в публичном рейтинге
          </label>
          <Button className="w-full" disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить приватность'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-xs text-rose-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-xs text-teal-200">
            {notice}
          </p>
        )}
      </Card>
      <Link
        href="/friends"
        className="border-border bg-card mt-5 flex min-h-14 items-center justify-between rounded-2xl border p-4 text-sm font-bold"
      >
        <span className="flex items-center gap-2">
          <Coins size={19} className="text-amber-200" />
          Друзья и приглашения
        </span>
        <ChevronRight size={18} />
      </Link>
    </>
  );
}

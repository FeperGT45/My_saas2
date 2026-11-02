'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Crown, ShieldCheck, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
type Status = {
  premium: boolean;
  expiresAt: string | null;
  autoRenew: false;
  status?: string;
  enabled: boolean;
  amount: number | null;
  termsUrl: string | null;
  supportUrl: string | null;
};
type Features = {
  accuracy: number;
  completedAttempts: number;
  reviewPlan: {
    lessonId: string;
    title: string;
    score: number;
    reviewAfter: string;
  }[];
};
export function PremiumPanel() {
  const { account } = useTelegram();
  const [loaded, setLoaded] = useState<{
    owner: string;
    status: Status;
  } | null>(null);
  const [featureState, setFeatures] = useState<{
    owner: string;
    data: Features;
  } | null>(null);
  const features =
    featureState && featureState.owner === account?.id
      ? featureState.data
      : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<string | null>(null);
  const status = loaded && loaded.owner === account?.id ? loaded.status : null;
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    let active = true;
    void fetch('/api/premium', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) {
          setLoaded({ owner: account.id, status: data });
          setError(null);
        }
        if (data.premium) {
          const response = await fetch('/api/premium/features', {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('Не удалось загрузить статистику.');
          const detail = await response.json();
          if (active) setFeatures({ owner: account.id, data: detail });
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [account, refresh]);
  async function buy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      request.current ??= crypto.randomUUID();
      const sdk = await import('@tma.js/sdk-react');
      if (!sdk.invoice.openUrl.isAvailable())
        throw new Error('Открой Premium в мобильном Telegram.');
      const response = await fetch('/api/premium/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.current,
          acceptTerms: agreed,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) request.current = null;
        throw new Error(data.error);
      }
      await sdk.invoice.openUrl(data.invoiceUrl);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Оплата недоступна.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card className="starfield border-primary/30 text-center">
        <Crown className="mx-auto text-amber-200" size={42} />
        <h2 className="mt-4 text-2xl font-extrabold">
          Больше пространства для роста
        </h2>
        <p className="text-muted-foreground mt-3 text-sm">
          Premium на 30 дней · без автопродления
        </p>
        <p
          role="status"
          aria-label="Статус Premium"
          className="mt-4 font-bold text-teal-200"
        >
          {status?.status === 'refund_pending'
            ? 'Возврат обрабатывается'
            : status?.status === 'refunded'
              ? 'Платёж возвращён · Free'
              : status?.premium
                ? 'Premium активен'
                : status?.expiresAt
                  ? 'Период завершён · Free'
                  : status
                    ? 'Текущий доступ: Free'
                    : account
                      ? 'Статус не подтверждён'
                      : 'Free · войди для проверки'}
        </p>
        {status?.expiresAt && (
          <p className="text-muted-foreground mt-2 text-xs">
            Срок: {new Date(status.expiresAt).toLocaleString('ru-RU')}
          </p>
        )}
      </Card>
      <div className="my-5 space-y-4">
        {[
          {
            title: 'Free',
            items: [
              'Базовые курсы',
              'XP и рейтинги',
              'Сохранение прогресса',
              'Открытые тематические уроки',
            ],
          },
          {
            title: 'Premium',
            items: [
              'Все опубликованные курсы',
              'Расширенная статистика',
              'Дополнительные задания при наличии материалов',
              'Персональный план повторения',
            ],
          },
        ].map((plan) => (
          <Card
            key={plan.title}
            className={plan.title === 'Premium' ? 'border-primary/40' : ''}
          >
            <h2 className="mb-4 text-xl font-bold">{plan.title}</h2>
            <ul className="space-y-3">
              {plan.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check size={17} className="mt-0.5 shrink-0 text-teal-200" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {!account && (
        <p className="text-muted-foreground my-4 text-sm">
          Войди через Telegram, чтобы проверить свой статус.
        </p>
      )}
      {account && !status && !error && (
        <p role="status" className="text-muted-foreground my-4 text-sm">
          Проверяем подписку…
        </p>
      )}
      {!status?.enabled && (
        <p className="bg-muted text-muted-foreground mb-4 rounded-2xl p-4 text-sm">
          Покупки пока выключены. Цена и условия будут доступны после проверки
          владельцем.
        </p>
      )}
      {status?.enabled && !status.premium && (
        <>
          <p className="mb-3 text-center text-lg font-bold text-amber-200">
            {status.amount} ⭐ за 30 дней
          </p>
          <label className="mb-4 flex items-start gap-3 text-xs leading-relaxed">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-purple-400"
            />
            Я прочитал и принимаю условия покупки. Доступ не продлевается
            автоматически.
          </label>
        </>
      )}
      <Button
        disabled={!status?.enabled || status.premium || !agreed || busy}
        className="w-full"
        onClick={buy}
      >
        {busy
          ? 'Открываем Telegram…'
          : status?.premium
            ? 'Premium активен'
            : 'Открыть оплату Telegram Stars'}
      </Button>
      <Button
        variant="outline"
        className="mt-3 w-full"
        onClick={() => setRefresh((n) => n + 1)}
      >
        <RefreshCw size={16} />
        Проверить статус
      </Button>
      <p className="text-muted-foreground mt-4 flex items-start gap-2 text-[11px] leading-relaxed">
        <ShieldCheck size={17} className="shrink-0" />
        Доступ появляется только после подтверждения сервером. Закрытие
        платёжного окна само по себе не активирует Premium.
      </p>
      <div className="text-primary my-4 flex flex-wrap gap-4 text-xs">
        {status?.termsUrl && (
          <a
            href={status.termsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 py-3"
          >
            Условия покупки
          </a>
        )}
        {status?.supportUrl && (
          <a
            href={status.supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 py-3"
          >
            Поддержка и возвраты
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="my-4 text-sm text-rose-300">
          {error}
        </p>
      )}
      {status?.premium && features && (
        <Card className="mt-5">
          <h2 className="text-lg font-bold">Твой учебный ритм</h2>
          <p className="text-muted-foreground my-3 text-sm">
            Точность: {features.accuracy}% · Завершено попыток:{' '}
            {features.completedAttempts}
          </p>
          <h3 className="font-bold">План повторения</h3>
          {features.reviewPlan.length ? (
            features.reviewPlan.map((item) => (
              <Link
                key={item.lessonId}
                href={`/lesson?lesson=${item.lessonId}`}
                className="border-border mt-3 block rounded-xl border p-3 text-sm"
              >
                <span className="font-semibold">{item.title}</span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  Лучший результат {item.score}% · Повторить после{' '}
                  {new Date(item.reviewAfter).toLocaleDateString('ru-RU')}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-muted-foreground mt-3 text-xs">
              Пройди урок, чтобы получить план повторения.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

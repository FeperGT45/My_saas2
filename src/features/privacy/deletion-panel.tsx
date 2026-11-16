'use client';
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '@/features/telegram/provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/game';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
type Ticket = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  createdAt: string;
};
const labels = {
  pending: 'Ожидает обработки',
  processing: 'В обработке',
  completed: 'Обработана владельцем',
  cancelled: 'Отменена',
};
export function DeletionPanel() {
  const { account } = useTelegram();
  return <DeletionForm key={account?.id ?? 'anonymous'} />;
}
function DeletionForm() {
  const { account } = useTelegram();
  const [ticket, setTicket] = useState<Ticket | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestId = useRef<string | null>(null),
    locked = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    if (account?.mode === 'telegram')
      void fetchWithTimeout('/api/privacy/deletion', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (r) => {
          const data = await readJson(r);
          if (!r.ok) throw Error(data.error);
          if (!controller.signal.aborted) setTicket(data.request);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError(
              'Не удалось загрузить заявку. Повтори открытие страницы или напиши в поддержку.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [account?.mode]);
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <p>
          Войди через Telegram, чтобы отправить подтверждённый запрос. Если вход
          недоступен, напиши @feper145 из своего аккаунта Telegram.
        </p>
      </Card>
    );
  async function submit() {
    if (locked.current || !confirmed) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      requestId.current ??= crypto.randomUUID();
      const r = await fetchWithTimeout('/api/privacy/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, confirm: true }),
      });
      const data = await readJson(r);
      if (!r.ok) throw Error(data.error);
      if (mounted.current) setTicket(data.request);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : 'Не удалось отправить заявку.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold">Запросить удаление аккаунта</h2>
      <p className="text-sm">
        Заявка передаётся владельцу для проверки и обработки. Сейчас данные не
        удаляются автоматически. Запрос не отменяет покупку и не оформляет
        возврат Stars.
      </p>
      {loading ? (
        <p role="status">Проверяем заявки…</p>
      ) : ticket && ['pending', 'processing'].includes(ticket.status) ? (
        <div role="status">
          <p className="font-bold text-teal-200">
            Заявка принята · {labels[ticket.status]}
          </p>
          <p className="mt-2 text-xs break-all">Номер: {ticket.id}</p>
          <p className="mt-2 text-xs">
            Дата: {new Date(ticket.createdAt).toLocaleDateString('ru-RU')}
          </p>
        </div>
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Я хочу запросить удаление своего профиля и учебных данных. Понимаю,
            что после фактического удаления прогресс восстановить нельзя.
          </label>
          <Button
            className="w-full"
            disabled={!confirmed || busy}
            onClick={submit}
          >
            {busy ? 'Отправляем…' : 'Отправить запрос на удаление'}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </Card>
  );
}

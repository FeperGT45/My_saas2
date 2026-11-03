'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import {
  isSubscriptionAccess,
  type PremiumFeature,
  type PremiumStatus,
} from '@/lib/premium/permissions';

/** Display helper only. Every paid API independently verifies current database permissions. */
export function usePremium() {
  const { account } = useTelegram();
  const id = account?.mode === 'telegram' ? account.id : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    owner: string;
    data: PremiumStatus | null;
    error: string | null;
    receivedAt: number;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchWithTimeout('/api/premium', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await readJson(r);
        if (!r.ok) throw Error(data.error ?? 'Не удалось проверить Premium.');
        if (!isSubscriptionAccess(data))
          throw Error('Не удалось подтвердить права Premium.');
        if (controller.signal.aborted) return;
        setResult({
          owner: id,
          data: data as PremiumStatus,
          error: null,
          receivedAt: performance.now(),
        });
        const boundary = data.premium
          ? data.expiresAt
          : data.status === 'scheduled'
            ? data.startsAt
            : null;
        const delay = boundary
          ? Math.max(
              1000,
              Math.min(
                60000,
                Date.parse(boundary) - Date.parse(data.serverTime),
              ),
            )
          : 60000;
        timer = setTimeout(() => setRevision((v) => v + 1), delay);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setResult({
            owner: id,
            data: null,
            error:
              e instanceof Error ? e.message : 'Не удалось проверить Premium.',
            receivedAt: performance.now(),
          });
      });
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, revision]);
  const current = result?.owner === id ? result : null;
  const data = current?.data ?? null;
  return {
    status: data,
    loading: !!id && !current,
    error: current?.error ?? null,
    refresh: () => setRevision((v) => v + 1),
    can: (feature: PremiumFeature) => {
      if (!data || !current || data.features[feature] !== true) return false;
      // Never continue showing paid controls after the last confirmed window, even if refresh fails.
      return (
        !data.premium ||
        (data.expiresAt !== null &&
          Date.parse(data.expiresAt) >
            Date.parse(data.serverTime) +
              performance.now() -
              current.receivedAt)
      );
    },
  };
}

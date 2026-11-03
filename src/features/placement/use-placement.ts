'use client';
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import type { PlacementStatus, PlacementResponse } from '@/lib/placement/types';
import type { PlacementCommand } from '@/lib/placement/validation';
export function usePlacement() {
  const { account, status: telegramStatus, authError } = useTelegram();
  const [loaded, setLoaded] = useState<{
    owner: string;
    data: PlacementStatus;
  } | null>(null);
  const [failure, setFailure] = useState<{
    owner: string;
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const controller = new AbortController();
    void fetchWithTimeout('/api/placement', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await readJson(r);
        if (!r.ok) throw new Error(data.error ?? 'Не удалось загрузить тест.');
        if (!controller.signal.aborted) {
          setLoaded({ owner: account.id, data });
          setFailure(null);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setFailure({
            owner: account.id,
            message:
              e instanceof Error ? e.message : 'Тест временно недоступен.',
          });
      });
    return () => controller.abort();
  }, [account, revision]);
  async function mutate(
    command: PlacementCommand,
  ): Promise<PlacementResponse | null> {
    if (account?.mode !== 'telegram' || locked.current) return null;
    locked.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const r = await fetchWithTimeout('/api/placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const result = (await readJson(r)) as PlacementResponse & {
        error?: string;
      };
      if (!r.ok) throw new Error(result.error ?? 'Не удалось сохранить ответ.');
      setLoaded({ owner: account.id, data: result.status });
      return result;
    } catch (e) {
      setFailure({
        owner: account.id,
        message: e instanceof Error ? e.message : 'Не удалось сохранить ответ.',
      });
      return null;
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  function refresh() {
    setLoaded(null);
    setFailure(null);
    setRevision((n) => n + 1);
  }
  return {
    account,
    telegramStatus,
    authError,
    data: loaded && loaded.owner === account?.id ? loaded.data : null,
    error: failure && failure.owner === account?.id ? failure.message : null,
    busy,
    mutate,
    refresh,
  };
}

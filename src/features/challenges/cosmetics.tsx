'use client';
import { useEffect, useState } from 'react';
import { BookOpen, Sparkles, Zap, Trophy, Leaf, Target } from 'lucide-react';
import { Card } from '@/components/ui/game';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import type { Cosmetic, Showcase } from '@/lib/learning/challenges';
export const tones = {
  violet: 'border-violet-400 text-violet-200 bg-violet-400/10',
  cyan: 'border-cyan-300 text-cyan-200 bg-cyan-300/10',
  amber: 'border-amber-300 text-amber-200 bg-amber-300/10',
  rose: 'border-rose-300 text-rose-200 bg-rose-300/10',
  emerald: 'border-emerald-300 text-emerald-200 bg-emerald-300/10',
  indigo: 'border-indigo-300 text-indigo-200 bg-indigo-300/10',
};
const symbols = {
  book: BookOpen,
  spark: Sparkles,
  bolt: Zap,
  trophy: Trophy,
  leaf: Leaf,
  target: Target,
};
export function CosmeticIcon({ asset }: { asset: Cosmetic }) {
  const Icon = symbols[asset.symbol] ?? Sparkles;
  return (
    <span
      className={
        'inline-flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 ' +
        tones[asset.tone]
      }
    >
      <Icon aria-hidden="true" size={26} />
    </span>
  );
}
export function StylePreview({
  assets,
  name,
}: {
  assets: Cosmetic[];
  name: string;
}) {
  const frame = assets.find((a) => a.slot === 'frame'),
    accent = assets.find((a) => a.slot === 'accent'),
    badge = assets.find((a) => a.slot === 'badge');
  return (
    <div
      aria-label="Пример оформления профиля"
      className={
        'flex items-center gap-4 rounded-2xl border p-4 ' +
        (accent ? tones[accent.tone] : 'border-border bg-white/5')
      }
    >
      <span
        className={
          'flex size-16 shrink-0 items-center justify-center rounded-2xl border-4 text-xl font-black ' +
          (frame ? tones[frame.tone] : 'border-border')
        }
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="font-bold break-words">{name}</p>
        {badge && <p className="mt-1 text-sm">{badge.title}</p>}
        <p className="text-muted-foreground mt-1 text-xs">
          {frame?.title ?? 'Без рамки'} · {accent?.title ?? 'Обычный цвет'}
        </p>
      </div>
    </div>
  );
}
export function ChallengeProfileStyle() {
  const { account } = useTelegram();
  const [result, setResult] = useState<{
    owner: string;
    data: Showcase;
  } | null>(null);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const controller = new AbortController();
    void fetchWithTimeout('/api/challenges?view=showcase', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return;
        const d = await readJson(r);
        if (!controller.signal.aborted)
          setResult({ owner: account.id, data: d });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [account?.id, account?.mode]);
  if (!account || result?.owner !== account.id || !result.data.equipped.length)
    return null;
  return (
    <Card className="mb-4">
      <h2 className="mb-3 font-bold">Мой стиль</h2>
      <StylePreview assets={result.data.equipped} name={account.name} />
    </Card>
  );
}

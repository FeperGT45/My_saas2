'use client';
import { useState } from 'react';
import { Card } from '@/components/ui/game';
import { StyledIdentity } from '@/features/personalization/appearance';
import {
  themes,
  themeVariables,
  defaultAppearance,
  type Appearance,
} from '@/lib/premium/appearance';
import { CosmeticIcon } from '@/features/challenges/cosmetics';
import type { CSSProperties } from 'react';
export function PremiumShowcase() {
  const [theme, setTheme] = useState<Appearance['theme']>('midnight');
  return (
    <div className="my-5 space-y-4">
      <h2 className="text-xl font-bold">Premium в действии</h2>
      <Card>
        <p className="text-muted-foreground mb-3 text-sm">
          Предпросмотр оформления — реальный компонент профиля, не статистика
          вымышленного пользователя.
        </p>
        <div
          className="bg-background rounded-2xl p-3"
          style={themeVariables(theme) as CSSProperties}
        >
          <StyledIdentity
            name="Твой профиль"
            settings={{
              ...defaultAppearance,
              theme,
              frame: 'orbit',
              badge: 'star',
              decoration: 'dots',
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['midnight', 'cyber', 'neon', 'sunset', 'sakura'] as const).map(
            (t) => (
              <button
                key={t}
                aria-pressed={theme === t}
                className="border-border min-h-11 rounded-xl border px-3 text-xs"
                onClick={() => setTheme(t)}
              >
                {themes[t].name}
              </button>
            ),
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <CosmeticIcon
            asset={{
              code: 'demo',
              title: 'Рассказчик',
              description: '',
              slot: 'badge',
              tone: 'amber',
              symbol: 'book',
            }}
          />
          <p className="text-sm">
            Пример косметической награды. Её получение проверяет сервер.
          </p>
        </div>
      </Card>
    </div>
  );
}

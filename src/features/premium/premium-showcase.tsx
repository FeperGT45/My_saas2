'use client';
import Link from 'next/link';
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
const features = [
  [
    '/learning-plan',
    'План на 7 дней',
    'Уроки по уровню, цели и доступному времени.',
  ],
  ['/analytics', 'Аналитика', 'Реальные результаты по навыкам и темам.'],
  [
    '/dictionary',
    'Мой словарь',
    'Свои слова, коллекции и интервальные повторения.',
  ],
  [
    '/stories',
    'Интерактивные истории',
    'Пять оригинальных историй с выбором и концовками.',
  ],
  [
    '/weak-training',
    'Слабые темы',
    'Повтор ошибок и новая практика той же темы.',
  ],
  ['/challenges', 'Испытания', 'Добровольные недельные цели и косметика.'],
  ['/appearance', 'Оформление', 'Темы, рамки, значки и лёгкие эффекты.'],
  [
    '/extended-test',
    'Расширенный тест',
    '36 адаптивных вопросов с разбором и историей.',
  ],
] as const;
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
      {features.map(([href, title, description]) => (
        <Card key={href}>
          <h3 className="font-bold">{title}</h3>
          <p className="text-muted-foreground mt-2 text-sm">{description}</p>
          <Link
            href={href}
            className="text-primary mt-2 inline-flex min-h-11 items-center text-sm"
          >
            Посмотреть возможность →
          </Link>
        </Card>
      ))}
    </div>
  );
}

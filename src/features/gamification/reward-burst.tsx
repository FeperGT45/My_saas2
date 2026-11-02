'use client';
import { motion, useReducedMotion } from 'motion/react';
import { Coins, Sparkles, Flame, Trophy } from 'lucide-react';
import { Card } from '@/components/ui/game';
import type { Rewards } from './types';
export function RewardBurst({ rewards }: { rewards?: Rewards }) {
  const reduced = useReducedMotion();
  if (!rewards || rewards.eligible === undefined) return null;
  if (!rewards.eligible)
    return (
      <p className="text-muted-foreground my-4 text-sm">
        Нужно набрать от 60%, чтобы зачесть занятие и получить награды. Попробуй
        ещё раз.
      </p>
    );
  return (
    <motion.div
      role="status"
      aria-label="Награды за урок"
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35 }}
    >
      <Card className="border-primary/40 from-primary/15 my-4 bg-gradient-to-br to-teal-300/5 text-left">
        <p className="eyebrow mb-3 flex items-center gap-2">
          <Sparkles size={16} />
          Твои награды
        </p>
        <div className="flex flex-wrap gap-3 text-sm font-bold">
          <span className="flex items-center gap-1 text-amber-200">
            <Coins size={18} />+{rewards.coins} монет
          </span>
          <span className="flex items-center gap-1 text-orange-300">
            <Flame size={18} />
            {rewards.streak} дн.
          </span>
        </div>
        {rewards.levelAfter > rewards.levelBefore && (
          <p className="mt-3 text-lg font-extrabold text-teal-200">
            Новый уровень: {rewards.levelAfter}!
          </p>
        )}
        {rewards.achievements.map((title) => (
          <p
            key={title}
            className="text-primary mt-3 flex items-center gap-2 text-sm"
          >
            <Trophy size={16} />
            {title}
          </p>
        ))}
        {rewards.daily.map((title) => (
          <p key={title} className="mt-2 text-xs text-teal-200">
            Цель выполнена: {title}
          </p>
        ))}
        {rewards.sections.map((title) => (
          <p key={title} className="mt-2 text-xs text-amber-200">
            Раздел завершён: {title}
          </p>
        ))}
        {rewards.coins === 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            Повторение поддерживает серию, но не дублирует награды.
          </p>
        )}
        <p className="text-muted-foreground mt-3 text-[10px]">
          Награды этой попытки. Повторный просмотр не начисляет их снова.
        </p>
      </Card>
    </motion.div>
  );
}

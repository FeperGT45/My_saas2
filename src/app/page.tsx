import Link from 'next/link';
import {
  ArrowRight,
  Flame,
  Zap,
  Target,
  ChevronRight,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { Mascot } from '@/components/ui/mascot';
import { Card, Progress } from '@/components/ui/game';
import { PlacementHome } from '@/features/placement/placement-panel';
export default function HomePage() {
  return (
    <Reveal>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            Твоя языковая вселенная ✦
          </p>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tight">
            Время нового уровня
          </h1>
        </div>
      </div>
      <PlacementHome />
      <section className="starfield relative overflow-hidden rounded-[28px] border border-purple-400/25 bg-gradient-to-br from-[#393067] via-[#28234e] to-[#1d2944] p-5">
        <p className="eyebrow flex items-center gap-1.5 !text-teal-200">
          <Sparkles size={13} /> Твоя языковая вселенная
        </p>
        <div className="relative z-10 mt-4 w-[68%]">
          <h2 className="text-[22px] leading-tight font-extrabold min-[380px]:text-[24px]">
            Большой мир.
            <br />
            Новые слова.
            <br />
            <span className="text-teal-200">Твой ход.</span>
          </h2>
          <p className="mt-3 max-w-44 text-xs leading-relaxed text-purple-100/70">
            Ри уже готов к полёту.
            <br />
            Продолжим приключение?
          </p>
        </div>
        <Mascot className="absolute top-12 -right-3 w-[48%] -rotate-12" />
        <Button asChild className="relative mt-5 w-full">
          <Link href="/lesson">
            Продолжить урок <ArrowRight size={18} />
          </Link>
        </Button>
        <p className="mt-3 text-center text-[10px] text-purple-100/60">
          Английский · Урок 3 · ~3 минуты
        </p>
      </section>
      <div className="my-4 grid grid-cols-3 gap-2">
        {[
          {
            icon: Flame,
            value: '7 дней',
            label: 'Серия',
            color: 'text-orange-300',
          },
          {
            icon: Zap,
            value: '1 240',
            label: 'Всего XP',
            color: 'text-primary',
          },
          {
            icon: Trophy,
            value: '#4',
            label: 'В лиге',
            color: 'text-teal-300',
          },
        ].map(({ icon: Icon, value, label, color }) => (
          <Card key={label} className="!rounded-2xl !p-3">
            <Icon size={19} className={color} />
            <p className="mt-2 text-base font-extrabold">{value}</p>
            <p className="text-muted-foreground mt-1 text-[10px]">{label}</p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Target size={18} className="text-teal-300" />
            Ежедневная миссия
          </h2>
          <span className="text-xs text-teal-200">20 / 30 XP</span>
        </div>
        <Progress value={67} label="Ежедневная миссия" />
        <p className="text-muted-foreground mt-3 text-xs">
          Ещё один урок — и цель твоя!
        </p>
      </Card>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-bold">Твой курс</h2>
        <Link
          href="/courses"
          className="text-primary flex min-h-11 items-center text-xs"
        >
          Все курсы
          <ChevronRight size={16} />
        </Link>
      </div>
      <Link
        href="/learn"
        className="border-border bg-card mt-2 flex items-center gap-3 rounded-2xl border p-4"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-blue-400/10 text-2xl">
          🇬🇧
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">Английский с нуля</h3>
          <p className="text-muted-foreground mt-1 mb-2 text-[11px]">
            A1 · Первые открытия
          </p>
          <Progress value={32} label="Прогресс курса" />
        </div>
        <ChevronRight size={18} className="text-muted-foreground" />
      </Link>
    </Reveal>
  );
}

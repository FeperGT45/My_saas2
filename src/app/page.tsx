import Link from 'next/link';
import { ArrowUpRight, Flame, Target, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
export default function HomePage() {
  return (
    <Reveal>
      <p className="text-muted-foreground mb-2 text-sm">Твой следующий шаг</p>
      <h1 className="text-3xl leading-tight font-bold tracking-tight">
        Новый язык.
        <br />
        <span className="text-primary">Новые возможности.</span>
      </h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        Всего несколько минут в день — и мир становится понятнее.
      </p>
      <section className="bg-primary text-primary-foreground relative mt-7 overflow-hidden rounded-3xl p-6">
        <Sparkles className="absolute top-5 right-5 opacity-50" size={38} />
        <p className="text-xs font-bold tracking-widest uppercase">
          Английский · A1
        </p>
        <h2 className="mt-5 text-2xl font-bold">Начни с простого</h2>
        <p className="mt-2 max-w-56 text-sm">
          Слова, которые пригодятся с первого дня.
        </p>
        <Button
          asChild
          variant="outline"
          className="bg-background text-foreground hover:bg-background/90 mt-6 border-transparent"
        >
          <Link href="/learn">
            Посмотреть программу <ArrowUpRight size={18} />
          </Link>
        </Button>
      </section>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {[
          { icon: Flame, label: 'Серия занятий', value: 'Всё впереди' },
          { icon: Target, label: 'Цель на день', value: '5 минут' },
        ].map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="border-border bg-card rounded-2xl border p-4"
          >
            <Icon className="text-primary mb-3" size={22} />
            <p className="text-sm font-bold">{value}</p>
            <p className="text-muted-foreground mt-1 text-xs">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Предварительный обзор LingoRush. Уроки, опыт и серии появятся на
        следующих этапах.
      </p>
    </Reveal>
  );
}

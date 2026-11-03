import { Reveal } from '@/components/ui/reveal';
import { Mascot } from '@/components/ui/mascot';
import { PlacementHome } from '@/features/placement/placement-panel';
import { LearnerOverviewPanel } from '@/features/learning/overview-panel';
import Link from 'next/link';
import { GameDashboard } from '@/features/gamification/dashboard';
export default function HomePage() {
  return (
    <Reveal>
      <section className="starfield relative mb-5 overflow-hidden rounded-[28px] border border-purple-400/25 bg-gradient-to-br from-[#393067] via-[#28234e] to-[#1d2944] p-5">
        <div className="relative z-10 w-[65%]">
          <p className="eyebrow text-teal-200">Твоя языковая вселенная</p>
          <h1 className="mt-3 text-2xl font-extrabold">Время нового уровня</h1>
          <p className="mt-3 text-sm text-purple-100/80">
            Твой следующий шаг — по результатам обучения.
          </p>
        </div>
        <Mascot className="absolute top-6 -right-3 w-[42%]" />
      </section>
      <PlacementHome />
      <LearnerOverviewPanel mode="home" />
      <GameDashboard compact />
      <Link
        className="text-primary my-4 flex min-h-12 items-center rounded-2xl border p-4 font-bold"
        href="/learn"
      >
        Моя карта уроков →
      </Link>
      <Link
        className="text-primary flex min-h-12 items-center rounded-2xl border p-4"
        href="/library"
      >
        Все уроки библиотеки →
      </Link>
    </Reveal>
  );
}

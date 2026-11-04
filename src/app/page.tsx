import { Reveal } from '@/components/ui/reveal';
import { Mascot } from '@/components/ui/mascot';
import { HomeLearning } from '@/features/learning/home-learning';
import Link from 'next/link';
export default function HomePage() {
  return (
    <Reveal>
      <section className="starfield relative mb-5 overflow-hidden rounded-[28px] border border-purple-400/25 bg-gradient-to-br from-[#393067] via-[#28234e] to-[#1d2944] p-5">
        <div className="relative z-10 w-[72%]">
          <p className="eyebrow text-teal-200">Английский по шагам</p>
          <h1 className="mt-3 text-2xl font-extrabold">Учись в своём темпе</h1>
          <p className="mt-3 text-sm text-purple-100/90">
            Выбери старт, проходи уроки и повторяй изученные слова.
          </p>
        </div>
        <Mascot className="absolute top-8 -right-4 w-[33%]" />
      </section>
      <HomeLearning />
      <details className="bg-card mt-5 rounded-2xl border px-4">
        <summary className="min-h-12 cursor-pointer py-4 font-bold">
          Как здесь учиться
        </summary>
        <ol className="text-muted-foreground mb-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
          <li>
            Определи уровень или выбери старт с нуля. Мы подберём первые темы.
          </li>
          <li>Открой «Мои уроки» и начни рекомендованный урок.</li>
          <li>
            Загляни в «Повторение»: там появятся слова из пройденных уроков.
          </li>
        </ol>
        <p className="text-muted-foreground mb-4 text-sm">
          Во «Всех уроках» можно самостоятельно выбрать тему. В профиле —
          результаты и настройки обучения.
        </p>
      </details>
      <Link
        className="text-primary mt-4 flex min-h-12 items-center justify-between rounded-2xl border p-4 text-sm"
        href="/courses"
      >
        Выбрать тему самостоятельно <span aria-hidden="true">→</span>
      </Link>
    </Reveal>
  );
}

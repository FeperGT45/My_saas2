import Link from 'next/link';
import { Check, LockKeyhole, Play, Flag, ArrowUpRight } from 'lucide-react';
import { PageTitle, Progress } from '@/components/ui/game';
import { demoLessons } from '@/features/demo/data';
export default function LearnPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твой маршрут"
        title="К звёздам, шаг за шагом"
        description="Английский · A1 · Первые открытия"
        action={
          <Link
            href="/courses"
            aria-label="Выбрать курс"
            className="bg-muted rounded-xl p-3"
          >
            <ArrowUpRight size={18} />
          </Link>
        }
      />
      <section className="border-primary/25 bg-primary/10 rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-bold">Глава 01 · Первый контакт</span>
          <span className="text-primary">2 / 5</span>
        </div>
        <Progress value={40} label="Прогресс главы" />
      </section>
      <div className="relative mt-8 space-y-6 pb-5">
        <div className="border-primary/25 absolute top-6 bottom-12 left-8 border-l-2 border-dashed" />
        {demoLessons.map((lesson) => (
          <div key={lesson.id} className="relative flex items-center gap-4">
            <div
              className={`flex size-16 shrink-0 items-center justify-center rounded-[22px] border-b-[5px] ${lesson.state === 'current' ? 'bg-primary text-primary-foreground border-[#6850ad] shadow-[0_0_30px_#aa8bff30]' : lesson.state === 'done' ? 'border-teal-800 bg-teal-300 text-teal-950' : 'bg-muted text-muted-foreground border-[#19192a]'}`}
            >
              {lesson.state === 'done' ? (
                <Check />
              ) : lesson.state === 'current' ? (
                <Play fill="currentColor" />
              ) : (
                <LockKeyhole size={20} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {lesson.state === 'current' && (
                <p className="eyebrow mb-1">Ты здесь</p>
              )}
              <h2
                className={`text-sm font-bold ${lesson.state === 'locked' ? 'text-muted-foreground' : ''}`}
              >
                {lesson.title}
              </h2>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {lesson.subtitle}
              </p>
              {lesson.state !== 'locked' ? (
                <Link
                  href="/lesson"
                  className="text-primary mt-1 inline-flex min-h-11 items-center text-xs font-bold"
                >
                  {lesson.state === 'done'
                    ? 'Повторить демоурок →'
                    : 'Начать демоурок →'}
                </Link>
              ) : (
                <p className="text-muted-foreground mt-2 text-[10px]">
                  Скоро в полной версии
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
        <Flag size={15} />
        Каждый шаг — новое открытие
      </p>
    </>
  );
}

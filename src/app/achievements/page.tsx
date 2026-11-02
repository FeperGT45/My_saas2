import {
  Rocket,
  Flame,
  Zap,
  Target,
  Trophy,
  Orbit,
  LockKeyhole,
} from 'lucide-react';
import { PageTitle, Progress } from '@/components/ui/game';
import { demoAchievements } from '@/features/demo/data';
import { Reveal } from '@/components/ui/reveal';
const icons = {
  rocket: Rocket,
  flame: Flame,
  zap: Zap,
  target: Target,
  trophy: Trophy,
  planet: Orbit,
};
export const metadata = { title: 'Достижения' };
export default function AchievementsPage() {
  return (
    <Reveal>
      <PageTitle
        eyebrow="Твоя коллекция"
        title="Маленькие триумфы"
        description="Большие перемены начинаются с маленьких побед."
      />
      <div className="border-border bg-card mb-6 rounded-2xl border p-4">
        <div className="mb-3 flex justify-between text-xs">
          <span>Пример коллекции</span>
          <span className="text-primary">3 из 6</span>
        </div>
        <Progress value={50} label="Демонстрационные достижения" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {demoAchievements.map((a) => {
          const Icon = icons[a.icon as keyof typeof icons];
          return (
            <section
              key={a.title}
              className={`relative rounded-3xl border p-4 text-center ${a.unlocked ? 'border-primary/20 from-primary/10 to-card bg-gradient-to-b' : 'border-border bg-card'}`}
            >
              <div
                className={`mx-auto flex size-16 items-center justify-center rounded-[22px] border-b-4 ${a.unlocked ? 'bg-primary/20 text-primary border-[#554084]' : 'bg-muted text-muted-foreground border-[#151525]'}`}
              >
                <Icon size={30} />
              </div>
              <p
                className={`mt-3 text-[9px] font-bold tracking-wider uppercase ${a.unlocked ? 'text-teal-300' : 'text-muted-foreground'}`}
              >
                {a.unlocked ? 'Открыто · демо' : 'Впереди'}
              </p>
              <h2 className="mt-2 text-sm font-bold">{a.title}</h2>
              <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                {a.text}
              </p>
              {!a.unlocked && (
                <LockKeyhole
                  size={12}
                  className="text-muted-foreground absolute top-3 right-3"
                />
              )}
            </section>
          );
        })}
      </div>
    </Reveal>
  );
}

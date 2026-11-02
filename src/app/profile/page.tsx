import Link from 'next/link';
import {
  Settings,
  ChevronRight,
  Medal,
  Zap,
  Flame,
  BookOpen,
  ShieldCheck,
} from 'lucide-react';
import { PageTitle, Card, Progress } from '@/components/ui/game';
import { demoPlayer } from '@/features/demo/data';
export const metadata = { title: 'Профиль' };
export default function ProfilePage() {
  return (
    <>
      <PageTitle
        eyebrow="Твоя история"
        title="Капитан своего пути"
        action={
          <Link
            href="/settings"
            aria-label="Настройки профиля"
            className="bg-muted rounded-xl p-3"
          >
            <Settings size={20} />
          </Link>
        }
      />
      <Card className="starfield text-center">
        <div className="border-primary/50 shadow-primary/10 mx-auto flex size-20 items-center justify-center rounded-[28px] border-2 bg-gradient-to-br from-purple-400 to-blue-500 text-2xl font-black text-white shadow-lg">
          {demoPlayer.initials}
        </div>
        <h2 className="mt-4 text-2xl font-extrabold">{demoPlayer.name}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Демонстрационный профиль
        </p>
        <span className="bg-primary/15 text-primary mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold">
          Уровень {demoPlayer.level} · Искатель
        </span>
        <div className="mt-5 flex justify-between text-[11px]">
          <span className="text-muted-foreground">До следующего уровня</span>
          <span>1 240 / 1 500 XP</span>
        </div>
        <Progress value={83} label="Уровень игрока" className="mt-2" />
      </Card>
      <div className="my-4 grid grid-cols-3 gap-2">
        {[
          { icon: Zap, value: '1 240', label: 'Опыт', color: 'text-primary' },
          {
            icon: Flame,
            value: '7',
            label: 'Дней подряд',
            color: 'text-orange-300',
          },
          {
            icon: BookOpen,
            value: '12',
            label: 'Уроков',
            color: 'text-teal-300',
          },
        ].map(({ icon: Icon, value, label, color }) => (
          <Card key={label} className="!p-3 text-center">
            <Icon size={20} className={`mx-auto ${color}`} />
            <p className="mt-2 font-extrabold">{value}</p>
            <p className="text-muted-foreground mt-1 text-[10px]">{label}</p>
          </Card>
        ))}
      </div>
      <Link
        href="/achievements"
        className="border-border bg-card flex items-center gap-3 rounded-2xl border p-4"
      >
        <span className="bg-primary/15 text-primary rounded-xl p-3">
          <Medal />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-bold">Мои достижения</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            3 награды в демоколлекции
          </p>
        </div>
        <ChevronRight size={18} />
      </Link>
      <Card className="mt-4">
        <p className="eyebrow mb-3">Изучаю сейчас</p>
        <div className="flex items-center gap-3">
          <span className="text-3xl">🇬🇧</span>
          <div>
            <p className="text-sm font-bold">Английский</p>
            <p className="text-muted-foreground mt-1 text-xs">
              A1 · Первые открытия
            </p>
          </div>
        </div>
      </Card>
      <p className="text-muted-foreground mt-5 flex items-start gap-2 text-[11px] leading-relaxed">
        <ShieldCheck size={17} className="shrink-0" />
        Это вымышленный профиль. Telegram-авторизация и сохранение прогресса ещё
        не подключены.
      </p>
    </>
  );
}

import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  GraduationCap,
  MessagesSquare,
  Palette,
  Target,
  Trophy,
} from 'lucide-react';
const tools = [
  {
    href: '/learning-plan',
    title: 'Учебный план',
    icon: CalendarDays,
    description: 'Персональный календарь занятий на 7 дней.',
    free: 'Базовые рекомендации — бесплатно',
  },
  {
    href: '/analytics',
    title: 'Аналитика английского',
    icon: ChartNoAxesCombined,
    description: 'Навыки, сложные темы и динамика результатов.',
    free: 'Базовый прогресс и XP — в профиле',
  },
  {
    href: '/dictionary',
    title: 'Мой словарь',
    icon: BookOpen,
    description: 'Свои слова, коллекции и тренировки памяти.',
    free: 'Изученные слова и базовое повторение — бесплатно',
  },
  {
    href: '/stories',
    title: 'Интерактивные истории',
    icon: MessagesSquare,
    description: 'Выбирай реплики и открывай новые концовки.',
    free: 'Одна ознакомительная история — бесплатно',
  },
  {
    href: '/weak-training',
    title: 'Слабые темы',
    icon: Target,
    description: 'Персональная практика по твоим ошибкам.',
    free: null,
  },
  {
    href: '/challenges',
    title: 'Испытания и награды',
    icon: Trophy,
    description: 'Недельные цели и косметические награды.',
    free: 'Обычные задания и достижения — бесплатно',
  },
  {
    href: '/appearance',
    title: 'Оформление интерфейса',
    icon: Palette,
    description: 'Темы, рамки аватара, значки и эффекты.',
    free: 'Стандартные темы — бесплатно',
  },
  {
    href: '/extended-test',
    title: 'Расширенный тест',
    icon: GraduationCap,
    description: '36 вопросов, разбор ошибок и история результатов.',
    free: 'Первоначальный тест — бесплатно',
  },
] as const;
export function PremiumFeatureHub() {
  return (
    <section aria-labelledby="premium-tools-title" className="my-6">
      <h2 id="premium-tools-title" className="text-xl font-bold">
        Все функции Premium
      </h2>
      <p className="text-muted-foreground mt-2 mb-4 text-sm">
        Открой нужный раздел. Бесплатные режимы доступны без подписки.
      </p>
      <div className="grid gap-3 min-[400px]:grid-cols-2">
        {tools.map(({ href, title, icon: Icon, description, free }) => (
          <Link
            key={href}
            href={href}
            className="border-primary/20 bg-card hover:border-primary/60 focus-visible:ring-ring flex min-h-40 flex-col rounded-2xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="mb-3 flex items-center justify-between">
              <Icon aria-hidden="true" size={23} className="text-primary" />
              <ArrowUpRight
                aria-hidden="true"
                size={17}
                className="text-muted-foreground"
              />
            </div>
            <h3 className="text-sm font-bold">{title}</h3>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {description}
            </p>
            <span className="text-primary mt-auto pt-3 text-[11px] leading-relaxed">
              {free ?? 'Доступно с Premium'}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

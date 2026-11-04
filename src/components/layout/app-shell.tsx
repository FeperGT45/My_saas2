'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Home,
  RotateCcw,
  UserRound,
  Zap,
  Layers,
  Settings,
} from 'lucide-react';
import { getDictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { TelegramStatus } from '@/features/telegram/status';
const t = getDictionary();
const links = [
  { href: '/', label: t.nav.home, icon: Home },
  { href: '/learn', label: t.nav.learn, icon: BookOpen },
  { href: '/courses', label: t.nav.courses, icon: Layers },
  { href: '/review', label: 'Повторение', icon: RotateCcw },
  { href: '/profile', label: t.nav.profile, icon: UserRound },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="border-border/60 bg-background relative mx-auto min-h-dvh max-w-lg border-x shadow-2xl shadow-black/40">
      <a href="#main" className="sr-only focus:not-sr-only">
        К содержимому
      </a>
      <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-black tracking-tight"
        >
          <span className="bg-primary/15 text-primary rounded-xl p-2">
            <Zap size={21} fill="currentColor" />
          </span>
          Vok<span className="text-primary -ml-2">lumi</span>
        </Link>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Link
            href="/profile"
            className="text-primary flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs"
          >
            <UserRound size={16} />
            Прогресс
          </Link>
          <Link
            href="/settings"
            aria-label="Настройки"
            className="text-muted-foreground hover:bg-muted flex size-11 items-center justify-center rounded-xl"
          >
            <Settings size={20} />
          </Link>
        </div>
      </header>
      <div className="px-5">
        <TelegramStatus />
      </div>
      <main id="main" className="px-5 pt-6 pb-32">
        {children}
      </main>
      <nav
        aria-label="Основная навигация"
        className="border-border bg-background/95 fixed bottom-0 z-20 grid w-full max-w-lg grid-cols-5 border-t px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl"
      >
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            path === href ||
            (href === '/learn' &&
              [
                '/lesson',
                '/placement',
                '/learning-plan',
                '/stories',
                '/weak-training',
              ].includes(path)) ||
            (href === '/courses' && path === '/library') ||
            (href === '/profile' &&
              [
                '/settings',
                '/achievements',
                '/leaderboard',
                '/friends',
                '/premium',
                '/admin',
                '/analytics',
                '/dictionary',
                '/challenges',
              ].includes(path));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={21} strokeWidth={active ? 2.5 : 1.7} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

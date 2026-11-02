'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Home, Trophy, UserRound, Zap } from 'lucide-react';
import { getDictionary } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { TelegramStatus } from '@/features/telegram/status';
const t = getDictionary();
const links = [
  { href: '/', label: t.nav.home, icon: Home },
  { href: '/learn', label: t.nav.learn, icon: BookOpen },
  { href: '/leaderboard', label: t.nav.leaderboard, icon: Trophy },
  { href: '/profile', label: t.nav.profile, icon: UserRound },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="border-border bg-background mx-auto min-h-dvh max-w-lg border-x">
      <a href="#main" className="sr-only focus:not-sr-only">
        К содержимому
      </a>
      <header className="flex items-center justify-between px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-5">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-black tracking-tight"
        >
          <span className="bg-primary text-primary-foreground rounded-xl p-2">
            <Zap size={21} fill="currentColor" />
          </span>
          {t.appName}
        </Link>
        <span className="border-border text-muted-foreground rounded-full border px-3 py-1 text-xs">
          PREVIEW
        </span>
      </header>
      <div className="px-5">
        <TelegramStatus />
      </div>
      <main id="main" className="px-6 pt-7 pb-32">
        {children}
      </main>
      <nav
        aria-label="Основная навигация"
        className="border-border bg-background/95 fixed bottom-0 z-10 grid w-full max-w-lg grid-cols-4 border-t px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={path === href ? 'page' : undefined}
            className={cn(
              'focus-visible:outline-primary flex min-h-12 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium focus-visible:outline-2',
              path === href ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">
            {title}
          </h1>
        </div>
        {action}
      </div>
      {description && (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('border-border bg-card rounded-3xl border p-5', className)}
    >
      {children}
    </section>
  );
}
export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2.5 overflow-hidden rounded-full bg-white/8', className)}
    >
      <div
        className="from-primary h-full rounded-full bg-gradient-to-r to-cyan-300 transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Card className="py-10 text-center">
      <div className="bg-primary/15 text-primary mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
        {icon}
      </div>
      <h2 className="font-bold">{title}</h2>
      <p className="text-muted-foreground mt-2 text-sm">{text}</p>
    </Card>
  );
}

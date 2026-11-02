import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'game-button bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-card hover:bg-muted',
      },
      size: { default: 'min-h-12 px-5 py-3', sm: 'min-h-10 px-4 py-2' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
export { Button, buttonVariants };

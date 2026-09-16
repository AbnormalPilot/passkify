import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Badges are pills. There is no square badge in this system. */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-xs py-[2px] text-[13px] leading-normal transition-colors',
  {
    variants: {
      variant: {
        neutral: 'bg-canvas-light text-ink',
        filled: 'bg-ink text-on-primary',
        brand: 'bg-brand text-ink',
        outline: 'border border-hairline-soft bg-transparent text-ash',
        'outline-light': 'border border-hairline bg-transparent text-graphite',
        mono: 'font-mono text-[10px] uppercase tracking-[0.04em] bg-canvas-soft text-ash',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

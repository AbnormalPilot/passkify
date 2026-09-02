import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Two corner languages, deliberately.
 *
 * Marketing calls to action are full pills; application chrome — toolbar tabs,
 * secondary controls inside product surfaces — is cut at 4-5px. The mix is not
 * an inconsistency: it is what separates the marketing voice from the product
 * voice in this system.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /* The marketing CTA on dark sections: a white pill carrying a thin ink
           border that paints inside the fill and reads as a confident edge. */
        primary:
          'rounded-full border border-ink bg-canvas-light text-ink hover:bg-canvas-paper',
        /* Its inverse, for light-section heroes. */
        'primary-on-light':
          'rounded-full border border-ink bg-ink text-on-primary hover:bg-ink-soft',
        /* The rare coral CTA. At most one per viewport. */
        brand: 'rounded-full border border-brand bg-brand text-ink hover:opacity-88',
        'secondary-dark':
          'rounded-[5px] border border-hairline-soft bg-canvas-soft text-ash hover:text-on-primary',
        'ghost-dark': 'rounded-full text-ash hover:text-on-primary',
        'ghost-light': 'rounded-full text-graphite hover:text-ink',
        /* Studio-style toolbar tab: uppercase mono, app radius. */
        'app-tab':
          'rounded-[4px] bg-canvas-soft text-ash font-mono text-[11px] font-semibold uppercase tracking-[0.06em] hover:text-on-primary',
        link: 'text-link-blue underline-offset-4 hover:underline',
      },
      size: {
        /* 44px meets AAA; it grows to 48px on touch widths. */
        lg: 'h-11 px-lg text-[16px] font-medium leading-normal max-md:h-12',
        sm: 'h-9 px-sm text-[13px] font-medium leading-[1.3] tracking-[-0.13px] max-md:h-11',
        tab: 'h-8 px-xs',
        icon: 'size-9 rounded-full max-md:size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

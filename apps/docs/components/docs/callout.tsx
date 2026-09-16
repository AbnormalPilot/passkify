import type * as React from 'react';
import { Lightbulb, Info, TriangleAlert, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const calloutStyles = {
  note: {
    icon: Info,
    className: 'rounded-[6px] bg-canvas-paper',
    iconClass: 'text-graphite',
  },
  tip: {
    icon: Lightbulb,
    /* The soft blue is the system's only chromatic surface fill, and this is
       the role it exists for. */
    className: 'rounded-[6px] bg-surface-blue-bg',
    iconClass: 'text-ink',
  },
  warning: {
    icon: TriangleAlert,
    className: 'rounded-[6px] border-l-[3px] border-brand bg-canvas-paper',
    iconClass: 'text-ink',
  },
  danger: {
    icon: OctagonAlert,
    className: 'rounded-[6px] border-l-[5px] border-error bg-canvas-paper',
    iconClass: 'text-error',
  },
} as const;

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: keyof typeof calloutStyles;
  title?: string;
  children: React.ReactNode;
}) {
  const { icon: Icon, className, iconClass } = calloutStyles[type];
  return (
    <div className={cn('not-prose my-5 flex gap-3 p-md', className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
      <div className="min-w-0 space-y-2 text-[15px] leading-normal tracking-[-0.15px] [&_a]:text-link-blue [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-hairline [&_code]:bg-canvas-light [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

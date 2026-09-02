import * as React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Section index tiles, and the two-column "do this, not that" block. */

export function Cards({ children }: { children: React.ReactNode }) {
  return <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function Card({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-xs rounded-[12px] border border-hairline bg-canvas-light p-lg transition-colors hover:border-graphite"
    >
      <span className="t-subtitle flex items-center gap-1.5 text-ink">
        {title}
        <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="t-body-sm text-graphite">{children}</span>
    </Link>
  );
}

export function Contrast({ children }: { children: React.ReactNode }) {
  return <div className="not-prose my-5 grid gap-3 md:grid-cols-2">{children}</div>;
}

export function ContrastItem({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'bad';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-[6px] p-md',
        tone === 'good'
          ? 'border border-hairline bg-canvas-light'
          : 'border-l-[5px] border-brand bg-canvas-paper',
      )}
    >
      <p
        className={cn('t-mono-caps mb-2', tone === 'good' ? 'text-graphite' : 'text-ink')}
      >
        {title}
      </p>
      <div className="t-body-sm [&_pre]:!mt-0 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!border-0">
        {children}
      </div>
    </div>
  );
}

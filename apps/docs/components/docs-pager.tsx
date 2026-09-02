'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getPagerLinks } from '@/lib/nav';

/** Previous/next in reading order, so the docs can be read straight through. */
export function DocsPager() {
  const pathname = usePathname();
  const { previous, next } = getPagerLinks(pathname);

  if (!previous && !next) return null;

  return (
    <nav className="mt-xxl grid border-t border-hairline sm:grid-cols-2" aria-label="Pagination">
      {previous ? (
        <Link
          href={previous.href}
          className="group flex flex-col gap-xs border-b border-hairline p-md transition-colors hover:bg-canvas-paper sm:border-b-0 sm:border-r"
        >
          <span className="t-mono-caps flex items-center gap-1.5 text-graphite">
            <ArrowLeft className="size-3" /> Previous
          </span>
          <span className="t-subtitle text-ink">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next.href}
          className="group flex flex-col gap-xs p-md text-right transition-colors hover:bg-canvas-paper sm:col-start-2"
        >
          <span className="t-mono-caps flex items-center justify-end gap-1.5 text-graphite">
            Next <ArrowRight className="size-3" />
          </span>
          <span className="t-subtitle text-ink">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}

import Link from 'next/link';
import type * as React from 'react';
import type { Support } from '@/lib/story';

/**
 * Each tile links to the section of the documentation that actually covers it,
 * so the grid is a way into the docs rather than a wall of logos. A support
 * claim the reader cannot follow up is just a claim.
 *
 * Marks come from Simple Icons in the system's graphite, so no single brand
 * shouts on the light band. A plain `img` rather than `next/image`: these are
 * single-colour SVGs at a fixed size, so there is nothing to optimise, and it
 * keeps the remote host out of `next.config`. If a slug is ever retired
 * upstream the name still renders, so a tile degrades to a label, not a gap.
 */
export function SupportGrid({ items }: { items: Support[] }) {
  return (
    <ul
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-(--cols)"
      /* The track takes exactly as many columns as there are items. A fixed
         count leaves a short row with an empty cell at the end, which reads as
         a missing entry rather than as spacing. */
      style={
        { '--cols': `repeat(${Math.min(items.length, 5)}, minmax(0, 1fr))` } as React.CSSProperties
      }
    >
      {items.map((item) => (
        <li key={item.name} className="bg-canvas-light">
          <Link
            href={item.href}
            className="flex h-full flex-col items-center justify-center gap-sm px-md py-xl transition-colors hover:bg-canvas-paper"
          >
            <img
              src={`https://cdn.simpleicons.org/${item.slug}/353535`}
              alt=""
              width={28}
              height={28}
              loading="lazy"
              className="h-7 w-7"
            />
            <span className="t-caption text-center text-ink">{item.name}</span>
            {item.caveat && (
              <span className="t-mono-micro text-center text-graphite">{item.caveat}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

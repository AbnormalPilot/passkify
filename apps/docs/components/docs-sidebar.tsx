'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { docsNav } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Grouped, collapsible navigation with a count per section.
 *
 * Only the section holding the current page is open. The reader is somewhere
 * specific, and the pages either side of the one they are on are the ones they
 * are most likely to want next; the other six groups are a table of contents
 * they can open, not a list they should have to scroll past. Closed groups
 * still show their name and their count, so nothing is hidden — the shape of
 * the whole documentation set stays on screen in one view.
 *
 * A section the reader opens or closes by hand wins over that default, but the
 * override is recorded against the path it was made on and dropped as soon as
 * they navigate. That is what stops a stale choice following someone across
 * the site: without it, collapsing a group once would leave it collapsed on
 * the very page whose contents it holds.
 *
 * The default is derived from `pathname` rather than set by an effect after
 * mount, so the server and the first client render agree on which group is
 * open and the sidebar does not visibly reshuffle on load.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const activeTitle = docsNav.find((section) =>
    section.items.some((item) => item.href === pathname),
  )?.title;

  /* A page outside the tree (or one whose href has drifted) would otherwise
     close every group and leave a sidebar with no links in it at all. */
  const openByDefault = activeTitle ?? docsNav[0].title;

  const [choice, setChoice] = useState<{ path: string; sections: Record<string, boolean> }>({
    path: pathname,
    sections: {},
  });
  const overrides = choice.path === pathname ? choice.sections : {};

  const toggle = (title: string, isOpen: boolean) =>
    setChoice({ path: pathname, sections: { ...overrides, [title]: !isOpen } });

  return (
    <nav aria-label="Documentation">
      {docsNav.map((section) => {
        const containsActive = section.title === activeTitle;
        const isOpen = overrides[section.title] ?? section.title === openByDefault;

        return (
          <div key={section.title} className="mb-5 last:mb-0">
            <button
              type="button"
              onClick={() => toggle(section.title, isOpen)}
              aria-expanded={isOpen}
              className="group mb-1.5 flex w-full items-center gap-1.5 border-b border-hairline px-1 py-1.5 text-left transition-colors hover:border-graphite"
            >
              <ChevronRight
                className={cn(
                  'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
                  isOpen && 'rotate-90',
                )}
              />
              <span className={cn('t-mono-caps', containsActive ? 'text-ink' : 'text-graphite')}>
                {section.title}
              </span>
              <span className="t-mono-micro ml-auto tabular-nums text-graphite">
                {section.items.length}
              </span>
            </button>

            {isOpen && (
              <ul className="ml-[0.4rem] space-y-px border-l border-border pl-2">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          '-ml-[calc(0.5rem+1px)] flex items-center justify-between gap-2 border-l-2 py-[0.35rem] pl-[calc(0.5rem+1px)] pr-2 text-[14px] tracking-[-0.14px] transition-colors',
                          active
                            ? 'border-brand font-medium text-ink'
                            : 'border-transparent text-graphite hover:border-border-strong hover:text-ink',
                        )}
                      >
                        <span>{item.title}</span>
                        {item.label && (
                          <span className="t-mono-micro rounded-full bg-canvas-paper px-1.5 py-0.5 text-graphite">
                            {item.label}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

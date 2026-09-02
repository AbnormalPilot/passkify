'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { docsNav } from '@/lib/nav';

/**
 * Search over the nav tree: titles plus the descriptions in `lib/nav.ts`.
 *
 * Deliberately not full-text. A hosted index would be a service dependency and
 * a build step, and for twenty pages the title-and-summary match is what
 * actually gets people to the right page.
 */
export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-[5px] border border-hairline-soft bg-canvas-soft px-2.5 text-[13px] text-ash transition-colors hover:text-on-primary max-md:h-11"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="t-mono-micro ml-2 hidden rounded-[4px] border border-hairline-soft px-1.5 text-ash sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search the documentation" />
        <CommandList>
          <CommandEmpty>Nothing matched that.</CommandEmpty>
          {docsNav.map((section) => (
            <CommandGroup key={section.title} heading={section.title}>
              {section.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.title} ${item.description}`}
                  onSelect={() => go(item.href)}
                >
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-sm">{item.title}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{item.description}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

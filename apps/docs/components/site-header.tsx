'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { DocsSidebar } from '@/components/docs-sidebar';
import { SearchDialog } from '@/components/search-dialog';
import { headerNav, siteLinks } from '@/lib/nav';
import { LIBRARY_VERSION } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * The persistent dark bar.
 *
 * It carries no bottom border. Against a light section scrolling underneath it
 * is held to the page by colour contrast alone, which is the same hard cut the
 * section polarity uses — a rule here would soften the one edge the system
 * wants hard.
 *
 * Layout is the canonical three-part lockup: brand-dot and wordmark left, the
 * primary menu centred, actions right. Below 960px the menu collapses into a
 * sheet and the primary CTA stays visible beside the trigger.
 */
export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-[var(--header-height)] bg-canvas">
      <div className="mx-auto flex h-full max-w-[var(--container)] items-center gap-lg px-lg">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost-dark"
              size="icon"
              className="-ml-2 min-[960px]:hidden"
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[19rem] border-hairline-soft bg-canvas p-0">
            <SheetTitle className="border-b border-hairline-soft px-5 py-4">
              <BrandMark size="sm" className="text-on-primary" />
            </SheetTitle>
            <div className="thin-scroll h-[calc(100dvh-4rem)] overflow-y-auto px-3 py-5">
              <DocsSidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/" className="shrink-0 text-on-primary">
          <BrandMark size="sm" />
        </Link>

        {/* Centred primary menu. */}
        <nav className="mx-auto hidden items-center gap-1 min-[960px]:flex" aria-label="Sections">
          {headerNav.map((item) => {
            const active =
              item.href === '/docs'
                ? pathname === '/docs'
                : pathname.startsWith(item.href.split('/').slice(0, 3).join('/'));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-sm py-xs text-[15px] tracking-[-0.15px] transition-colors',
                  active ? 'text-on-primary' : 'text-ash hover:text-on-primary',
                )}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-sm min-[960px]:ml-0">
          <span className="t-mono-micro hidden text-mute sm:inline">v{LIBRARY_VERSION}</span>
          <SearchDialog />
          <Button variant="secondary-dark" size="sm" asChild className="hidden sm:inline-flex">
            <a href={siteLinks.github} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </Button>
          {/* The one CTA that survives every breakpoint. */}
          <Button variant="primary" size="sm" asChild className="hidden min-[420px]:inline-flex">
            <Link href="/docs/quickstart">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

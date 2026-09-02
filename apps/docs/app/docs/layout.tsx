import { SiteHeader } from '@/components/site-header';
import { DocsSidebar } from '@/components/docs-sidebar';
import { DocsToc } from '@/components/docs-toc';
import { DocsPager } from '@/components/docs-pager';
import { DocsPageHeader } from '@/components/docs-page-header';
import { SiteFooter } from '@/components/site-footer';

/**
 * Three-column documentation shell: navigation, content, table of contents.
 *
 * Documentation sits on the light polarity. This system puts density on light
 * — it is where the comparison tables and the dense reference surfaces live —
 * and reference prose is the densest reading this site asks anyone to do.
 * The dark bar stays fixed above it, held there by contrast alone.
 *
 * The shell states its own ink. `body` carries the dark polarity's white, so
 * anything here without an explicit colour would inherit it and disappear
 * against the light ground.
 *
 * The two side columns are `position: sticky` rather than `fixed` so they
 * scroll with the page when the content is short, and they drop out entirely
 * below their breakpoints instead of squeezing the prose column.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas-light text-ink">
      <SiteHeader />

      <div className="mx-auto flex max-w-[var(--container)] gap-0 px-lg pt-[var(--header-height)]">
        {/* Sidebar: hidden below lg, where it moves into the header sheet. */}
        <aside className="sticky top-[var(--header-height)] hidden h-[calc(100dvh-var(--header-height))] w-[var(--sidebar-width)] shrink-0 lg:block">
          <div className="thin-scroll h-full overflow-y-auto py-section pr-4">
            <DocsSidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-section lg:px-10 xl:px-14">
          <div className="mx-auto max-w-[46rem]">
            <DocsPageHeader />
            <article data-docs-content className="prose">
              {children}
            </article>
            <DocsPager />
          </div>
        </main>

        {/* Table of contents: only where there is room for a third column. */}
        <aside className="sticky top-[var(--header-height)] hidden h-[calc(100dvh-var(--header-height))] w-[var(--toc-width)] shrink-0 xl:block">
          <div className="thin-scroll h-full overflow-y-auto py-section pl-2">
            <DocsToc />
          </div>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}

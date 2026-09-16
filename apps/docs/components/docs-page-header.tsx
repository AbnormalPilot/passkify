'use client';

import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { flatNav, getSectionTitle } from '@/lib/nav';
import { JsonLd } from '@/components/json-ld';
import { getPage } from '@/lib/content';
import { techArticleSchema, breadcrumbSchema } from '@/lib/schema';

/**
 * Breadcrumb, title and standfirst, rendered from `lib/nav.ts`.
 *
 * Deriving it here rather than writing an `# H1` in each MDX file means the
 * sidebar label, the search result, the pager link and the page title cannot
 * disagree with each other. There is one place to change a page's name.
 */
export function DocsPageHeader() {
  const pathname = usePathname();
  const section = getSectionTitle(pathname);
  const page = flatNav.find((item) => item.href === pathname);

  if (!page) return null;

  // The visible breadcrumb and the structured one are built from the same
  // source, so they cannot say different things.
  const generated = getPage(pathname);

  return (
    <>
      {generated && <JsonLd data={techArticleSchema(generated)} />}
      {generated && <JsonLd data={breadcrumbSchema(generated)} />}
      <header className="mb-8">
        {section && (
          <nav
            aria-label="Breadcrumb"
            className="t-mono-caps mb-md flex items-center gap-1.5 text-graphite"
          >
            <span>Docs</span>
            <ChevronRight className="size-3" />
            <span>{section}</span>
            <ChevronRight className="size-3" />
            <span className="text-ink">{page.title}</span>
          </nav>
        )}
        <h1 className="t-display-sm text-ink">{page.title}</h1>
        <p className="t-subtitle mt-md max-w-[58ch] text-graphite">{page.description}</p>
        <div className="mt-xl border-t border-hairline" />
      </header>
    </>
  );
}

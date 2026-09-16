import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { pagesBySection } from '@/lib/content';
import { buildMetadata } from '@/lib/metadata';

export const metadata: Metadata = buildMetadata({
  route: '/search',
  title: 'All pages',
  description: 'Every page and every section heading in the passkify documentation, on one page.',
});

/**
 * The whole documentation, one link deep.
 *
 * Three jobs. It is where the site's `SearchAction` structured data points, so
 * a search engine has somewhere real to send a site-search query. It is what a
 * reader with JavaScript disabled gets instead of the command palette. And it
 * is roughly three hundred internal links in one place, which is the cheapest
 * thing a documentation site can do for its own crawlability.
 */
export default function SearchPage() {
  const sections = pagesBySection();
  const headingCount = sections.reduce(
    (total, section) =>
      total + section.pages.reduce((count, page) => count + page.headings.length, 0),
    0,
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />
      <main className="mx-auto max-w-[var(--container)] px-lg pb-xxl pt-[calc(var(--header-height)+3rem)]">
        <h1 className="t-display-sm text-ink-invert">All pages</h1>
        <p className="mt-sm max-w-[60ch] text-mute">
          Every documentation page and every section within it. {sections.length} sections,{' '}
          {sections.reduce((total, section) => total + section.pages.length, 0)} pages,{' '}
          {headingCount} headings. Press{' '}
          <kbd className="rounded border border-white/20 px-1 font-mono text-[0.75em]">⌘K</kbd>{' '}
          anywhere for the search dialog instead.
        </p>

        {sections.map((section) => (
          <section key={section.section} className="mt-xl">
            <h2 className="t-mono-micro uppercase tracking-wide text-mute">{section.section}</h2>
            <ul className="mt-md space-y-lg">
              {section.pages.map((page) => (
                <li key={page.route}>
                  <Link href={page.route} className="t-body-lg text-ink-invert hover:underline">
                    {page.title}
                  </Link>
                  <p className="mt-1 max-w-[70ch] text-sm text-mute">{page.description}</p>
                  {page.headings.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-x-md gap-y-1">
                      {page.headings
                        .filter((heading) => heading.depth <= 3 && heading.id)
                        .map((heading) => (
                          <li key={`${page.route}#${heading.id}`}>
                            <Link
                              href={`${page.route}#${heading.id}`}
                              className="text-xs text-mute hover:text-ink-invert hover:underline"
                            >
                              {heading.text}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className="mt-1">
                    <a
                      href={`${page.route}.md`}
                      className="t-mono-micro text-mute hover:text-ink-invert"
                    >
                      {page.route}.md
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mt-xxl border-t border-white/10 pt-lg">
          <h2 className="t-mono-micro uppercase tracking-wide text-mute">For agents</h2>
          <ul className="mt-md space-y-1 text-sm text-mute">
            <li>
              <a href="/llms.txt" className="hover:text-ink-invert hover:underline">
                /llms.txt
              </a>{' '}
              — the map
            </li>
            <li>
              <a href="/llms-full.txt" className="hover:text-ink-invert hover:underline">
                /llms-full.txt
              </a>{' '}
              — every page, one file
            </li>
            <li>
              <code className="font-mono">npx passkify skills install</code> — skills for your
              coding agent
            </li>
            <li>
              <code className="font-mono">npx passkify mcp</code> — an MCP server over these docs
            </li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

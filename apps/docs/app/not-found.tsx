import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { docsNav } from '@/lib/nav';

/**
 * The four pages a reader who mistyped a URL was most likely heading for.
 *
 * Held as hrefs and resolved against the navigation tree rather than restated,
 * so the titles and descriptions here cannot drift from the sidebar's. A page
 * that is renamed or removed drops out of this list instead of becoming a
 * second dead link on the page whose job is dead links.
 */
const LIKELY = ['/docs/quickstart', '/docs/server/passkey-server', '/docs/client', '/docs/errors'];

/**
 * Not found.
 *
 * A 404 is a navigation failure, so this one is built to end the failure
 * rather than to announce it. The header comes with it, which means the reader
 * arrives with the full nav and the search dialog already available; under it
 * are the four destinations that actually account for most mistyped URLs, each
 * carrying the same description it has in the sidebar.
 *
 * It is set on the dark polarity and laid out on the editorial container, so a
 * reader who lands here from a search result meets the same page the rest of
 * the site is made of instead of an unstyled apology.
 */
export default function NotFound() {
  const items = docsNav.flatMap((section) => section.items);
  const likely = LIKELY.map((href) => items.find((item) => item.href === href)).filter(
    (item) => item !== undefined,
  );

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-on-primary">
      <SiteHeader />

      {/* `flex-1` on a stretched column child, not `items-center`: centring the
          cross axis shrinks every child to its longest word and breaks the
          headline one word per line. */}
      <main className="flex-1 pt-[var(--header-height)]">
        <div className="container-editorial py-section-lg">
          <p className="t-mono-eyebrow text-mute">404 — not found</p>
          <h1 className="t-display-md mt-lg max-w-[16ch] text-on-primary">
            That page does not exist.
          </h1>
          <p className="t-subtitle mt-lg max-w-[52ch] text-ash">
            It may have been renamed, or the link that brought you here may be older than the
            page it points at. Search is on <span className="font-mono text-[0.9em]">⌘K</span>, and
            every page in the documentation is listed in the sidebar.
          </p>

          <div className="mt-xxl flex flex-wrap gap-md">
            <Button asChild>
              <Link href="/docs">Go to the documentation</Link>
            </Button>
            <Button asChild variant="secondary-dark">
              <Link href="/">Back to the home page</Link>
            </Button>
          </div>

          <p className="t-mono-caps mt-section-lg text-mute">Most likely you wanted</p>
          <ul className="mt-lg grid gap-lg md:grid-cols-2">
            {likely.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="card-dark block h-full transition-colors hover:border-mute"
                >
                  <p className="t-heading-sm text-on-primary">{item.title}</p>
                  <p className="t-body mt-sm text-ash">{item.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

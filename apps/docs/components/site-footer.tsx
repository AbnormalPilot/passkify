import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { footerNav, siteLinks } from '@/lib/nav';

/**
 * The dark terminal surface.
 *
 * The mono small-caps column heads are what lock in the technical-trade-journal
 * register — they are the last thing on the page, and they are the clearest
 * statement that this is a developer platform rather than generic marketing.
 *
 * Every link is internal by design. GitHub and npm appear once each, labelled
 * as source and registry, because no part of the documentation lives off-site.
 */
export function SiteFooter() {
  return (
    <footer className="bg-canvas py-section text-on-primary">
      <div className="mx-auto max-w-[var(--container)] px-lg">
        <div className="grid gap-xl grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <BrandMark size="md" />
            <p className="t-body-sm mt-md max-w-[30ch] text-ash">
              Passkeys for your website. Client and server in one package, zero runtime
              dependencies.
            </p>
          </div>

          {footerNav.map((section) => (
            <div key={section.title}>
              <h2 className="t-mono-caps mb-md text-mute">{section.title}</h2>
              <ul className="space-y-[10px]">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="t-caption text-ash transition-colors hover:text-on-primary"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h2 className="t-mono-caps mb-md text-mute">Project</h2>
            <ul className="space-y-[10px]">
              <li>
                <a
                  href={siteLinks.github}
                  target="_blank"
                  rel="noreferrer"
                  className="t-caption text-ash transition-colors hover:text-on-primary"
                >
                  Source
                </a>
              </li>
              <li>
                <a
                  href={siteLinks.npm}
                  target="_blank"
                  rel="noreferrer"
                  className="t-caption text-ash transition-colors hover:text-on-primary"
                >
                  Registry
                </a>
              </li>
              <li>
                <Link
                  href="/docs/changelog"
                  className="t-caption text-ash transition-colors hover:text-on-primary"
                >
                  Changelog
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-xxl flex flex-wrap items-center justify-between gap-md border-t border-hairline-soft pt-lg">
          <p className="t-meta text-mute">MIT licensed. Node 18 and above.</p>
          <BrandMark size="sm" className="text-ash" />
        </div>
      </div>
    </footer>
  );
}

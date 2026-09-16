import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { InstallCommand } from '@/components/install-command';
import { CodeWindow } from '@/components/code-window';
import { SupportGrid } from '@/components/support-grid';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/motion/reveal';
import { Counter } from '@/components/motion/counter';
import { CeremonyScroller } from '@/components/motion/ceremony-scroller';
import { ChecksColumns } from '@/components/motion/checks-columns';
import { CEREMONY, CHECKS, MEASURES, RUNTIMES, STORES, TENETS } from '@/lib/story';
import { buildMetadata } from '@/lib/metadata';

export const metadata: Metadata = buildMetadata({
  route: '/',
  title: 'passkify',
  description:
    'Passkeys for your website. Client and server in one npm package, zero runtime dependencies, every check the WebAuthn specification asks for.',
  absoluteTitle: true,
});

export default function Home() {
  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />

      <main className="pt-[var(--header-height)]">
        {/* ------------------------------------------------------------ hero
            Type only, given the whole container width, and the single
            display-mega setting the page is allowed. */}
        <section className="section-dark">
          <Reveal className="container-editorial">
            <p data-reveal className="t-mono-eyebrow text-mute">
              Passwordless authentication
            </p>
            <h1 data-reveal className="t-display-mega mt-lg max-w-[16ch] text-on-primary">
              Passkeys without the homework
            </h1>
            <p data-reveal className="t-subtitle mt-xl max-w-[52ch] text-ash">
              Client and server in one package. No runtime dependencies. Every check the
              specification asks for, on every login.
            </p>
            <div data-reveal className="mt-xxl flex flex-wrap items-center gap-sm">
              <Button variant="primary" size="lg" asChild>
                <Link href="/docs/quickstart">Get started free</Link>
              </Button>
              <InstallCommand />
            </div>
          </Reveal>
        </section>

        {/* -------------------------------------------------------- evidence
            First polarity cut. Four figures, all of them things you can check
            against the repository rather than take on trust. */}
        <section className="section-light">
          <Reveal className="container-editorial" stagger={0.06}>
            <h2 data-reveal className="t-display-md max-w-[18ch] text-ink">
              Four numbers you can verify yourself
            </h2>
            <div className="mt-xxl grid gap-xl sm:grid-cols-2 lg:grid-cols-4">
              {MEASURES.map((measure) => (
                <div key={measure.label} data-reveal>
                  <p className="t-display-md text-ink">
                    {measure.value === 0 ? (
                      '0'
                    ) : (
                      <Counter value={measure.value} decimals={measure.decimals ?? 0} />
                    )}
                  </p>
                  <p className="t-mono-caps mt-md text-graphite">{measure.label}</p>
                  <p className="t-body-sm mt-sm max-w-[28ch] text-graphite">{measure.note}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- stakes
            The argument, before the mechanism. Two columns that disagree with
            each other, which is a different shape from every other section. */}
        <section className="section-dark">
          <Reveal className="container-editorial">
            <p data-reveal className="t-mono-eyebrow text-mute">
              Why this is worth changing
            </p>
            <h2 data-reveal className="t-display-xl mt-lg max-w-[20ch] text-on-primary">
              A password is a secret you keep for someone else
            </h2>

            <div className="mt-xxl grid gap-xxl lg:grid-cols-2">
              <div data-reveal>
                <p className="t-mono-caps text-mute">What you hold today</p>
                <p className="t-subtitle mt-md max-w-[46ch] text-ash">
                  A hash of something your user probably reused. It sits in your database until the
                  day it does not, and on that day the damage is theirs, not yours. Phishing does
                  not even need the breach: a convincing copy of your login page is enough, because
                  the user is the one being asked to recognise it.
                </p>
              </div>
              <div data-reveal className="card-brand">
                <p className="t-mono-caps text-ink/70">What you hold instead</p>
                <p className="t-subtitle mt-md max-w-[46ch] text-ink">
                  A public key. It verifies signatures and can do nothing else. Publish it on a
                  billboard and no account is closer to being taken. The private half never leaves
                  the device it was made on, and the browser will only sign for the exact domain
                  that made it.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* -------------------------------------------------------- ceremony
            The centre of the page: one login, in order, against a heading that
            holds its place while the steps pass it. The section keeps its own
            vertical padding — nothing here claims the viewport. */}
        <section className="section-dark">
          <CeremonyScroller
            eyebrow="One login, start to finish"
            heading="There is no secret to steal"
            steps={CEREMONY}
          />
        </section>

        {/* ---------------------------------------------------------- checks
            Every authentication check, in three columns at different depths, because
            the point being made is that they keep coming. */}
        <section className="section-dark">
          <ChecksColumns
            eyebrow="Verification"
            heading="Every assertion is doubted before it is believed"
            standfirst="These are the checks the authentication path runs, in the order it runs them. Each label is a real member of the exported error type, thrown at that exact point."
            checks={CHECKS}
          />
        </section>

        {/* -------------------------------------------------------- runtimes
            Credibility by specificity: the honest list, including where it
            does not run. */}
        <section className="section-light">
          <Reveal className="container-editorial">
            <p data-reveal className="t-mono-eyebrow text-graphite">
              Where it runs
            </p>
            <h2 data-reveal className="t-display-md mt-lg max-w-[20ch] text-ink">
              Your stack, not a new one
            </h2>

            <div data-reveal className="mt-xxl">
              <p className="t-mono-caps mb-md text-graphite">Servers and frameworks</p>
              <SupportGrid items={RUNTIMES} />
            </div>

            <div data-reveal className="mt-xl">
              <p className="t-mono-caps mb-md text-graphite">Storage, with a written adapter</p>
              <SupportGrid items={STORES} />
            </div>

            {/* What the list rests on. A support grid without a stated basis
                is a marketing claim rather than a specification. */}
            <div data-reveal className="alert-banner mt-xl max-w-[70ch]">
              <p className="t-mono-caps mb-2">What the server half needs</p>
              <p>
                WebCrypto, and nothing else. Signature verification, X.509 parsing and hashing are
                written against the global <code className="font-mono">crypto</code>, so no ceremony
                path imports a <code className="font-mono">node:</code> built-in. A test walks every
                source file on each run and fails if one appears, which is why Workers and Deno
                carry no asterisk above, and why Cloudflare needs no{' '}
                <code className="font-mono">nodejs_compat</code> flag.
              </p>
              <p className="mt-sm">
                <Link href="/docs/guides/frameworks" className="underline underline-offset-4">
                  Every target above, with a worked example
                </Link>
              </p>
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- tenets */}
        <section className="section-paper">
          <Reveal className="container-editorial">
            <p data-reveal className="t-mono-eyebrow text-graphite">
              Design rules
            </p>
            <h2 data-reveal className="t-display-md mt-lg max-w-[16ch] text-ink">
              Rules the API will not bend
            </h2>

            <div className="mt-xxl grid gap-lg md:grid-cols-2">
              {TENETS.map((tenet) => (
                <article key={tenet.title} data-reveal className="card-light">
                  <h3 className="t-heading-sm text-ink">{tenet.title}</h3>
                  <p className="t-body mt-sm max-w-[52ch] text-graphite">{tenet.body}</p>
                </article>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------- try it out
            The demo is the strongest evidence on the page, because it is the
            published package verifying the reader's own authenticator. */}
        <section className="section-dark">
          <Reveal className="container-editorial grid items-center gap-xxl lg:grid-cols-2">
            <div>
              <p data-reveal className="t-mono-eyebrow text-mute">
                Read it, then run it
              </p>
              <h2 data-reveal className="t-display-md mt-lg max-w-[16ch] text-on-primary">
                The demo is the library
              </h2>
              <p data-reveal className="t-subtitle mt-lg max-w-[46ch] text-ash">
                Nothing on the demo page is simulated. It mounts a real PasskeyServer over a memory
                store and verifies the assertion your own authenticator produces. If it works there,
                that same route handler works in your application.
              </p>
              <div data-reveal className="mt-xl flex flex-wrap gap-sm">
                <Button variant="primary" size="lg" asChild>
                  <Link href="/demo">Try the live demo</Link>
                </Button>
              </div>
            </div>
            <div data-reveal>
              <CodeWindow
                label="app/api/passkey/[...passkey]/route.ts"
                code={`const handler = passkeys.handler({
  basePath: '/api/passkey',
  getSessionUserId: (req) => readSession(req),
});

export {
  handler as GET, handler as POST,
  handler as PATCH, handler as DELETE,
};`}
              />
            </div>
          </Reveal>
        </section>

        {/* --------------------------------------------------------- closing */}
        <section className="section-dark border-t border-hairline-soft">
          <Reveal className="container-editorial text-center">
            <h2 data-reveal className="t-display-xl mx-auto max-w-[16ch] text-on-primary">
              Stop storing passwords
            </h2>
            <p data-reveal className="t-subtitle mx-auto mt-lg max-w-[50ch] text-ash">
              The documentation covers every method and every option, and says why each one is
              shaped the way it is.
            </p>
            <div data-reveal className="mt-xxl flex flex-wrap items-center justify-center gap-sm">
              <Button variant="brand" size="lg" asChild>
                <Link href="/docs/quickstart">Read the quickstart</Link>
              </Button>
              <InstallCommand />
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

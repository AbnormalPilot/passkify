import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { CodeWindow } from '@/components/code-window';
import { Button } from '@/components/ui/button';
import { DemoConsole } from '@/components/demo-console';

export const metadata: Metadata = {
  title: 'Demo',
  description:
    'A working passwordless sign-up and sign-in, running the published passkify package against your own authenticator.',
};

const STEPS = [
  {
    eyebrow: '01 / enrol',
    title: 'Choose a name',
    body: 'Anything at all. It is discarded when the process restarts.',
  },
  {
    eyebrow: '02 / verify',
    title: 'Create the account',
    body: 'Your device offers Touch ID, Windows Hello, a phone, or a security key.',
  },
  {
    eyebrow: '03 / return',
    title: 'Sign out, then in',
    body: 'Signing in asks for no username. The browser shows what it holds for this domain.',
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <SiteHeader />

      <main className="pt-[var(--header-height)]">
        {/* Dark hero, then a hard cut to the light surface the console runs on:
            the same polarity rhythm the home page uses. */}
        <section className="section-dark">
          <div className="container-editorial">
            <p className="t-mono-eyebrow text-mute">Live demo</p>
            <h1 className="t-display-xl mt-lg max-w-[16ch] text-on-primary">
              Sign in without a password
            </h1>
            <p className="t-subtitle mt-lg max-w-[56ch] text-ash">
              This runs the published package against your own authenticator. Nothing is simulated:
              the assertion your device produces is verified by the same code the documentation
              describes.
            </p>
          </div>
        </section>

        <section className="section-light">
          <div className="container-editorial grid gap-xxl lg:grid-cols-[1fr_1.15fr]">
            {/* Instructions */}
            <div>
              <ol>
                {STEPS.map((step, index) => (
                  <li key={step.eyebrow} className={index > 0 ? 'mt-xl' : ''}>
                    <p className="t-mono-caps mb-2 text-graphite">{step.eyebrow}</p>
                    <h2 className="t-heading-sm text-ink">{step.title}</h2>
                    <p className="t-body mt-sm max-w-[42ch] text-graphite">{step.body}</p>
                  </li>
                ))}
              </ol>

              <div className="alert-banner mt-xl">
                <p className="t-mono-caps mb-2">Disposable by design</p>
                <p>
                  Accounts live in an in-memory store and vanish when the server restarts. Your
                  passkey stays on your device, so revoke it in your password manager when you are
                  finished.
                </p>
              </div>
            </div>

            {/* The console */}
            <DemoConsole />
          </div>
        </section>

        {/* What is running */}
        <section className="section-paper">
          <div className="container-editorial">
            <p className="t-mono-eyebrow text-graphite">What is running</p>
            <h2 className="t-display-md mt-lg max-w-[20ch] text-ink">
              Both halves, in full
            </h2>

            <div className="mt-xxl grid gap-lg lg:grid-cols-2">
              <CodeWindow
                label="app/api/passkey/[...passkey]/route.ts"
                code={`const handler = demoPasskeys.handler({
  basePath: '/api/passkey',
  getSessionUserId: (req) => readSession(req),
  onRegister: (_req, { user }) =>
    ({ 'set-cookie': createSessionCookie(user.id) }),
  onLogin: (_req, { user }) =>
    ({ 'set-cookie': createSessionCookie(user.id) }),
});

export {
  handler as GET, handler as POST,
  handler as PATCH, handler as DELETE,
};`}
              />
              <div className="flex flex-col gap-lg">
                <CodeWindow
                  label="components/demo-console.tsx"
                  code={`configure({ baseUrl: '/api/passkey' });

// Create the account
await register({ username });

// Enter. No username needed.
await login();

// Offer passkeys in the browser's own
// autofill dropdown.
signInWithAutofill().then(refresh);`}
                />
                <p className="t-body max-w-[46ch] text-graphite">
                  Both files are reproduced in full on the{' '}
                  <Link href="/docs/examples" className="text-link-blue underline underline-offset-4">
                    examples page
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section-dark">
          <div className="container-editorial text-center">
            <p className="t-subtitle mx-auto max-w-[48ch] text-ash">
              When it works here, the same twelve lines work in your application.
            </p>
            <div className="mt-xl flex flex-wrap items-center justify-center gap-sm">
              <Button variant="primary" size="lg" asChild>
                <Link href="/docs/quickstart">Quickstart</Link>
              </Button>
              <Button variant="ghost-dark" size="lg" asChild>
                <Link href="/docs/guides/troubleshooting">If it did not work</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

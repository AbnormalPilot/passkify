import type { Metadata, Viewport } from 'next';
import { SITE_ORIGIN, absoluteUrl } from '@/lib/site';
import { JsonLd } from '@/components/json-ld';
import { softwareApplicationSchema, webSiteSchema } from '@/lib/schema';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/* Self-hosted at build time by next/font, so there is no render-blocking
   request to Google and no layout shift when a face swaps in.

   The design system specifies `waldenburgNormal` (ABC Walden Burn) for every
   running-text role. It is a commercial licence we do not hold, so this is the
   substitution the system itself nominates: Inter at the same sizes, with the
   OpenType variant set dropped and display tracking pulled 0.5px tighter to
   compensate for Inter's looser defaults (-5.0px at 112px rather than -4.48px).

   IBM Plex Mono is unchanged — it is open source and is the specified face.
   It is a labelling system only: eyebrows, small-caps tags, technical
   captions. Never body, never headlines. */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-brand',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-brand',
  display: 'swap',
});

const TITLE = 'passkify — passkeys for your website';
const DESCRIPTION =
  'Complete documentation for passkify: passkeys for your website, with client and server in one npm package and zero runtime dependencies.';

export const metadata: Metadata = {
  /* Everything relative below — canonicals, OG images — resolves against this.
     Without it Next silently drops them, which is why they were absent. */
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: 'passkify',
    template: '%s | passkify',
  },
  description: DESCRIPTION,
  applicationName: 'passkify',
  authors: [{ name: 'Himanshu Dubey', url: 'https://github.com/AbnormalPilot' }],
  creator: 'Himanshu Dubey',
  keywords: [
    'passkey',
    'passkeys',
    'webauthn',
    'fido2',
    'authentication',
    'passwordless',
    'login',
    'auth',
    'typescript',
    'node',
  ],
  openGraph: {
    type: 'website',
    siteName: 'passkify',
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl('/'),
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0b',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/* Browser extensions (ColorZilla, Grammarly, etc.) inject attributes onto
          <body> before React hydrates, which reads as a mismatch. Suppressing is
          attribute-level and one level deep only — it does not mask real
          mismatches inside {children}. */}
      <body className="antialiased" suppressHydrationWarning>
        <JsonLd data={softwareApplicationSchema()} />
        <JsonLd data={webSiteSchema()} />
        {children}
      </body>
    </html>
  );
}

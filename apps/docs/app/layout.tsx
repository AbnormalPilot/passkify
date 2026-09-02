import type { Metadata } from 'next';
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

export const metadata: Metadata = {
  title: {
    default: 'passkify',
    template: '%s | passkify',
  },
  description:
    'Complete documentation for passkify: passkeys for your website, with client and server in one npm package and zero runtime dependencies.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/* Browser extensions (ColorZilla, Grammarly, etc.) inject attributes onto
          <body> before React hydrates, which reads as a mismatch. Suppressing is
          attribute-level and one level deep only — it does not mask real
          mismatches inside {children}. */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

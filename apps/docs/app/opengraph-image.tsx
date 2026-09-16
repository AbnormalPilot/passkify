import { ImageResponse } from 'next/og';
import { LIBRARY_VERSION } from '@/lib/site';

/* The card every share of this site renders as. Generated rather than checked
   in, for the same reason `apple-icon.tsx` is: the mark cannot drift.

   System fonts only. `next/og` will happily fetch a webfont, but that is a
   network call inside the build for a 1200x630 image nobody reads closely, and
   the fallback stack renders the wordmark acceptably at this size. */

export const alt = 'passkify — passkeys for your website';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0b0b0b',
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: 99999, background: '#f36458' }} />
        <div style={{ fontSize: 44, color: '#fafafa', letterSpacing: '-0.02em' }}>passkify</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.05,
            color: '#fafafa',
            letterSpacing: '-0.035em',
            maxWidth: 900,
          }}
        >
          Passkeys for your website, without the WebAuthn homework.
        </div>
        <div style={{ fontSize: 30, color: '#a1a1a1', letterSpacing: '-0.01em' }}>
          Client and server in one npm package. Zero runtime dependencies.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 24,
          color: '#787878',
        }}
      >
        <div style={{ display: 'flex' }}>npm install passkify</div>
        <div style={{ display: 'flex' }}>v{LIBRARY_VERSION}</div>
      </div>
    </div>,
    size,
  );
}

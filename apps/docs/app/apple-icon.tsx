import { ImageResponse } from 'next/og';

/* iOS home-screen icon. Apple does not accept SVG for `apple-touch-icon`, so
   this renders the same mark as `icon.svg` to PNG at build time — generated
   rather than checked in, so the two cannot drift apart.

   No corner radius and no padding: iOS applies its own squircle mask and
   expects a full-bleed square. The dot keeps the tile's 7:16 ratio. */

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0b',
        }}
      >
        <div
          style={{
            width: 79,
            height: 79,
            borderRadius: 99999,
            background: '#f36458',
          }}
        />
      </div>
    ),
    size,
  );
}

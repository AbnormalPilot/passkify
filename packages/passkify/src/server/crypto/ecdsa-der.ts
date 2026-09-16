/**
 * ECDSA signature format conversion, and the strictest parser in this package.
 *
 * WebAuthn authenticators emit ECDSA signatures as ASN.1 DER — `SEQUENCE { r,
 * s }`. WebCrypto's `subtle.verify` accepts only IEEE P1363, the fixed-width
 * concatenation `r ‖ s`. Node's legacy `crypto.verify` quietly accepts DER,
 * which is why this conversion did not exist before the move to WebCrypto.
 *
 * Every ECDSA login in the world flows through this file, so it is written to
 * reject rather than repair. A lenient DER reader here is a signature
 * malleability bug: if two distinct byte strings both decode to the same (r, s),
 * an attacker can take a signature they observed and produce a different one
 * that still verifies, which breaks any system that treats a signature as an
 * identifier. The rules below are what closes that off:
 *
 *   - the outer SEQUENCE must span the whole input, with nothing trailing
 *   - every length must be in the minimal form DER requires
 *   - every INTEGER must be minimally encoded: no redundant leading 0x00, and
 *     no missing one either (a value whose top bit is set is negative without
 *     the pad byte, and negative r or s is not a signature)
 *   - r and s must be in [1, n-1] — zero is degenerate, and ≥ n is a second
 *     encoding of a smaller value
 */

import { PasskeyError } from '../../shared/errors.js';

/** Coordinate width and group order per curve, both in the units we need. */
interface CurveParameters {
  /** Byte width of one coordinate: 32 for P-256, 48 for P-384, 66 for P-521. */
  size: number;
  /** The group order `n`. Signatures with r or s at or above it are invalid. */
  order: bigint;
}

export const CURVES = {
  'P-256': {
    size: 32,
    order: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  },
  'P-384': {
    size: 48,
    order:
      0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
  },
  'P-521': {
    size: 66,
    order:
      0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
  },
} as const satisfies Record<string, CurveParameters>;

export type CurveName = keyof typeof CURVES;

function fail(message: string): never {
  throw new PasskeyError('bad_signature', `malformed ECDSA signature: ${message}`);
}

/**
 * Read one DER INTEGER at `offset`, returning its value and the offset after it.
 *
 * Rejects every non-minimal encoding, because accepting them is what makes
 * signatures malleable.
 */
function readInteger(input: Uint8Array, offset: number): { value: bigint; next: number } {
  if (offset >= input.length) fail('truncated before an INTEGER');
  if (input[offset] !== 0x02)
    fail(`expected an INTEGER tag, found 0x${input[offset].toString(16)}`);

  const lengthOffset = offset + 1;
  if (lengthOffset >= input.length) fail('truncated in an INTEGER length');

  const length = input[lengthOffset];
  // Only the short form is legal here: r and s are at most 66 bytes, so a
  // multi-byte length is by definition non-minimal.
  if (length & 0x80) fail('INTEGER length is not in the minimal short form');
  if (length === 0) fail('INTEGER has zero length');

  const start = lengthOffset + 1;
  const end = start + length;
  if (end > input.length) fail('INTEGER runs past the end of the signature');

  const bytes = input.subarray(start, end);

  if (bytes[0] & 0x80) fail('INTEGER is negative');
  if (bytes[0] === 0x00) {
    if (bytes.length === 1) fail('INTEGER is zero');
    if (!(bytes[1] & 0x80)) fail('INTEGER has a redundant leading zero byte');
  }

  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  return { value, next: end };
}

/** Write `value` big-endian into exactly `size` bytes. */
function toFixedWidth(value: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let remaining = value;
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  // Unreachable for values already range-checked against the curve order, but
  // a silent truncation here would be a verification bypass.
  if (remaining !== 0n) fail('value does not fit the curve coordinate size');
  return out;
}

/**
 * Convert a DER-encoded ECDSA signature to the fixed-width `r ‖ s` form
 * `crypto.subtle.verify` requires.
 *
 * Throws `PasskeyError('bad_signature')` for anything that is not a single,
 * minimally-encoded, in-range signature for `curve`.
 */
export function derToP1363(signature: Uint8Array, curve: CurveName): Uint8Array {
  const { size, order } = CURVES[curve];

  if (signature.length < 8) fail('too short to be a DER sequence');
  if (signature[0] !== 0x30) fail('does not start with a SEQUENCE tag');

  // P-521 signatures carry ~138 content bytes, so the long form is not just
  // legal there, it is required. What must hold either way is minimality: the
  // shortest encoding that fits, and no other.
  let declaredLength: number;
  let contentStart: number;

  if ((signature[1] & 0x80) === 0) {
    declaredLength = signature[1];
    contentStart = 2;
  } else {
    const lengthBytes = signature[1] & 0x7f;
    if (lengthBytes === 0) fail('SEQUENCE uses the indefinite length form');
    // Two bytes covers 65535, far past any signature; more is non-minimal.
    if (lengthBytes > 2) fail('SEQUENCE length is longer than any signature needs');
    if (2 + lengthBytes > signature.length) fail('truncated in the SEQUENCE length');

    declaredLength = 0;
    for (let i = 0; i < lengthBytes; i++) declaredLength = (declaredLength << 8) | signature[2 + i];

    if (declaredLength < 0x80) fail('SEQUENCE length should have used the short form');
    if (lengthBytes === 2 && declaredLength < 0x100) {
      fail('SEQUENCE length uses more bytes than it needs');
    }
    contentStart = 2 + lengthBytes;
  }

  if (contentStart + declaredLength !== signature.length) {
    fail('SEQUENCE length does not match the signature length');
  }

  const r = readInteger(signature, contentStart);
  const s = readInteger(signature, r.next);

  if (s.next !== signature.length) fail('trailing bytes after the second INTEGER');

  if (r.value <= 0n || r.value >= order) fail('r is outside [1, n-1]');
  if (s.value <= 0n || s.value >= order) fail('s is outside [1, n-1]');

  const out = new Uint8Array(size * 2);
  out.set(toFixedWidth(r.value, size), 0);
  out.set(toFixedWidth(s.value, size), size);
  return out;
}

/**
 * The inverse, for tests and for anything that needs to hand a DER signature to
 * a legacy verifier. Not used on the verification path.
 */
export function p1363ToDer(signature: Uint8Array, curve: CurveName): Uint8Array {
  const { size } = CURVES[curve];
  if (signature.length !== size * 2) {
    fail(`expected ${size * 2} bytes for ${curve}, got ${signature.length}`);
  }

  const encodeInteger = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0x00) start++;
    const trimmed = Array.from(bytes.subarray(start));
    if (trimmed[0] & 0x80) trimmed.unshift(0x00);
    return [0x02, trimmed.length, ...trimmed];
  };

  const body = [
    ...encodeInteger(signature.subarray(0, size)),
    ...encodeInteger(signature.subarray(size)),
  ];
  const header = body.length < 0x80 ? [0x30, body.length] : [0x30, 0x81, body.length];
  if (body.length > 0xff) fail('encoded signature is longer than any curve produces');
  return new Uint8Array([...header, ...body]);
}

/**
 * Randomness, over WebCrypto.
 *
 * `getRandomValues` is the cryptographically secure generator on every runtime
 * this package targets. `Math.random` appears nowhere in this package and must
 * not: a predictable challenge defeats the entire ceremony.
 */

import { crypto } from './provider.js';

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * A v4 UUID. `crypto.randomUUID` is present on every target runtime, but it is
 * absent in a few older embedded builds, so this falls back to constructing one
 * from `getRandomValues` rather than failing.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

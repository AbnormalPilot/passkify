/**
 * Hashing, over WebCrypto.
 *
 * `subtle.digest` is asynchronous where `createHash().digest()` was not, which
 * is the single largest ripple in the move off `node:crypto` — it makes the
 * ceremony verifiers async all the way down. They already were, at their public
 * edge, so the cost lands only on the low-level exports.
 */

import { crypto } from './provider.js';

export type DigestName = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export async function digest(name: DigestName, data: Uint8Array): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest(name, data as unknown as BufferSource);
  return new Uint8Array(buffer);
}

/** The one every ceremony needs: rpIdHash, clientDataHash, the signature base. */
export function sha256(data: Uint8Array): Promise<Uint8Array> {
  return digest('SHA-256', data);
}

/**
 * The one place this package reaches for crypto.
 *
 * There is no runtime fork here, and that is deliberate. An earlier version had
 * one — a `#crypto` subpath import resolving to `node:crypto` on Node and
 * `globalThis.crypto` everywhere else — which existed for exactly one reason:
 * `globalThis.crypto` was not on by default until Node 19.
 *
 * Node 18 reached end of life in April 2025. Carrying a conditional-exports
 * seam, two provider modules and an `imports` map that bundlers disagree about
 * how to resolve, all to support a runtime nobody should still be running, is a
 * bad trade in a library whose crypto path is the product. So: one module, one
 * global, every runtime.
 *
 * `globalThis.crypto.subtle` is present on Node 20+, Bun, Deno, Cloudflare
 * Workers, Vercel Edge and every browser in a secure context.
 */

import { PasskeyError } from '../../shared/errors.js';

export interface CryptoProvider {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?(): string;
}

const globalCrypto = (globalThis as { crypto?: Crypto }).crypto;

if (!globalCrypto?.subtle) {
  throw new PasskeyError(
    'configuration_error',
    'passkify needs WebCrypto (globalThis.crypto.subtle), which is not available here. ' +
      'On Node this means a version older than 20 — passkify requires Node 20 or newer. ' +
      'In a browser it means an insecure context; WebCrypto needs https, or localhost.',
  );
}

export const crypto: CryptoProvider = globalCrypto as unknown as CryptoProvider;

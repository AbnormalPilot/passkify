/**
 * passkify — passkeys for your website, without the WebAuthn homework.
 *
 * The root entry point re-exports the **server** API, because that is what
 * `import ... from 'passkify'` resolves to in a Node process.
 *
 * The browser half lives at `passkify/client`:
 *
 * ```js
 * import { PasskeyServer, MemoryStore } from 'passkify';        // Node
 * import { register, login } from 'passkify/client';            // browser
 * ```
 *
 * Import `passkify/client` in browser code, not this module. It used to be
 * impossible to get wrong — the root pulled in `node:crypto` and a browser
 * build died on it. Since verification moved to WebCrypto the root bundles
 * perfectly happily, at roughly six times the size of the client half, so the
 * mistake now ships instead of failing. Nothing here enforces it.
 */

export * from './server/index.js';

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
 * Importing this module from browser code will fail — it pulls in
 * `node:crypto`. That is deliberate: it fails at build time rather than
 * shipping a broken bundle.
 */

export * from './server/index.js';

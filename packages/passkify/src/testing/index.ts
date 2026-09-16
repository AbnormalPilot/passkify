/**
 * `passkify/testing` — a software authenticator for your own test suite.
 *
 * WebAuthn is unusually hard to test: the ceremony needs a browser, a secure
 * context and a real authenticator, so most suites either skip it or mock the
 * verification away — which tests nothing, because verification is the entire
 * product.
 *
 * This is the authenticator passkify's own suite uses. It assembles
 * authenticator data byte by byte from the specification's field layout and
 * signs with real keys, so it exercises your server exactly as a Touch ID
 * sensor or a YubiKey would. And it can misbehave on purpose:
 *
 * ```ts
 * import { VirtualAuthenticator } from 'passkify/testing';
 *
 * const authenticator = new VirtualAuthenticator({ rpId: 'example.com' });
 *
 * const { options } = await passkeys.startRegistration({ username: 'ada' });
 * await passkeys.finishRegistration(
 *   authenticator.create({ challenge: options.challenge, origin: 'https://example.com' }),
 * );
 *
 * // Now prove your error handling works, which is the part that never gets tested:
 * await expect(
 *   passkeys.finishRegistration(
 *     authenticator.create({
 *       challenge: options.challenge,
 *       origin: 'https://example.com',
 *       tamper: { origin: 'https://phishing.example' },
 *     }),
 *   ),
 * ).rejects.toMatchObject({ code: 'origin_mismatch' });
 * ```
 *
 * It is a test double, not a security boundary — it uses `node:crypto` for key
 * generation and is not intended to run in production.
 */

export { VirtualAuthenticator, FLAG } from './virtual-authenticator.js';
export type {
  AuthenticatorOptions,
  CreateOptions,
  AssertOptions,
  SupportedAlgorithm,
} from './virtual-authenticator.js';
export { encodeCBOR, type Encodable } from './cbor-encode.js';

/**
 * `passkify/server` — everything you need on the Node side.
 *
 * ```js
 * import { PasskeyServer, MemoryStore } from 'passkify/server';
 *
 * const passkeys = new PasskeyServer({
 *   rpName: 'Acme',
 *   origin: 'http://localhost:3000',
 *   store: new MemoryStore(),
 * });
 * ```
 */

export { PasskeyServer, type PublicCredentialInfo } from './passkey-server.js';

export {
  MemoryStore,
  type PasskeyStore,
  type PasskeyUser,
  type PasskeyCredential,
  type PasskeyChallenge,
  type ChallengeKind,
} from './store.js';

export type { PasskeyServerConfig, PasskeyHooks } from './config.js';

export type {
  StartRegistrationInput,
  StartRegistrationResult,
  VerifyRegistrationResult,
} from './registration.js';

export type {
  StartAuthenticationInput,
  StartAuthenticationResult,
  VerifyAuthenticationResult,
} from './authentication.js';

export type { ExpressAdapterOptions } from './http/express.js';
export type { FetchAdapterOptions } from './http/fetch.js';

export type { AttestationResult, AttestationType } from './crypto/attestation.js';
export type { OriginMatcher } from './crypto/client-data.js';

export { PasskeyError, isPasskeyError, type PasskeyErrorCode } from '../shared/errors.js';

/**
 * The verification checks, as data.
 *
 * Both verifiers index into this table, and the test suite fails if the two
 * disagree in either direction — so it describes what the code does, not what
 * it did when someone last wrote it down. Render your own documentation from
 * it if you like; passkify's own does.
 */
export {
  VERIFICATION_CHECKS,
  REGISTRATION_CHECKS,
  AUTHENTICATION_CHECKS,
  checksFor,
  getCheck,
  type VerificationCheck,
  type Ceremony,
} from '../shared/checks.js';
export type { CheckEvent, CheckObserver } from '../shared/trace.js';

export {
  COSEAlgorithm,
  type RegistrationOptionsJSON,
  type AuthenticationOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportName,
  type UserVerificationRequirementName,
  type ResidentKeyRequirementName,
  type Base64URLString,
} from '../shared/types.js';

/**
 * Low-level primitives, exposed for people building something unusual —
 * an authenticator emulator, a migration script, a debugging tool.
 * The high-level API above is what you want for a website.
 */
export { parseAuthenticatorData } from './crypto/authenticator-data.js';
export { parseClientData } from './crypto/client-data.js';
export { parseCOSEPublicKey, verifySignature, algorithmName } from './crypto/cose.js';
export { decode as decodeCBOR, decodeFirst as decodeCBORFirst } from './crypto/cbor.js';
export { toBase64Url, fromBase64Url } from '../shared/base64url.js';
export { Certificate, chainIsTrusted, OID as CertificateOID } from './crypto/x509.js';
export { derToP1363, p1363ToDer } from './crypto/ecdsa-der.js';

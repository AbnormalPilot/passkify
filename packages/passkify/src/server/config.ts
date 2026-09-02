/**
 * Configuration, and the validation that catches the mistakes people actually
 * make.
 *
 * Almost every "passkeys don't work" report comes down to one of two things:
 * an `rpID` that is not a registrable suffix of the page's origin, or an
 * `origin` list that does not include the port the app is really served on.
 * Both are checked here, at construction time, with an error that says what to
 * change — rather than surfacing as an opaque `NotAllowedError` in the browser
 * three days later.
 */

import { PasskeyError } from '../shared/errors.js';
import {
  DEFAULT_PUB_KEY_CRED_PARAMS,
  type AttestationConveyancePreferenceName,
  type ResidentKeyRequirementName,
  type UserVerificationRequirementName,
  type AttachmentName,
} from '../shared/types.js';
import type { OriginMatcher } from './crypto/client-data.js';
import type { PasskeyStore, PasskeyCredential, PasskeyUser } from './store.js';

export interface PasskeyServerConfig {
  /**
   * Human-readable site name shown in the OS passkey prompt.
   * Keep it short: "Acme", not "Acme Corporation Customer Portal".
   */
  rpName: string;

  /**
   * The origin(s) your login page is served from, scheme and port included:
   * `https://example.com`, or `http://localhost:3000` in development.
   *
   * Pass every origin you serve the ceremony from. Exact strings are strongly
   * preferred; a `RegExp` or predicate is accepted for wildcard-subdomain
   * setups, but a loose pattern here is the fastest way to hand an attacker
   * your users' credentials, so anchor it (`/^https:\/\/[a-z0-9-]+\.example\.com$/`).
   */
  origin: string | readonly OriginMatcher[];

  /**
   * The Relying Party ID: the domain your passkeys are bound to. Defaults to
   * the hostname of the first string origin.
   *
   * It must be the origin's host or a parent domain of it — `example.com`
   * works for `https://app.example.com`, `app.example.com` does not work for
   * `https://example.com`. Set it to your apex domain if you ever want one
   * passkey to work across subdomains; you cannot change it later without
   * invalidating every credential.
   */
  rpID?: string;

  /** Where credentials, users and challenges live. See `PasskeyStore`. */
  store: PasskeyStore;

  /**
   * Whether the authenticator must verify the human (PIN, biometric) rather
   * than just their presence (a tap).
   *
   * `'preferred'` (default) asks for verification and accepts a response
   * without it. Use `'required'` if a passkey is your only factor — but know
   * that it turns some older security keys into a dead end.
   */
  userVerification?: UserVerificationRequirementName;

  /**
   * Whether the credential is discoverable — i.e. whether it can be used to
   * sign in without typing a username first. Defaults to `'preferred'`, which
   * is what makes usernameless login work where supported without breaking
   * authenticators with limited storage.
   */
  residentKey?: ResidentKeyRequirementName;

  /** Restrict to platform (Touch ID / Windows Hello) or roaming (USB key) authenticators. */
  authenticatorAttachment?: AttachmentName;

  /**
   * Attestation conveyance. Leave at `'none'`.
   *
   * Requesting attestation shows an extra scary consent prompt on some
   * platforms, and consumer passkey providers return an anonymous statement
   * anyway. Only change this if you are an enterprise pinning specific
   * authenticator models, in which case also set `attestationRootCertificates`.
   */
  attestation?: AttestationConveyancePreferenceName;

  /** Root certificates to validate attestation chains against. */
  attestationRootCertificates?: readonly (string | Uint8Array)[];

  /** How long the browser prompt stays open, in milliseconds. Default 60000. */
  timeout?: number;

  /** How long a challenge stays valid server-side, in ms. Default 300000 (5 minutes). */
  challengeTimeout?: number;

  /** Challenge size in bytes. Default 32. The spec's floor is 16. */
  challengeSize?: number;

  /**
   * COSE algorithms offered to authenticators, best first.
   * Defaults to ES256 then RS256, which covers every shipping passkey provider.
   */
  supportedAlgorithms?: readonly number[];

  /**
   * Reject credentials that cannot sync between devices (most hardware keys).
   * Off by default — turning it on locks out YubiKey users.
   */
  requireBackupEligible?: boolean;

  /** Called after a successful ceremony. Throwing from a hook fails the ceremony. */
  hooks?: PasskeyHooks;
}

export interface PasskeyHooks {
  /** A new credential was registered and stored. */
  onRegistered?: (event: {
    user: PasskeyUser;
    credential: PasskeyCredential;
    isNewUser: boolean;
  }) => void | Promise<void>;

  /** A login succeeded. Set your session cookie here. */
  onAuthenticated?: (event: {
    user: PasskeyUser;
    credential: PasskeyCredential;
  }) => void | Promise<void>;

  /**
   * A credential's signature counter went backwards, which can mean the
   * authenticator was cloned. Default behaviour is to reject the login; supply
   * this hook to log, alert, or return `true` to allow it anyway.
   */
  onCounterRegression?: (event: {
    user: PasskeyUser;
    credential: PasskeyCredential;
    storedCounter: number;
    presentedCounter: number;
  }) => boolean | Promise<boolean>;
}

/** Config with every default filled in. */
export interface ResolvedConfig {
  rpName: string;
  rpID: string;
  origins: readonly OriginMatcher[];
  store: PasskeyStore;
  userVerification: UserVerificationRequirementName;
  residentKey: ResidentKeyRequirementName;
  authenticatorAttachment?: AttachmentName;
  attestation: AttestationConveyancePreferenceName;
  attestationRootCertificates: readonly (string | Uint8Array)[];
  timeout: number;
  challengeTimeout: number;
  challengeSize: number;
  supportedAlgorithms: readonly number[];
  requireBackupEligible: boolean;
  hooks: PasskeyHooks;
}

function configError(message: string): never {
  throw new PasskeyError('configuration_error', message);
}

/** `sub.example.com` is covered by `example.com`; the reverse is not true. */
function isRegistrableSuffix(host: string, rpID: string): boolean {
  return host === rpID || host.endsWith(`.${rpID}`);
}

export function resolveConfig(config: PasskeyServerConfig): ResolvedConfig {
  if (!config || typeof config !== 'object') {
    configError('passkify needs a configuration object');
  }
  if (!config.rpName || typeof config.rpName !== 'string') {
    configError('rpName is required — it is the site name shown in the passkey prompt');
  }
  if (!config.store) {
    configError(
      'store is required. Use `new MemoryStore()` to try things out, then implement ' +
        'PasskeyStore against your database before shipping.',
    );
  }

  const origins: OriginMatcher[] = Array.isArray(config.origin)
    ? [...(config.origin as OriginMatcher[])]
    : [config.origin as OriginMatcher];

  if (origins.length === 0) {
    configError('at least one origin is required');
  }

  const stringOrigins: URL[] = [];
  for (const origin of origins) {
    if (typeof origin !== 'string') {
      continue;
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return configError(
        `origin "${origin}" is not a URL. It needs the scheme and, if non-default, the port — ` +
          `for example "https://example.com" or "http://localhost:3000".`,
      );
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      configError(
        `origin "${origin}" must be just scheme + host + port, with no path — try "${url.origin}".`,
      );
    }
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocalhost) {
      configError(
        `origin "${origin}" is not secure. WebAuthn only runs on HTTPS, with localhost as the ` +
          `sole exception. Use a tunnel (ngrok, cloudflared) to test on a device.`,
      );
    }
    stringOrigins.push(url);
  }

  let rpID = config.rpID;
  if (!rpID) {
    const first = stringOrigins[0];
    if (!first) {
      configError(
        'rpID could not be derived because no origin was given as a plain string. ' +
          'Set rpID explicitly when using a RegExp or function origin matcher.',
      );
    }
    rpID = first.hostname;
  }

  if (rpID.includes(':') || rpID.includes('/')) {
    configError(
      `rpID "${rpID}" must be a bare domain — no scheme, no port, no path. ` +
        `Did you mean "${rpID.replace(/^https?:\/\//, '').split(/[:/]/)[0]}"?`,
    );
  }

  for (const url of stringOrigins) {
    if (!isRegistrableSuffix(url.hostname, rpID)) {
      configError(
        `rpID "${rpID}" is not valid for origin "${url.origin}". The rpID must be the origin's ` +
          `host or one of its parent domains. For this origin, use rpID "${url.hostname}"` +
          (url.hostname.split('.').length > 2
            ? ` or a parent such as "${url.hostname.split('.').slice(-2).join('.')}".`
            : '.'),
      );
    }
  }

  const challengeSize = config.challengeSize ?? 32;
  if (challengeSize < 16) {
    configError('challengeSize must be at least 16 bytes (the WebAuthn minimum)');
  }

  const supportedAlgorithms =
    config.supportedAlgorithms ?? DEFAULT_PUB_KEY_CRED_PARAMS.map((param) => param.alg);
  if (supportedAlgorithms.length === 0) {
    configError('supportedAlgorithms cannot be empty');
  }

  return {
    rpName: config.rpName,
    rpID,
    origins,
    store: config.store,
    userVerification: config.userVerification ?? 'preferred',
    residentKey: config.residentKey ?? 'preferred',
    authenticatorAttachment: config.authenticatorAttachment,
    attestation: config.attestation ?? 'none',
    attestationRootCertificates: config.attestationRootCertificates ?? [],
    timeout: config.timeout ?? 60_000,
    challengeTimeout: config.challengeTimeout ?? 300_000,
    challengeSize,
    supportedAlgorithms,
    requireBackupEligible: config.requireBackupEligible ?? false,
    hooks: config.hooks ?? {},
  };
}

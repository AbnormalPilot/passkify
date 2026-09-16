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
import { isSupportedAlgorithm } from './crypto/cose.js';
import type { CheckObserver } from '../shared/trace.js';
import { buildRelatedOrigins, type RelatedOriginsConfig } from './related-origin.js';
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

  /**
   * Return the full list of checks each ceremony ran, on the verification
   * result, and call `hooks.onCheck` as each one is decided.
   *
   * For documentation, debugging and teaching. Off by default and worth leaving
   * off in production: a trace describes your verification path, and there is
   * no reason to hand one to arbitrary callers.
   */
  explain?: boolean;

  /**
   * Steer the browser's UI toward a kind of authenticator (WebAuthn Level 3).
   *
   * `'client-device'` for the platform authenticator, `'security-key'` for a
   * roaming key, `'hybrid'` for a phone. A *hint*, not a constraint — the
   * browser may ignore it, and `authenticatorAttachment` is the thing that
   * actually restricts what is accepted.
   */
  hints?: readonly ('security-key' | 'client-device' | 'hybrid')[];

  /**
   * WebAuthn extensions to request on every ceremony.
   *
   * `credProps` is requested automatically. `prf` is the interesting one — it
   * derives a stable secret from the passkey, which is how a site builds
   * end-to-end encryption on top of one. If you use it, design the recovery
   * path first: a user with one authenticator and no escrow who loses it has
   * lost the data, not just the login.
   */
  extensions?: Record<string, unknown>;

  /**
   * Publish `/.well-known/webauthn` so one passkey works across your other
   * domains (WebAuthn Level 3 Related Origin Requests).
   *
   * The list is derived from `origin` — there is deliberately no second list to
   * keep in sync, because a file that disagrees with the server fails silently
   * and only in one direction. Every `origin` entry must therefore be a plain
   * string; a RegExp or predicate is refused here.
   *
   * Browsers stop after five distinct registrable labels. Pass
   * `{ labels: [...] }` if passkify cannot work yours out from the hostnames.
   */
  relatedOrigins?: boolean | RelatedOriginsConfig;

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

  /**
   * Called as each verification check is decided, in order, pass or fail.
   *
   * The `id` is a `VERIFICATION_CHECKS` entry, so a consumer can join against
   * the registry for the title, the specification reference and the
   * consequence. Synchronous and never awaited — it must not slow a ceremony
   * down, and it must not throw.
   */
  onCheck?: CheckObserver;
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
  explain: boolean;
  relatedOrigins: RelatedOriginsConfig | null;
  hints: readonly string[];
  extensions: Record<string, unknown>;
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

  // Normally every origin must sit under the rpID — that constraint is what
  // stops a credential minted for one site being accepted by another.
  //
  // Related Origin Requests are the specification's own exception to it: the
  // whole point is that `example.de` can use a credential scoped to
  // `example.com`. So when they are enabled, at least one origin must still be
  // under the rpID (otherwise the rpID belongs to nobody), and the rest are
  // the related ones, published for the browser to check against.
  const relatedOriginsEnabled =
    config.relatedOrigins !== undefined && config.relatedOrigins !== false;
  const underRpID = stringOrigins.filter((url) => isRegistrableSuffix(url.hostname, rpID));

  if (relatedOriginsEnabled) {
    if (underRpID.length === 0) {
      configError(
        `rpID "${rpID}" does not match any configured origin. With relatedOrigins enabled the ` +
          `rpID still has to belong to one of them — usually your primary domain — and the ` +
          `others are the related origins published to /.well-known/webauthn.`,
      );
    }
  } else {
    for (const url of stringOrigins) {
      if (!isRegistrableSuffix(url.hostname, rpID)) {
        configError(
          `rpID "${rpID}" is not valid for origin "${url.origin}". The rpID must be the origin's ` +
            `host or one of its parent domains. For this origin, use rpID "${url.hostname}"` +
            (url.hostname.split('.').length > 2
              ? ` or a parent such as "${url.hostname.split('.').slice(-2).join('.')}".`
              : '.') +
            ` If these are genuinely different domains you own, enable relatedOrigins.`,
        );
      }
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
  // Offering an algorithm we cannot verify is worse than not offering it: the
  // credential registers, and then every login with it fails forever. Better to
  // refuse at construction, where the message is readable and nobody is locked
  // out yet.
  //
  // RS1 (-65535, RSA with SHA-1) reaches this since 1.0. It used to be
  // verifiable, which meant a site could opt into SHA-1 signature checking.
  for (const alg of supportedAlgorithms) {
    if (!isSupportedAlgorithm(alg)) {
      const name =
        alg === -65535 ? 'RS1 (RSA with SHA-1), which passkify no longer verifies' : `${alg}`;
      configError(
        `supportedAlgorithms contains ${name}. ` +
          'Remove it — an algorithm passkify cannot verify would register credentials ' +
          'that can never be used to sign in.',
      );
    }
  }

  return {
    rpName: config.rpName,
    rpID,
    origins,
    store: config.store,
    userVerification: config.userVerification ?? 'preferred',
    residentKey: config.residentKey ?? 'preferred',
    authenticatorAttachment: config.authenticatorAttachment,
    explain: config.explain ?? false,
    hints: config.hints ?? [],
    extensions: config.extensions ?? {},
    relatedOrigins:
      config.relatedOrigins === true
        ? {}
        : config.relatedOrigins === false || config.relatedOrigins === undefined
          ? null
          : config.relatedOrigins,
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

/**
 * Checks that cannot run until the whole config is resolved.
 *
 * Kept separate so `resolveConfig` stays a pure translation, and called from
 * the `PasskeyServer` constructor — the point is that these fail while someone
 * is looking at a terminal, not on a browser's first `/.well-known` fetch.
 */
export function assertResolvedConfig(resolved: ResolvedConfig): void {
  if (resolved.relatedOrigins) {
    buildRelatedOrigins(resolved.rpID, resolved.origins, resolved.relatedOrigins);
  }
}

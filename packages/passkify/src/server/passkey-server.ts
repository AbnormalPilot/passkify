/**
 * `PasskeyServer` — the one object you construct.
 *
 * Four methods do the whole job:
 *
 *   startRegistration  -> options   ->  browser
 *   finishRegistration <- response  <-  browser
 *   startAuthentication-> options   ->  browser
 *   finishAuthentication<- response <-  browser
 *
 * If you would rather not write those four routes yourself, `.express()` and
 * `.handler()` mount them for you.
 */

import { PasskeyError } from '../shared/errors.js';
import { toBase64Url, utf8ToBytes } from '../shared/base64url.js';
import {
  resolveConfig,
  assertResolvedConfig,
  type PasskeyServerConfig,
  type ResolvedConfig,
} from './config.js';
import { buildRelatedOrigins, WELL_KNOWN_WEBAUTHN_PATH } from './related-origin.js';
import {
  createRegistrationOptions,
  verifyRegistration,
  type StartRegistrationInput,
  type StartRegistrationResult,
  type VerifyRegistrationResult,
} from './registration.js';
import {
  createAuthenticationOptions,
  verifyAuthentication,
  type StartAuthenticationInput,
  type StartAuthenticationResult,
  type VerifyAuthenticationResult,
} from './authentication.js';
import type { PasskeyCredential, PasskeyStore } from './store.js';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '../shared/types.js';
import { createExpressMiddleware, type ExpressAdapterOptions } from './http/express.js';
import { createFetchHandler, type FetchAdapterOptions } from './http/fetch.js';

/** A credential as it is safe to show a user in account settings. */
export interface PublicCredentialInfo {
  id: string;
  nickname?: string;
  /** `multiDevice` credentials sync; `singleDevice` ones live on one authenticator. */
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: string[];
  aaguid: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

export class PasskeyServer {
  private readonly config: ResolvedConfig;

  constructor(config: PasskeyServerConfig) {
    this.config = resolveConfig(config);
    assertResolvedConfig(this.config);
  }

  /** The Relying Party ID in force. Handy when debugging an `rpid_mismatch`. */
  get rpID(): string {
    return this.config.rpID;
  }

  /** The store this server was constructed with. */
  get store(): PasskeyStore {
    return this.config.store;
  }

  /** True when this server publishes a Related Origin Requests file. */
  get publishesRelatedOrigins(): boolean {
    return this.config.relatedOrigins !== null;
  }

  /**
   * The body of `/.well-known/webauthn`, for serving it yourself.
   *
   * The adapters mount this automatically at the site root — it is a fixed
   * absolute path and cannot live under `basePath`. Use this directly if your
   * `/.well-known` routes are handled elsewhere, or write it to a static file
   * at build time.
   *
   * Returns `null` when `relatedOrigins` is off.
   */
  relatedOrigins(): { origins: string[] } | null {
    if (!this.config.relatedOrigins) return null;
    return buildRelatedOrigins(this.config.rpID, this.config.origins, this.config.relatedOrigins);
  }

  /** The path browsers fetch: `/.well-known/webauthn`. Fixed by the specification. */
  static readonly wellKnownPath = WELL_KNOWN_WEBAUTHN_PATH;

  /**
   * Everything the browser needs to reconcile its passkey list for one account.
   *
   * WebAuthn Level 3 lets a page tell the platform which credentials still
   * exist (`signalAllAcceptedCredentials`) and what the account is called
   * (`signalCurrentUserDetails`). Without it, a passkey the user deleted on
   * your site sits in their OS picker forever, and picking it fails.
   *
   * Returns `null` when the account has no credentials. That is deliberate and
   * important: an empty `allAcceptedCredentialIds` is not "nothing to say", it
   * is an instruction to the platform to **delete every passkey for this user**.
   * A store returning nothing because of a bug must not become mass credential
   * deletion, so the caller is given nothing to signal rather than an empty list.
   */
  async signals(userId: string): Promise<{
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
    allAcceptedCredentialIds: string[];
  } | null> {
    const user = await this.config.store.getUserById(userId);
    if (!user) {
      throw new PasskeyError('unknown_user', `no account with id "${userId}"`);
    }

    const credentials = await this.config.store.listCredentialsByUserId(userId);
    if (credentials.length === 0) return null;

    return {
      rpId: this.config.rpID,
      userId: toBase64Url(utf8ToBytes(user.id)),
      name: user.username,
      displayName: user.displayName,
      allAcceptedCredentialIds: credentials.map((credential) => credential.id),
    };
  }

  /**
   * Begin registering a passkey.
   *
   * Pass `{ username }` to create a new account, or `{ userId }` — from an
   * authenticated session — to add another passkey to an existing one.
   * Send the returned `options` to the browser verbatim.
   */
  startRegistration(input: StartRegistrationInput): Promise<StartRegistrationResult> {
    return createRegistrationOptions(this.config, input);
  }

  /**
   * Verify what the browser sent back and store the new credential.
   * Throws `PasskeyError` on any failure; never returns `verified: false`.
   */
  finishRegistration(response: RegistrationResponseJSON): Promise<VerifyRegistrationResult> {
    return verifyRegistration(this.config, response);
  }

  /**
   * Begin a login. Call with no arguments for the usernameless flow, which is
   * what you want unless you have a specific reason otherwise.
   */
  startAuthentication(input?: StartAuthenticationInput): Promise<StartAuthenticationResult> {
    return createAuthenticationOptions(this.config, input);
  }

  /**
   * Verify an assertion. On success the returned `user` is authenticated —
   * establish your session (cookie, JWT, whatever you already use) from here.
   */
  finishAuthentication(response: AuthenticationResponseJSON): Promise<VerifyAuthenticationResult> {
    return verifyAuthentication(this.config, response);
  }

  /** Every passkey on an account, shaped for an account-settings page. */
  async listCredentials(userId: string): Promise<PublicCredentialInfo[]> {
    const credentials = await this.config.store.listCredentialsByUserId(userId);
    return credentials.map(toPublicInfo);
  }

  /**
   * Remove one passkey from an account.
   *
   * `userId` is required and checked: without it, knowing a credential ID
   * would be enough to delete someone else's passkey.
   */
  async deleteCredential(userId: string, credentialId: string): Promise<void> {
    const credential = await this.config.store.getCredentialById(credentialId);
    if (!credential || credential.userId !== userId) {
      throw new PasskeyError('unknown_credential', 'no such passkey on this account');
    }
    const remaining = await this.config.store.listCredentialsByUserId(userId);
    if (remaining.length <= 1) {
      throw new PasskeyError(
        'last_credential',
        'refusing to remove the last passkey on this account, which would lock the user out. ' +
          'Register a replacement first, or delete the account instead.',
      );
    }
    await this.config.store.deleteCredential(credentialId);
  }

  /** Give a passkey a human label, e.g. "Work laptop". */
  async renameCredential(userId: string, credentialId: string, nickname: string): Promise<void> {
    const credential = await this.config.store.getCredentialById(credentialId);
    if (!credential || credential.userId !== userId) {
      throw new PasskeyError('unknown_credential', 'no such passkey on this account');
    }
    await this.config.store.updateCredential(credentialId, { nickname: nickname.slice(0, 128) });
  }

  /**
   * Express / Connect middleware mounting all four routes.
   *
   * ```js
   * app.use(passkeys.express());
   * ```
   */
  express(options: ExpressAdapterOptions = {}) {
    return createExpressMiddleware(this, options);
  }

  /**
   * A `(Request) => Promise<Response>` handler for Next.js route handlers,
   * Hono, Bun, Deno, Cloudflare Workers and anything else built on fetch.
   */
  handler(options: FetchAdapterOptions = {}) {
    return createFetchHandler(this, options);
  }
}

function toPublicInfo(credential: PasskeyCredential): PublicCredentialInfo {
  return {
    id: credential.id,
    nickname: credential.nickname,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    transports: credential.transports,
    aaguid: credential.aaguid,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
  };
}

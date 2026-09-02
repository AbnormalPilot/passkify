/**
 * The persistence contract.
 *
 * passkify never touches a database directly. You implement `PasskeyStore`
 * against whatever you already use — Postgres, Prisma, Drizzle, Mongo, Redis,
 * a JSON file — and the library calls it. `MemoryStore` below is a complete
 * implementation you can read in one sitting and use as a template.
 *
 * Only eight methods matter, and none of them need transactions.
 */

import { PasskeyError } from '../shared/errors.js';
import type { AuthenticatorTransportName, Base64URLString } from '../shared/types.js';

/**
 * An account that can own passkeys.
 *
 * `id` becomes the WebAuthn user handle, which is sent back to your server on
 * every usernameless login. Two rules follow from that:
 *
 *  1. It must be stable forever — changing it orphans every existing passkey.
 *  2. It must not be personal data. Use a UUID or a random string, never an
 *     email address or a username; user handles are stored in the clear on the
 *     authenticator and are readable by any site the credential is scoped to.
 *
 * It also has to fit in 64 bytes once UTF-8 encoded.
 */
export interface PasskeyUser {
  id: string;
  /** What the user types to identify themselves, and what the passkey is labelled with. */
  username: string;
  /** Shown in the OS passkey picker. Falls back to `username`. */
  displayName: string;
}

/** A registered credential. One row per passkey per account. */
export interface PasskeyCredential {
  /** base64url credential ID. Unique across all users — index this column. */
  id: Base64URLString;
  userId: string;
  /** base64url COSE_Key bytes exactly as the authenticator produced them. */
  publicKey: Base64URLString;
  /** COSE algorithm identifier, e.g. -7 for ES256. */
  algorithm: number;
  /** Signature counter. Zero for most passkeys, which do not implement one. */
  counter: number;
  /** How the browser said this authenticator can be reached next time. */
  transports?: AuthenticatorTransportName[];
  /** `multiDevice` means a syncing passkey (iCloud Keychain, Google Password Manager, ...). */
  deviceType: 'singleDevice' | 'multiDevice';
  /** Whether the credential is currently backed up to the provider's cloud. */
  backedUp: boolean;
  /** Authenticator model UUID. All-zeroes when the authenticator declines to say. */
  aaguid: string;
  createdAt: Date;
  lastUsedAt?: Date;
  /** Optional user-facing label, e.g. "MacBook Pro Touch ID". */
  nickname?: string;
}

export type ChallengeKind = 'registration' | 'authentication';

/** A challenge issued to a browser, awaiting its signed response. */
export interface PasskeyChallenge {
  /** base64url challenge bytes. Also the primary key. */
  challenge: Base64URLString;
  kind: ChallengeKind;
  /** Set for registrations and for username-first logins; absent for usernameless. */
  userId?: string;
  expiresAt: Date;
  /** Ceremony parameters that must survive until verification. */
  context?: Record<string, unknown>;
}

/**
 * Implement this against your database.
 *
 * Every method is async. Returning `null` for a missing row is correct;
 * throwing is reserved for genuine infrastructure failures.
 */
export interface PasskeyStore {
  /** Look up an account by the username the visitor typed. */
  getUserByUsername(username: string): Promise<PasskeyUser | null>;

  /** Look up an account by its user handle (`PasskeyUser.id`). */
  getUserById(id: string): Promise<PasskeyUser | null>;

  /**
   * Create an account. Called during registration when no account exists yet.
   *
   * **Persist `input.id` verbatim as the account's user handle.** passkify
   * generated it before the browser prompt appeared, and the authenticator has
   * already stored it — if you substitute your own ID here, usernameless login
   * will never find the account again. If you need your own primary key, keep
   * it as a separate column and index `id` alongside it.
   */
  createUser(input: { id: string; username: string; displayName: string }): Promise<PasskeyUser>;

  /** Persist a newly registered credential. */
  createCredential(credential: PasskeyCredential): Promise<void>;

  /** Fetch a credential by its base64url ID, across all users. */
  getCredentialById(id: Base64URLString): Promise<PasskeyCredential | null>;

  /** Every credential belonging to one account. */
  listCredentialsByUserId(userId: string): Promise<PasskeyCredential[]>;

  /** Record a successful login: bump the counter and the timestamps. */
  updateCredential(
    id: Base64URLString,
    changes: Partial<Pick<PasskeyCredential, 'counter' | 'lastUsedAt' | 'backedUp' | 'nickname'>>,
  ): Promise<void>;

  /** Remove a credential. Used when a visitor revokes a device. */
  deleteCredential(id: Base64URLString): Promise<void>;

  /**
   * Store an outstanding challenge.
   *
   * If your store has TTL support (Redis `EX`, Mongo TTL indexes), use it —
   * passkify also checks `expiresAt` itself, so expiry is enforced either way.
   */
  saveChallenge(challenge: PasskeyChallenge): Promise<void>;

  /**
   * Fetch **and delete** a challenge, atomically if your database can.
   *
   * Deleting on read is what makes challenges single-use, which is what stops
   * a captured response from being replayed. Returning an already-consumed
   * challenge a second time is a real vulnerability, so prefer a
   * `DELETE ... RETURNING *` (Postgres) or `GETDEL` (Redis) over read-then-delete.
   */
  takeChallenge(challenge: Base64URLString): Promise<PasskeyChallenge | null>;
}

/**
 * An in-memory `PasskeyStore`.
 *
 * Good for local development, tests and demos. Not for production: everything
 * disappears on restart, and nothing is shared between processes — with more
 * than one worker, a challenge issued by worker A cannot be found by worker B
 * and every other login fails. Swap in a real store before you ship.
 */
export class MemoryStore implements PasskeyStore {
  private readonly users = new Map<string, PasskeyUser>();
  private readonly usersByUsername = new Map<string, string>();
  private readonly credentials = new Map<string, PasskeyCredential>();
  private readonly credentialsByUser = new Map<string, Set<string>>();
  private readonly challenges = new Map<string, PasskeyChallenge>();

  /** Case-insensitive username matching, which is what visitors expect. */
  private key(username: string): string {
    return username.trim().toLowerCase();
  }

  async getUserByUsername(username: string): Promise<PasskeyUser | null> {
    const id = this.usersByUsername.get(this.key(username));
    return id ? (this.users.get(id) ?? null) : null;
  }

  async getUserById(id: string): Promise<PasskeyUser | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(input: {
    id: string;
    username: string;
    displayName: string;
  }): Promise<PasskeyUser> {
    const key = this.key(input.username);
    if (this.usersByUsername.has(key)) {
      throw new PasskeyError('credential_exists', `username "${input.username}" is taken`);
    }
    const user: PasskeyUser = {
      id: input.id,
      username: input.username,
      displayName: input.displayName || input.username,
    };
    this.users.set(user.id, user);
    this.usersByUsername.set(key, user.id);
    return user;
  }

  async createCredential(credential: PasskeyCredential): Promise<void> {
    if (this.credentials.has(credential.id)) {
      throw new PasskeyError('credential_exists', 'that credential is already registered');
    }
    this.credentials.set(credential.id, { ...credential });
    let owned = this.credentialsByUser.get(credential.userId);
    if (!owned) {
      owned = new Set();
      this.credentialsByUser.set(credential.userId, owned);
    }
    owned.add(credential.id);
  }

  async getCredentialById(id: string): Promise<PasskeyCredential | null> {
    const found = this.credentials.get(id);
    return found ? { ...found } : null;
  }

  async listCredentialsByUserId(userId: string): Promise<PasskeyCredential[]> {
    const ids = this.credentialsByUser.get(userId);
    if (!ids) {
      return [];
    }
    const out: PasskeyCredential[] = [];
    for (const id of ids) {
      const credential = this.credentials.get(id);
      if (credential) {
        out.push({ ...credential });
      }
    }
    return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async updateCredential(
    id: string,
    changes: Partial<Pick<PasskeyCredential, 'counter' | 'lastUsedAt' | 'backedUp' | 'nickname'>>,
  ): Promise<void> {
    const credential = this.credentials.get(id);
    if (!credential) {
      throw new PasskeyError('unknown_credential', 'no such credential');
    }
    this.credentials.set(id, { ...credential, ...changes });
  }

  async deleteCredential(id: string): Promise<void> {
    const credential = this.credentials.get(id);
    if (!credential) {
      return;
    }
    this.credentials.delete(id);
    this.credentialsByUser.get(credential.userId)?.delete(id);
  }

  async saveChallenge(challenge: PasskeyChallenge): Promise<void> {
    this.sweep();
    this.challenges.set(challenge.challenge, { ...challenge });
  }

  async takeChallenge(challenge: string): Promise<PasskeyChallenge | null> {
    const found = this.challenges.get(challenge);
    // Delete unconditionally: one challenge, one attempt, success or failure.
    this.challenges.delete(challenge);
    if (!found) {
      return null;
    }
    return found.expiresAt.getTime() < Date.now() ? null : found;
  }

  /** Drop expired challenges. Called on write, so no timer is left running. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.challenges) {
      if (value.expiresAt.getTime() < now) {
        this.challenges.delete(key);
      }
    }
  }

  /** Test helper: wipe everything. */
  reset(): void {
    this.users.clear();
    this.usersByUsername.clear();
    this.credentials.clear();
    this.credentialsByUser.clear();
    this.challenges.clear();
  }
}

/**
 * A `PasskeyStore` over MongoDB.
 *
 * Takes the `Db` you already have; the driver is a type-only import, so it is
 * not a dependency of this package.
 *
 * `findOneAndDelete` is what makes challenges safe here: one round trip, atomic
 * at the document level, so two concurrent requests cannot both take the same
 * challenge.
 *
 * Create these indexes once — the TTL one in particular, which is what expires
 * challenges without a sweeper:
 *
 * ```js
 * await db.collection('passkey_users').createIndex({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
 * await db.collection('passkey_credentials').createIndex({ userId: 1, createdAt: 1 });
 * await db.collection('passkey_challenges').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
 * ```
 */

import { PasskeyError } from '../shared/errors.js';
import type {
  PasskeyStore,
  PasskeyUser,
  PasskeyCredential,
  PasskeyChallenge,
} from '../server/store.js';

/** The slice of the MongoDB driver this adapter uses. */
export interface MongoCollectionLike<T> {
  findOne(filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<T | null>;
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): { toArray(): Promise<T[]> };
  insertOne(document: T): Promise<unknown>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
  replaceOne(
    filter: Record<string, unknown>,
    replacement: T,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  findOneAndDelete(filter: Record<string, unknown>): Promise<T | null | { value: T | null }>;
}

export interface MongoDbLike {
  collection<T = Record<string, unknown>>(name: string): MongoCollectionLike<T>;
}

export interface MongoStoreOptions {
  collections?: { users?: string; credentials?: string; challenges?: string };
}

/** MongoDB reports a duplicate key as error code 11000. */
function isDuplicateKey(error: unknown): boolean {
  const code = (error as { code?: number }).code;
  return code === 11000 || code === 11001;
}

/**
 * The driver changed `findOneAndDelete`'s return shape between major versions:
 * v5 and earlier wrap it in `{ value }`, v6 returns the document. Handle both
 * rather than pinning a version this package does not depend on.
 */
function unwrap<T>(result: T | null | { value: T | null }): T | null {
  if (result && typeof result === 'object' && 'value' in result) {
    return (result as { value: T | null }).value;
  }
  return (result as T | null) ?? null;
}

export function mongoStore(db: MongoDbLike, options: MongoStoreOptions = {}): PasskeyStore {
  const users = db.collection<PasskeyUser & { _id?: unknown }>(
    options.collections?.users ?? 'passkey_users',
  );
  const credentials = db.collection<PasskeyCredential & { _id?: unknown }>(
    options.collections?.credentials ?? 'passkey_credentials',
  );
  const challenges = db.collection<PasskeyChallenge & { _id?: unknown }>(
    options.collections?.challenges ?? 'passkey_challenges',
  );

  const clean = <T extends { _id?: unknown }>(document: T | null): Omit<T, '_id'> | null => {
    if (!document) return null;
    const { _id, ...rest } = document;
    void _id;
    return rest as Omit<T, '_id'>;
  };

  return {
    async getUserById(id) {
      return clean(await users.findOne({ id })) as PasskeyUser | null;
    },

    async getUserByUsername(username) {
      // Collation gives case-insensitive matching without a second lower-cased
      // column. It must match the collation on the unique index.
      const found = await users.findOne({ username }, { collation: { locale: 'en', strength: 2 } });
      return clean(found) as PasskeyUser | null;
    },

    async createUser(input) {
      const user: PasskeyUser = {
        id: input.id,
        username: input.username,
        displayName: input.displayName,
      };
      try {
        await users.insertOne(user);
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new PasskeyError('credential_exists', 'that username is already taken', {
            cause: error,
          });
        }
        throw error;
      }
      return user;
    },

    async createCredential(credential) {
      try {
        await credentials.insertOne(credential);
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new PasskeyError('credential_exists', 'that passkey is already registered', {
            cause: error,
          });
        }
        throw error;
      }
    },

    async getCredentialById(id) {
      const found = clean(await credentials.findOne({ id })) as PasskeyCredential | null;
      return found ? { ...found, createdAt: new Date(found.createdAt) } : null;
    },

    async listCredentialsByUserId(userId) {
      const found = await credentials.find({ userId }, { sort: { createdAt: 1, id: 1 } }).toArray();
      return found.map((credential) => {
        const cleaned = clean(credential) as PasskeyCredential;
        return { ...cleaned, createdAt: new Date(cleaned.createdAt) };
      });
    },

    async updateCredential(id, changes) {
      // Only the supplied keys, so a counter update cannot clobber the key.
      const set: Record<string, unknown> = {};
      if (changes.counter !== undefined) set.counter = changes.counter;
      if (changes.lastUsedAt !== undefined) set.lastUsedAt = changes.lastUsedAt;
      if (changes.backedUp !== undefined) set.backedUp = changes.backedUp;
      if (changes.nickname !== undefined) set.nickname = changes.nickname;
      if (Object.keys(set).length === 0) return;

      const result = await credentials.updateOne({ id }, { $set: set });
      if (result.matchedCount === 0) {
        throw new PasskeyError('unknown_credential', `no credential with id "${id}"`);
      }
    },

    async deleteCredential(id) {
      await credentials.deleteOne({ id });
    },

    async saveChallenge(challenge) {
      await challenges.replaceOne({ challenge: challenge.challenge }, challenge, { upsert: true });
    },

    async takeChallenge(challenge) {
      // Atomic at the document level: exactly one concurrent caller gets it.
      const taken = unwrap(await challenges.findOneAndDelete({ challenge }));
      const cleaned = clean(taken) as PasskeyChallenge | null;
      if (!cleaned) return null;

      const expiresAt = new Date(cleaned.expiresAt);
      // Deleted either way. The TTL index removes stragglers, but it runs on a
      // sixty-second sweep, so an expired challenge can still be read first.
      if (expiresAt.getTime() < Date.now()) return null;
      return { ...cleaned, expiresAt };
    },
  };
}

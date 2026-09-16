/**
 * A `PasskeyStore` over Redis.
 *
 * Works with `ioredis`, `node-redis` and Upstash — the structural interface
 * below is what they have in common, so none of them is a dependency here.
 *
 * Redis earns its place for challenges specifically: `GETDEL` is atomic, and
 * key expiry is the engine's job rather than a sweeper of yours. It is a less
 * obvious fit for users and credentials, which are relational and are queried
 * by things other than their primary key — hence the secondary index sets
 * below. For a site of any size, keep users in your existing database and use
 * this only if Redis *is* your database.
 */

import { PasskeyError } from '../shared/errors.js';
import type {
  PasskeyStore,
  PasskeyUser,
  PasskeyCredential,
  PasskeyChallenge,
} from '../server/store.js';

/** What ioredis, node-redis and Upstash all provide. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  /** `SET key value NX` — the atomic "only if absent" that uniqueness needs. */
  setnx?(key: string, value: string): Promise<number>;
  /** Atomic get-and-delete. Redis 6.2+. Emulated with a transaction if absent. */
  getdel?(key: string): Promise<string | null>;
  multi?: () => { get(key: string): unknown; del(key: string): unknown; exec(): Promise<unknown> };
}

export interface RedisStoreOptions {
  /** Key prefix, so passkify's keys are obvious in `SCAN` output. Default `passkey:`. */
  prefix?: string;
}

export function redisStore(redis: RedisLike, options: RedisStoreOptions = {}): PasskeyStore {
  const prefix = options.prefix ?? 'passkey:';
  const userKey = (id: string) => `${prefix}user:${id}`;
  const usernameKey = (username: string) => `${prefix}username:${username.toLowerCase()}`;
  const credentialKey = (id: string) => `${prefix}cred:${id}`;
  const userCredentialsKey = (userId: string) => `${prefix}user:${userId}:creds`;
  const challengeKey = (challenge: string) => `${prefix}challenge:${challenge}`;

  const readJson = async <T>(key: string): Promise<T | null> => {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  };

  return {
    async getUserById(id) {
      return readJson<PasskeyUser>(userKey(id));
    },

    async getUserByUsername(username) {
      const id = await redis.get(usernameKey(username));
      return id ? readJson<PasskeyUser>(userKey(id)) : null;
    },

    async createUser(input) {
      const user: PasskeyUser = {
        id: input.id,
        username: input.username,
        displayName: input.displayName,
      };

      // The username index is claimed first, with NX, so two concurrent
      // sign-ups for the same name cannot both win.
      const claimed = redis.setnx
        ? await redis.setnx(usernameKey(input.username), input.id)
        : (await redis.set(usernameKey(input.username), input.id, 'NX'))
          ? 1
          : 0;

      if (!claimed) {
        throw new PasskeyError('credential_exists', 'that username is already taken');
      }

      await redis.set(userKey(input.id), JSON.stringify(user));
      return user;
    },

    async createCredential(credential) {
      const key = credentialKey(credential.id);
      const claimed = redis.setnx
        ? await redis.setnx(key, JSON.stringify(credential))
        : (await redis.set(key, JSON.stringify(credential), 'NX'))
          ? 1
          : 0;

      if (!claimed) {
        throw new PasskeyError('credential_exists', 'that passkey is already registered');
      }
      await redis.sadd(userCredentialsKey(credential.userId), credential.id);
    },

    async getCredentialById(id) {
      const stored = await readJson<PasskeyCredential>(credentialKey(id));
      return stored ? { ...stored, createdAt: new Date(stored.createdAt) } : null;
    },

    async listCredentialsByUserId(userId) {
      const ids = await redis.smembers(userCredentialsKey(userId));
      const found = await Promise.all(
        ids.map((id) => readJson<PasskeyCredential>(credentialKey(id))),
      );
      return found
        .filter((credential): credential is PasskeyCredential => credential !== null)
        .map((credential) => ({
          ...credential,
          createdAt: new Date(credential.createdAt),
          ...(credential.lastUsedAt ? { lastUsedAt: new Date(credential.lastUsedAt) } : {}),
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },

    async updateCredential(id, changes) {
      const stored = await readJson<PasskeyCredential>(credentialKey(id));
      if (!stored) {
        throw new PasskeyError('unknown_credential', `no credential with id "${id}"`);
      }
      await redis.set(credentialKey(id), JSON.stringify({ ...stored, ...changes }));
    },

    async deleteCredential(id) {
      const stored = await readJson<PasskeyCredential>(credentialKey(id));
      if (!stored) return;
      await redis.del(credentialKey(id));
      await redis.srem(userCredentialsKey(stored.userId), id);
    },

    async saveChallenge(challenge) {
      const ttlSeconds = Math.max(
        1,
        Math.ceil((challenge.expiresAt.getTime() - Date.now()) / 1000),
      );
      // Expiry is Redis's job. There is no sweeper to forget to run.
      await redis.set(
        challengeKey(challenge.challenge),
        JSON.stringify(challenge),
        'EX',
        ttlSeconds,
      );
    },

    async takeChallenge(challenge) {
      const key = challengeKey(challenge);

      // GETDEL is the whole reason Redis suits challenges: one atomic
      // operation, so two concurrent requests cannot both take the same one.
      let raw: string | null;
      if (typeof redis.getdel === 'function') {
        raw = await redis.getdel(key);
      } else if (redis.multi) {
        // Older Redis: a MULTI/EXEC transaction is still atomic.
        const transaction = redis.multi();
        transaction.get(key);
        transaction.del(key);
        const results = (await transaction.exec()) as unknown;
        raw = extractFirstReply(results);
      } else {
        throw new PasskeyError(
          'configuration_error',
          'this Redis client exposes neither GETDEL nor MULTI, so challenges cannot be taken ' +
            'atomically. A non-atomic take permits replay, so passkify refuses rather than ' +
            'appearing to work.',
        );
      }

      if (!raw) return null;
      const stored = JSON.parse(raw) as PasskeyChallenge;
      const expiresAt = new Date(stored.expiresAt);
      if (expiresAt.getTime() < Date.now()) return null;
      return { ...stored, expiresAt };
    },
  };
}

/** Both client families shape `exec()` results differently. */
function extractFirstReply(results: unknown): string | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  // ioredis: [[error, value], ...]. node-redis: [value, ...].
  if (Array.isArray(first)) return (first[1] as string | null) ?? null;
  return (first as string | null) ?? null;
}

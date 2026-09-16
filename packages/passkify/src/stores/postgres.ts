/**
 * A `PasskeyStore` over PostgreSQL.
 *
 * Takes the pool you already have. `pg` and `postgres.js` both satisfy the tiny
 * structural interface below, so neither is a dependency of this package — the
 * query function is passed in, not imported. That is how `passkify` ships store
 * adapters and still installs nothing.
 *
 * The one implementation detail worth reading: `takeChallenge` is a single
 * `DELETE ... RETURNING`. Fetching and then deleting would let two concurrent
 * requests both see the same challenge, which is precisely the replay the
 * challenge exists to prevent — and it is the mistake the conformance suite
 * exists to catch.
 */

import { PasskeyError } from '../shared/errors.js';
import { POSTGRES_SCHEMA } from './schema.js';
import type {
  PasskeyStore,
  PasskeyUser,
  PasskeyCredential,
  PasskeyChallenge,
  ChallengeKind,
} from '../server/store.js';

/**
 * The shape both `pg.Pool` and a `postgres.js` wrapper satisfy.
 *
 * Deliberately minimal: anything that can run a parameterised query and return
 * rows will do, including a hand-rolled adapter over a driver we have never
 * heard of.
 */
export interface PostgresQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface PostgresStoreOptions {
  /** Override if your tables are named differently. */
  tables?: { users?: string; credentials?: string; challenges?: string };
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  algorithm: number;
  counter: string | number;
  transports: string[] | null;
  device_type: string;
  backed_up: boolean;
  aaguid: string | null;
  nickname: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

interface ChallengeRow {
  challenge: string;
  kind: string;
  user_id: string | null;
  context: Record<string, unknown> | null;
  expires_at: Date;
}

/** Postgres reports a unique-constraint violation as SQLSTATE 23505. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}

function toUser(row: UserRow): PasskeyUser {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

function toCredential(row: CredentialRow): PasskeyCredential {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    algorithm: row.algorithm,
    // `bigint` comes back as a string from `pg` by default, because a 64-bit
    // integer does not fit a JavaScript number. The counter is 32-bit, so the
    // conversion is safe — but it has to be done.
    counter: Number(row.counter),
    ...(row.transports?.length ? { transports: row.transports as never } : {}),
    deviceType: row.device_type as PasskeyCredential['deviceType'],
    backedUp: row.backed_up,
    aaguid: row.aaguid ?? '00000000-0000-0000-0000-000000000000',
    ...(row.nickname ? { nickname: row.nickname } : {}),
    createdAt: new Date(row.created_at),
    ...(row.last_used_at ? { lastUsedAt: new Date(row.last_used_at) } : {}),
  };
}

/**
 * Build a `PasskeyStore` over a Postgres connection.
 *
 * ```ts
 * import { Pool } from 'pg';
 * import { postgresStore } from 'passkify/stores/postgres';
 *
 * const store = postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));
 * ```
 *
 * Run {@link POSTGRES_SCHEMA} once as a migration, or call `store.migrate()` in
 * development.
 */
export function postgresStore(
  db: PostgresQueryable,
  options: PostgresStoreOptions = {},
): PasskeyStore & { migrate(): Promise<void>; deleteExpiredChallenges(): Promise<number> } {
  const users = options.tables?.users ?? 'passkey_users';
  const credentials = options.tables?.credentials ?? 'passkey_credentials';
  const challenges = options.tables?.challenges ?? 'passkey_challenges';

  return {
    async migrate() {
      await db.query(POSTGRES_SCHEMA);
    },

    async getUserByUsername(username) {
      const { rows } = await db.query<UserRow>(
        `SELECT id, username, display_name FROM ${users} WHERE lower(username) = lower($1)`,
        [username],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async getUserById(id) {
      const { rows } = await db.query<UserRow>(
        `SELECT id, username, display_name FROM ${users} WHERE id = $1`,
        [id],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async createUser(input) {
      try {
        const { rows } = await db.query<UserRow>(
          `INSERT INTO ${users} (id, username, display_name)
           VALUES ($1, $2, $3)
           RETURNING id, username, display_name`,
          [input.id, input.username, input.displayName],
        );
        return toUser(rows[0]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PasskeyError('credential_exists', 'that username is already taken', {
            cause: error,
          });
        }
        throw error;
      }
    },

    async createCredential(credential) {
      try {
        await db.query(
          `INSERT INTO ${credentials}
             (id, user_id, public_key, algorithm, counter, transports,
              device_type, backed_up, aaguid, nickname, created_at, last_used_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            credential.id,
            credential.userId,
            credential.publicKey,
            credential.algorithm,
            credential.counter,
            credential.transports ?? null,
            credential.deviceType,
            credential.backedUp,
            credential.aaguid ?? null,
            credential.nickname ?? null,
            credential.createdAt,
            credential.lastUsedAt ?? null,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PasskeyError('credential_exists', 'that passkey is already registered', {
            cause: error,
          });
        }
        throw error;
      }
    },

    async getCredentialById(id) {
      const { rows } = await db.query<CredentialRow>(`SELECT * FROM ${credentials} WHERE id = $1`, [
        id,
      ]);
      return rows[0] ? toCredential(rows[0]) : null;
    },

    async listCredentialsByUserId(userId) {
      const { rows } = await db.query<CredentialRow>(
        `SELECT * FROM ${credentials} WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
        [userId],
      );
      return rows.map(toCredential);
    },

    async updateCredential(id, changes) {
      // Built from only the keys supplied, so a counter update cannot clobber
      // the public key.
      const columns: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        columns.push(`${column} = $${values.length}`);
      };

      if (changes.counter !== undefined) set('counter', changes.counter);
      if (changes.lastUsedAt !== undefined) set('last_used_at', changes.lastUsedAt);
      if (changes.backedUp !== undefined) set('backed_up', changes.backedUp);
      if (changes.nickname !== undefined) set('nickname', changes.nickname);
      if (columns.length === 0) return;

      values.push(id);
      const { rows } = await db.query<{ id: string }>(
        `UPDATE ${credentials} SET ${columns.join(', ')} WHERE id = $${values.length} RETURNING id`,
        values,
      );
      if (rows.length === 0) {
        throw new PasskeyError('unknown_credential', `no credential with id "${id}"`);
      }
    },

    async deleteCredential(id) {
      await db.query(`DELETE FROM ${credentials} WHERE id = $1`, [id]);
    },

    async saveChallenge(challenge) {
      await db.query(
        `INSERT INTO ${challenges} (challenge, kind, user_id, context, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (challenge) DO UPDATE
           SET kind = EXCLUDED.kind,
               user_id = EXCLUDED.user_id,
               context = EXCLUDED.context,
               expires_at = EXCLUDED.expires_at`,
        [
          challenge.challenge,
          challenge.kind,
          challenge.userId ?? null,
          challenge.context ? JSON.stringify(challenge.context) : null,
          challenge.expiresAt,
        ],
      );
    },

    async takeChallenge(challenge) {
      // One statement. `SELECT` then `DELETE` would let two concurrent requests
      // both receive the same challenge, which is the replay this is meant to
      // stop — and `DELETE ... RETURNING` costs nothing extra to get right.
      const { rows } = await db.query<ChallengeRow>(
        `DELETE FROM ${challenges} WHERE challenge = $1 RETURNING *`,
        [challenge],
      );
      const row = rows[0];
      if (!row) return null;

      // Deleted either way — an expired challenge is spent, not reusable.
      if (new Date(row.expires_at).getTime() < Date.now()) return null;

      const result: PasskeyChallenge = {
        challenge: row.challenge,
        kind: row.kind as ChallengeKind,
        expiresAt: new Date(row.expires_at),
        ...(row.user_id ? { userId: row.user_id } : {}),
        ...(row.context ? { context: row.context } : {}),
      };
      return result;
    },

    /** Housekeeping. Call it on a schedule; nothing breaks if you never do. */
    async deleteExpiredChallenges() {
      const { rows } = await db.query<{ challenge: string }>(
        `DELETE FROM ${challenges} WHERE expires_at < now() RETURNING challenge`,
      );
      return rows.length;
    },
  };
}

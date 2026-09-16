/**
 * A `PasskeyStore` over SQLite.
 *
 * Works with `node:sqlite` (Node 22.5+), `better-sqlite3` and `bun:sqlite` —
 * the structural interface below is what they share. Cloudflare D1 has a
 * different, async shape and gets its own adapter.
 *
 * Requires SQLite **3.35 or newer** for `DELETE ... RETURNING`, which is what
 * makes `takeChallenge` a single atomic statement. Every runtime listed above
 * bundles a newer version than that; the check below is for the unusual case
 * of an older system library.
 */

import { PasskeyError } from '../shared/errors.js';
import { SQLITE_SCHEMA } from './schema.js';
import type {
  PasskeyStore,
  PasskeyUser,
  PasskeyCredential,
  PasskeyChallenge,
  ChallengeKind,
} from '../server/store.js';

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

/** What node:sqlite, better-sqlite3 and bun:sqlite have in common. */
export interface SqliteLike {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
}

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  algorithm: number;
  counter: number;
  transports: string | null;
  device_type: string;
  backed_up: number;
  aaguid: string | null;
  nickname: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** SQLite reports a uniqueness failure in the message rather than a code. */
function isUnique(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function toCredential(row: CredentialRow): PasskeyCredential {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    algorithm: row.algorithm,
    counter: row.counter,
    ...(row.transports ? { transports: JSON.parse(row.transports) } : {}),
    deviceType: row.device_type as PasskeyCredential['deviceType'],
    // SQLite has no boolean type; 0 and 1 are what comes back.
    backedUp: row.backed_up === 1,
    aaguid: row.aaguid ?? '00000000-0000-0000-0000-000000000000',
    ...(row.nickname ? { nickname: row.nickname } : {}),
    createdAt: new Date(row.created_at),
    ...(row.last_used_at ? { lastUsedAt: new Date(row.last_used_at) } : {}),
  };
}

export function sqliteStore(
  db: SqliteLike,
): PasskeyStore & { migrate(): void; deleteExpiredChallenges(): number } {
  return {
    migrate() {
      db.exec(SQLITE_SCHEMA);
    },

    async getUserById(id) {
      const row = db.prepare('SELECT * FROM passkey_users WHERE id = ?').get(id) as
        | { id: string; username: string; display_name: string }
        | undefined;
      return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
    },

    async getUserByUsername(username) {
      const row = db
        .prepare('SELECT * FROM passkey_users WHERE lower(username) = lower(?)')
        .get(username) as { id: string; username: string; display_name: string } | undefined;
      return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
    },

    async createUser(input) {
      try {
        db.prepare(
          'INSERT INTO passkey_users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)',
        ).run(input.id, input.username, input.displayName, new Date().toISOString());
      } catch (error) {
        if (isUnique(error)) {
          throw new PasskeyError('credential_exists', 'that username is already taken', {
            cause: error,
          });
        }
        throw error;
      }
      const user: PasskeyUser = {
        id: input.id,
        username: input.username,
        displayName: input.displayName,
      };
      return user;
    },

    async createCredential(credential) {
      try {
        db.prepare(
          `INSERT INTO passkey_credentials
             (id, user_id, public_key, algorithm, counter, transports, device_type,
              backed_up, aaguid, nickname, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          credential.id,
          credential.userId,
          credential.publicKey,
          credential.algorithm,
          credential.counter,
          credential.transports?.length ? JSON.stringify(credential.transports) : null,
          credential.deviceType,
          credential.backedUp ? 1 : 0,
          credential.aaguid ?? null,
          credential.nickname ?? null,
          credential.createdAt.toISOString(),
          credential.lastUsedAt?.toISOString() ?? null,
        );
      } catch (error) {
        if (isUnique(error)) {
          throw new PasskeyError('credential_exists', 'that passkey is already registered', {
            cause: error,
          });
        }
        throw error;
      }
    },

    async getCredentialById(id) {
      const row = db.prepare('SELECT * FROM passkey_credentials WHERE id = ?').get(id) as
        | CredentialRow
        | undefined;
      return row ? toCredential(row) : null;
    },

    async listCredentialsByUserId(userId) {
      const rows = db
        .prepare('SELECT * FROM passkey_credentials WHERE user_id = ? ORDER BY created_at, id')
        .all(userId) as CredentialRow[];
      return rows.map(toCredential);
    },

    async updateCredential(id, changes) {
      // Built from only the keys supplied, so a counter update cannot clobber
      // the public key.
      const columns: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        columns.push(`${column} = ?`);
        values.push(value);
      };

      if (changes.counter !== undefined) set('counter', changes.counter);
      if (changes.lastUsedAt !== undefined) {
        set('last_used_at', changes.lastUsedAt?.toISOString() ?? null);
      }
      if (changes.backedUp !== undefined) set('backed_up', changes.backedUp ? 1 : 0);
      if (changes.nickname !== undefined) set('nickname', changes.nickname ?? null);
      if (columns.length === 0) return;

      values.push(id);
      const rows = db
        .prepare(`UPDATE passkey_credentials SET ${columns.join(', ')} WHERE id = ? RETURNING id`)
        .all(...values);
      if (rows.length === 0) {
        throw new PasskeyError('unknown_credential', `no credential with id "${id}"`);
      }
    },

    async deleteCredential(id) {
      db.prepare('DELETE FROM passkey_credentials WHERE id = ?').run(id);
    },

    async saveChallenge(challenge) {
      db.prepare(
        `INSERT INTO passkey_challenges (challenge, kind, user_id, context, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(challenge) DO UPDATE SET
           kind = excluded.kind,
           user_id = excluded.user_id,
           context = excluded.context,
           expires_at = excluded.expires_at`,
      ).run(
        challenge.challenge,
        challenge.kind,
        challenge.userId ?? null,
        challenge.context ? JSON.stringify(challenge.context) : null,
        challenge.expiresAt.toISOString(),
      );
    },

    async takeChallenge(challenge) {
      // One statement, so concurrent callers cannot both win. SQLite is
      // single-writer, which helps, but a SELECT-then-DELETE would still race
      // across connections.
      const rows = db
        .prepare('DELETE FROM passkey_challenges WHERE challenge = ? RETURNING *')
        .all(challenge) as {
        challenge: string;
        kind: string;
        user_id: string | null;
        context: string | null;
        expires_at: string;
      }[];

      const row = rows[0];
      if (!row) return null;

      const expiresAt = new Date(row.expires_at);
      if (expiresAt.getTime() < Date.now()) return null;

      const result: PasskeyChallenge = {
        challenge: row.challenge,
        kind: row.kind as ChallengeKind,
        expiresAt,
        ...(row.user_id ? { userId: row.user_id } : {}),
        ...(row.context ? { context: JSON.parse(row.context) } : {}),
      };
      return result;
    },

    deleteExpiredChallenges() {
      const rows = db
        .prepare('DELETE FROM passkey_challenges WHERE expires_at < ? RETURNING challenge')
        .all(new Date().toISOString());
      return rows.length;
    },
  };
}

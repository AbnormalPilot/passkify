/**
 * A `PasskeyStore` over Prisma.
 *
 * Prisma's client type is generated per project, so there is nothing stable to
 * `import type` — and importing `@prisma/client` at all would make it a
 * dependency. Instead this takes a *structural* shape that any generated client
 * satisfies: three delegates with the methods used below. Your real client
 * fits it without a cast.
 *
 * Add the models from {@link PRISMA_SCHEMA} to your `schema.prisma` and migrate.
 */

import { PasskeyError } from '../shared/errors.js';
import type {
  PasskeyStore,
  PasskeyUser,
  PasskeyCredential,
  PasskeyChallenge,
  ChallengeKind,
} from '../server/store.js';

type Where = Record<string, unknown>;

interface Delegate<T> {
  findUnique(args: { where: Where }): Promise<T | null>;
  findFirst?(args: { where: Where }): Promise<T | null>;
  findMany(args: { where: Where; orderBy?: unknown }): Promise<T[]>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  update(args: { where: Where; data: Record<string, unknown> }): Promise<T>;
  delete(args: { where: Where }): Promise<T>;
  deleteMany(args: { where: Where }): Promise<{ count: number }>;
  upsert(args: {
    where: Where;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<T>;
}

/** The three delegates this adapter needs. A generated client satisfies it. */
export interface PrismaPasskeyClient {
  passkeyUser: Delegate<Record<string, unknown>>;
  passkeyCredential: Delegate<Record<string, unknown>>;
  passkeyChallenge: Delegate<Record<string, unknown>>;
}

/** Prisma reports a unique-constraint violation as P2002, and a miss as P2025. */
const isUnique = (error: unknown) => (error as { code?: string })?.code === 'P2002';
const isMissing = (error: unknown) => (error as { code?: string })?.code === 'P2025';

function toUser(row: Record<string, unknown>): PasskeyUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.displayName),
  };
}

function toCredential(row: Record<string, unknown>): PasskeyCredential {
  return {
    id: String(row.id),
    userId: String(row.userId),
    publicKey: String(row.publicKey),
    algorithm: Number(row.algorithm),
    // `BigInt` in the schema, because the column is a 64-bit counter. The value
    // is 32-bit, so this is safe — but Number() has to be explicit.
    counter: Number(row.counter),
    ...(Array.isArray(row.transports) && row.transports.length
      ? { transports: row.transports as never }
      : {}),
    deviceType: row.deviceType as PasskeyCredential['deviceType'],
    backedUp: Boolean(row.backedUp),
    aaguid: (row.aaguid as string) ?? '00000000-0000-0000-0000-000000000000',
    ...(row.nickname ? { nickname: String(row.nickname) } : {}),
    createdAt: new Date(row.createdAt as string),
    ...(row.lastUsedAt ? { lastUsedAt: new Date(row.lastUsedAt as string) } : {}),
  };
}

export function prismaStore(prisma: PrismaPasskeyClient): PasskeyStore {
  return {
    async getUserById(id) {
      const row = await prisma.passkeyUser.findUnique({ where: { id } });
      return row ? toUser(row) : null;
    },

    async getUserByUsername(username) {
      // `mode: 'insensitive'` is Postgres-only in Prisma. On other providers
      // this matches exactly, which the conformance suite marks as a
      // recommended-not-required behaviour.
      const row =
        (await prisma.passkeyUser.findFirst?.({
          where: { username: { equals: username, mode: 'insensitive' } },
        })) ?? (await prisma.passkeyUser.findUnique({ where: { username } }));
      return row ? toUser(row) : null;
    },

    async createUser(input) {
      try {
        const row = await prisma.passkeyUser.create({
          data: { id: input.id, username: input.username, displayName: input.displayName },
        });
        return toUser(row);
      } catch (error) {
        if (isUnique(error)) {
          throw new PasskeyError('credential_exists', 'that username is already taken', {
            cause: error,
          });
        }
        throw error;
      }
    },

    async createCredential(credential) {
      try {
        await prisma.passkeyCredential.create({
          data: {
            id: credential.id,
            userId: credential.userId,
            publicKey: credential.publicKey,
            algorithm: credential.algorithm,
            counter: credential.counter,
            transports: credential.transports ?? [],
            deviceType: credential.deviceType,
            backedUp: credential.backedUp,
            aaguid: credential.aaguid ?? null,
            nickname: credential.nickname ?? null,
            createdAt: credential.createdAt,
            lastUsedAt: credential.lastUsedAt ?? null,
          },
        });
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
      const row = await prisma.passkeyCredential.findUnique({ where: { id } });
      return row ? toCredential(row) : null;
    },

    async listCredentialsByUserId(userId) {
      const rows = await prisma.passkeyCredential.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toCredential);
    },

    async updateCredential(id, changes) {
      const data: Record<string, unknown> = {};
      if (changes.counter !== undefined) data.counter = changes.counter;
      if (changes.lastUsedAt !== undefined) data.lastUsedAt = changes.lastUsedAt;
      if (changes.backedUp !== undefined) data.backedUp = changes.backedUp;
      if (changes.nickname !== undefined) data.nickname = changes.nickname;
      if (Object.keys(data).length === 0) return;

      try {
        await prisma.passkeyCredential.update({ where: { id }, data });
      } catch (error) {
        if (isMissing(error)) {
          throw new PasskeyError('unknown_credential', `no credential with id "${id}"`, {
            cause: error,
          });
        }
        throw error;
      }
    },

    async deleteCredential(id) {
      // deleteMany rather than delete: deleting something already gone must be
      // a no-op, not a P2025.
      await prisma.passkeyCredential.deleteMany({ where: { id } });
    },

    async saveChallenge(challenge) {
      const data = {
        kind: challenge.kind,
        userId: challenge.userId ?? null,
        context: (challenge.context ?? null) as never,
        expiresAt: challenge.expiresAt,
      };
      await prisma.passkeyChallenge.upsert({
        where: { challenge: challenge.challenge },
        create: { challenge: challenge.challenge, ...data },
        update: data,
      });
    },

    async takeChallenge(challenge) {
      // `delete` returns the row it removed, and does so atomically — one
      // statement, so two concurrent callers cannot both succeed. A `findUnique`
      // followed by a `delete` would let them, which is replay.
      let row: Record<string, unknown>;
      try {
        row = await prisma.passkeyChallenge.delete({ where: { challenge } });
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }

      const expiresAt = new Date(row.expiresAt as string);
      if (expiresAt.getTime() < Date.now()) return null;

      const result: PasskeyChallenge = {
        challenge: String(row.challenge),
        kind: row.kind as ChallengeKind,
        expiresAt,
        ...(row.userId ? { userId: String(row.userId) } : {}),
        ...(row.context ? { context: row.context as Record<string, unknown> } : {}),
      };
      return result;
    },
  };
}

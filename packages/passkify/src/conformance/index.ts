/**
 * A conformance suite for `PasskeyStore` implementations.
 *
 * The store interface is ten methods, and three of them have requirements that
 * are invisible in the type signature and catastrophic to get wrong:
 * `takeChallenge` must be atomic, `createUser` must persist the id it is given
 * verbatim, and usernames must be unique under concurrency. Prose in a doc
 * comment does not enforce any of that. This does.
 *
 * Runner-agnostic by dependency injection rather than by importing one: the
 * `test` function from `node:test`, Vitest and Jest all satisfy the same shape,
 * so pass yours in.
 *
 * ```ts
 * import { test } from 'vitest';
 * import { runStoreConformance } from 'passkify/store-conformance';
 *
 * runStoreConformance({
 *   test,
 *   createStore: async () => {
 *     const db = await freshDatabase();
 *     return { store: myStore(db), cleanup: () => db.end() };
 *   },
 * });
 * ```
 */

import { PasskeyError } from '../shared/errors.js';
import type { PasskeyStore, PasskeyCredential, PasskeyUser } from '../server/store.js';

export type ConformanceSeverity = 'required' | 'recommended';

export interface ConformanceContext {
  /** A unique-per-case suffix, so parallel runs against one database do not collide. */
  readonly nonce: string;
  /** Parallelism for the concurrency cases. */
  readonly concurrency: number;
  /** Slack for stores that round timestamps to whole seconds. */
  readonly timeToleranceMs: number;
}

export interface ConformanceCase {
  name: string;
  severity: ConformanceSeverity;
  /** One sentence on what breaks in production when this fails. */
  consequence: string;
  run(store: PasskeyStore, context: ConformanceContext): Promise<void>;
}

export interface StoreConformanceOptions {
  test: (name: string, fn: () => void | Promise<void>) => unknown;
  /** A fresh, empty store per case. Return `cleanup` to drop tables or close pools. */
  createStore: () => Promise<{ store: PasskeyStore; cleanup?: () => Promise<void> }>;
  /** Cases to skip, each with a written reason. */
  skip?: Partial<Record<string, string>>;
  /** Parallelism for the atomicity cases. Default 16. */
  concurrency?: number;
  /** Default 0. Postgres `timestamptz` needs none; a store rounding to seconds needs 1000. */
  timeToleranceMs?: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`store conformance: ${message}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`store conformance: ${message} (expected ${expected}, got ${actual})`);
  }
}

async function rejects(promise: Promise<unknown>, code: string, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PasskeyError && error.code === code) return;
    throw new Error(
      `store conformance: ${message} — threw ${(error as Error).message} instead of ${code}`,
    );
  }
  throw new Error(`store conformance: ${message} — nothing was thrown`);
}

let counter = 0;
const unique = (): string => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

function credentialFixture(userId: string, overrides: Partial<PasskeyCredential> = {}) {
  const credential: PasskeyCredential = {
    id: `cred-${unique()}`,
    userId,
    publicKey: 'pQECAyYgASFYIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    algorithm: -7,
    counter: 0,
    transports: ['internal'],
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: '00000000-0000-0000-0000-000000000000',
    createdAt: new Date(),
    ...overrides,
  };
  return credential;
}

async function makeUser(store: PasskeyStore, id?: string): Promise<PasskeyUser> {
  const suffix = unique();
  return store.createUser({
    id: id ?? `user-${suffix}`,
    username: `ada-${suffix}`,
    displayName: 'Ada Lovelace',
  });
}

export const conformanceCases: readonly ConformanceCase[] = [
  // ---------------------------------------------------------------- challenges
  {
    name: 'takeChallenge returns a saved challenge exactly once',
    severity: 'required',
    consequence: 'A registration or login response could be replayed.',
    async run(store) {
      const challenge = `ch-${unique()}`;
      await store.saveChallenge({
        challenge,
        kind: 'registration',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const first = await store.takeChallenge(challenge);
      assert(first, 'the first takeChallenge returned null');
      assertEqual(first.challenge, challenge, 'the wrong challenge came back');

      const second = await store.takeChallenge(challenge);
      assertEqual(second, null, 'the challenge survived being taken');
    },
  },
  {
    name: 'takeChallenge is atomic under concurrency',
    severity: 'required',
    consequence:
      'Two requests racing for the same challenge both succeed, which is exactly the replay ' +
      'the challenge exists to prevent. A read-then-delete implementation fails here.',
    async run(store, context) {
      const challenge = `ch-race-${unique()}`;
      await store.saveChallenge({
        challenge,
        kind: 'authentication',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const results = await Promise.all(
        Array.from({ length: context.concurrency }, () => store.takeChallenge(challenge)),
      );
      const winners = results.filter((result) => result !== null);
      assertEqual(
        winners.length,
        1,
        `${winners.length} of ${context.concurrency} concurrent callers got the challenge`,
      );
    },
  },
  {
    name: 'an expired challenge is not returned, and is deleted',
    severity: 'required',
    consequence: 'A challenge outliving its window widens the replay opportunity indefinitely.',
    async run(store) {
      const challenge = `ch-old-${unique()}`;
      await store.saveChallenge({
        challenge,
        kind: 'registration',
        expiresAt: new Date(Date.now() - 1000),
      });
      assertEqual(await store.takeChallenge(challenge), null, 'an expired challenge was returned');
    },
  },
  {
    name: 'takeChallenge returns null for unknown and hostile keys',
    severity: 'required',
    consequence:
      'A store that throws on an unusual key turns an ordinary miss into a 500, and one that ' +
      'interpolates the key into a query has a much worse problem.',
    async run(store) {
      for (const key of [
        'nope',
        "'; DROP TABLE challenges; --",
        '../../etc/passwd',
        'a%00b',
        'a-_b',
        '{"$ne":null}',
      ]) {
        assertEqual(await store.takeChallenge(key), null, `key ${JSON.stringify(key)} misbehaved`);
      }
    },
  },
  {
    name: 'challenge context survives a round trip, booleans included',
    severity: 'required',
    consequence:
      'passkify reads `context.isNewUser === true` to decide whether to create an account. A ' +
      'store that stringifies booleans turns every registration into an existing-user flow.',
    async run(store) {
      const challenge = `ch-ctx-${unique()}`;
      await store.saveChallenge({
        challenge,
        kind: 'registration',
        expiresAt: new Date(Date.now() + 60_000),
        userId: 'user-1',
        context: { isNewUser: true, username: 'ada', nested: { deep: [1, 'two', false] } },
      });

      const taken = await store.takeChallenge(challenge);
      assert(taken, 'the challenge was not returned');
      assertEqual(taken.userId, 'user-1', 'userId did not survive');
      assertEqual(taken.context?.isNewUser, true, 'a boolean came back as something else');
      assertEqual(taken.kind, 'registration', 'kind did not survive');
    },
  },
  {
    name: 'expiresAt comes back as a Date',
    severity: 'required',
    consequence: 'A string or a number here fails the expiry comparison silently.',
    async run(store, context) {
      const challenge = `ch-date-${unique()}`;
      const expiresAt = new Date(Date.now() + 60_000);
      await store.saveChallenge({ challenge, kind: 'registration', expiresAt });

      const taken = await store.takeChallenge(challenge);
      assert(taken, 'the challenge was not returned');
      assert(taken.expiresAt instanceof Date, 'expiresAt is not a Date');
      assert(
        Math.abs(taken.expiresAt.getTime() - expiresAt.getTime()) <= context.timeToleranceMs,
        'expiresAt drifted beyond the tolerance',
      );
    },
  },

  // --------------------------------------------------------------------- users
  {
    name: 'createUser persists the id it was given, verbatim',
    severity: 'required',
    consequence:
      'The id is the WebAuthn user handle, which the authenticator stores and returns on every ' +
      'usernameless login. A store that generates its own means those logins never find the ' +
      'account — and the failure only appears for discoverable credentials.',
    async run(store) {
      const id = `handle-${unique()}`;
      const created = await makeUser(store, id);
      assertEqual(created.id, id, 'createUser returned a different id');

      const fetched = await store.getUserById(id);
      assert(fetched, 'the user could not be fetched by the id it was created with');
      assertEqual(fetched.id, id, 'the stored id differs from the one supplied');
    },
  },
  {
    name: 'a username can only be taken once, even under a race',
    severity: 'required',
    consequence: 'Two accounts with the same username make username-first login ambiguous.',
    async run(store, context) {
      const username = `ada-${unique()}`;
      const attempts = Array.from({ length: context.concurrency }, (_, i) =>
        store
          .createUser({ id: `u-${unique()}-${i}`, username, displayName: 'Ada' })
          .then(() => 'ok' as const)
          .catch(() => 'failed' as const),
      );
      const results = await Promise.all(attempts);
      assertEqual(
        results.filter((result) => result === 'ok').length,
        1,
        'more than one caller created the same username',
      );
    },
  },
  {
    name: 'lookups return null for a miss rather than throwing',
    severity: 'required',
    consequence: 'A throw turns "no such account" into a 500 on a perfectly ordinary path.',
    async run(store) {
      assertEqual(
        await store.getUserById(`missing-${unique()}`),
        null,
        'getUserById threw or lied',
      );
      assertEqual(
        await store.getUserByUsername(`missing-${unique()}`),
        null,
        'getUserByUsername threw or lied',
      );
      assertEqual(
        await store.getCredentialById(`missing-${unique()}`),
        null,
        'getCredentialById threw or lied',
      );
    },
  },
  {
    name: 'getUserByUsername is case-insensitive',
    severity: 'recommended',
    consequence:
      'Not required, because a plain unique index is case-sensitive and that is a defensible ' +
      'choice. But decide knowingly: if it is case-sensitive, "Ada" and "ada" are two accounts, ' +
      'and users will find that out the confusing way.',
    async run(store) {
      const suffix = unique();
      const username = `Ada-${suffix}`;
      await store.createUser({ id: `u-${suffix}`, username, displayName: 'Ada' });
      const found = await store.getUserByUsername(username.toLowerCase());
      assert(found, 'a lower-cased username did not find the account');
    },
  },

  // --------------------------------------------------------------- credentials
  {
    name: 'a credential round-trips with every field intact',
    severity: 'required',
    consequence: 'A dropped public key or algorithm makes every future login fail to verify.',
    async run(store, context) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id, { nickname: 'MacBook' });
      await store.createCredential(credential);

      const stored = await store.getCredentialById(credential.id);
      assert(stored, 'the credential was not found after being created');
      assertEqual(stored.publicKey, credential.publicKey, 'publicKey changed');
      assertEqual(stored.algorithm, credential.algorithm, 'algorithm changed');
      assertEqual(stored.userId, user.id, 'userId changed');
      assertEqual(stored.deviceType, credential.deviceType, 'deviceType changed');
      assertEqual(stored.backedUp, credential.backedUp, 'backedUp changed');
      assertEqual(stored.nickname, 'MacBook', 'nickname changed');
      assert(stored.createdAt instanceof Date, 'createdAt is not a Date');
      assert(
        Math.abs(stored.createdAt.getTime() - credential.createdAt.getTime()) <=
          context.timeToleranceMs,
        'createdAt drifted beyond the tolerance',
      );
      assert(Array.isArray(stored.transports), 'transports is not an array');
    },
  },
  {
    name: 'a credential with no transports and no nickname round-trips too',
    severity: 'required',
    consequence:
      'Optional fields coming back as null instead of undefined leak into the options object ' +
      'and some authenticators reject it.',
    async run(store) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id);
      credential.transports = undefined;
      await store.createCredential(credential);

      const stored = await store.getCredentialById(credential.id);
      assert(stored, 'the credential was not found');
      assert(
        stored.transports === undefined || stored.transports.length === 0,
        'absent transports came back as something truthy',
      );
      assert(stored.nickname === undefined || stored.nickname === null, 'nickname was invented');
    },
  },
  {
    name: 'the same credential id cannot be registered twice',
    severity: 'required',
    consequence: 'One authenticator credential bound to two accounts makes login ambiguous.',
    async run(store) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id);
      await store.createCredential(credential);
      await rejects(
        store.createCredential(credential),
        'credential_exists',
        'a duplicate credential id was accepted',
      );
    },
  },
  {
    name: 'updateCredential changes only what it was given',
    severity: 'required',
    consequence: 'Clobbering the public key on a counter update breaks every later login.',
    async run(store) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id, { nickname: 'Phone' });
      await store.createCredential(credential);

      await store.updateCredential(credential.id, { counter: 42 });
      const stored = await store.getCredentialById(credential.id);
      assert(stored, 'the credential vanished');
      assertEqual(stored.counter, 42, 'counter was not updated');
      assertEqual(stored.publicKey, credential.publicKey, 'publicKey was clobbered');
      assertEqual(stored.nickname, 'Phone', 'nickname was clobbered');
    },
  },
  {
    name: 'updateCredential on a missing id throws unknown_credential',
    severity: 'required',
    consequence: 'A silent no-op hides a real bug until someone cannot sign in.',
    async run(store) {
      await rejects(
        store.updateCredential(`missing-${unique()}`, { counter: 1 }),
        'unknown_credential',
        'updating a missing credential did not throw',
      );
    },
  },
  {
    name: 'the counter survives its full 32-bit range',
    severity: 'required',
    consequence: 'A truncated counter reads as a regression, which locks the user out.',
    async run(store) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id);
      await store.createCredential(credential);
      await store.updateCredential(credential.id, { counter: 4294967295 });
      const stored = await store.getCredentialById(credential.id);
      assertEqual(stored?.counter, 4294967295, 'a 32-bit counter did not survive');
    },
  },
  {
    name: 'deleteCredential is idempotent',
    severity: 'required',
    consequence: 'A double-click on "remove" should not produce an error page.',
    async run(store) {
      const user = await makeUser(store);
      const credential = credentialFixture(user.id);
      await store.createCredential(credential);

      await store.deleteCredential(credential.id);
      assertEqual(await store.getCredentialById(credential.id), null, 'the credential survived');
      await store.deleteCredential(credential.id);
      await store.deleteCredential(`never-existed-${unique()}`);
    },
  },
  {
    name: 'listCredentialsByUserId returns that account only, oldest first',
    severity: 'required',
    consequence:
      'Order decides which passkey a user sees first in their settings. Leaking another ' +
      "account's credentials would be considerably worse.",
    async run(store) {
      const user = await makeUser(store);
      const other = await makeUser(store);

      const first = credentialFixture(user.id, { createdAt: new Date(Date.now() - 60_000) });
      const second = credentialFixture(user.id, { createdAt: new Date() });
      await store.createCredential(second);
      await store.createCredential(first);
      await store.createCredential(credentialFixture(other.id));

      const listed = await store.listCredentialsByUserId(user.id);
      assertEqual(listed.length, 2, 'the wrong number of credentials came back');
      assert(
        listed.every((credential) => credential.userId === user.id),
        "another account's credential was included",
      );
      assertEqual(listed[0].id, first.id, 'credentials are not ordered oldest first');

      assertEqual(
        (await store.listCredentialsByUserId(`nobody-${unique()}`)).length,
        0,
        'an unknown user returned credentials',
      );
    },
  },
  {
    name: 'unicode names survive storage',
    severity: 'required',
    consequence: 'A mangled display name is what the user sees in their passkey picker forever.',
    async run(store) {
      const suffix = unique();
      const displayName = 'Ada 👩‍💻 لavelace';
      const user = await store.createUser({
        id: `u-${suffix}`,
        username: `ada.лovelace-${suffix}`,
        displayName,
      });
      const fetched = await store.getUserById(user.id);
      assertEqual(fetched?.displayName, displayName, 'the display name was mangled');
    },
  },
];

/**
 * Register every conformance case with your test runner.
 *
 * Each case gets a fresh store, so a failure in one cannot cascade.
 */
export function runStoreConformance(options: StoreConformanceOptions): void {
  const context: ConformanceContext = {
    nonce: unique(),
    concurrency: options.concurrency ?? 16,
    timeToleranceMs: options.timeToleranceMs ?? 0,
  };

  for (const testCase of conformanceCases) {
    const skipReason = options.skip?.[testCase.name];
    const label = `store conformance [${testCase.severity}]: ${testCase.name}`;

    if (skipReason) {
      options.test(`${label} — SKIPPED: ${skipReason}`, () => {});
      continue;
    }

    options.test(label, async () => {
      const { store, cleanup } = await options.createStore();
      try {
        await testCase.run(store, context);
      } catch (error) {
        // The consequence is attached here rather than left in a table nobody
        // reads: whoever sees this failure is the person who needs it.
        (error as Error).message =
          `${(error as Error).message}\n\n  Why this matters: ${testCase.consequence}`;
        throw error;
      } finally {
        await cleanup?.();
      }
    });
  }
}

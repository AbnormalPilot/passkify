/**
 * Does the conformance suite actually catch anything?
 *
 * A suite that passes every implementation is decoration. These are the two
 * mistakes the suite exists for, written deliberately, and asserted to fail.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { MemoryStore } from 'passkify/server';
import { conformanceCases } from '#internal/conformance/index.js';
import type { PasskeyStore } from '#internal/server/store.js';

const CONTEXT = { nonce: 'x', concurrency: 16, timeToleranceMs: 0 };

async function runCase(name: string, store: PasskeyStore): Promise<Error | null> {
  const testCase = conformanceCases.find((entry) => entry.name === name);
  assert.ok(testCase, `no conformance case named "${name}"`);
  try {
    await testCase.run(store, CONTEXT);
    return null;
  } catch (error) {
    return error as Error;
  }
}

test('a read-then-delete takeChallenge is caught by the atomicity case', async () => {
  // The classic mistake, and the one that permits replay: fetch, then delete,
  // with an await between them.
  class RacyStore extends MemoryStore {
    override async takeChallenge(challenge: string) {
      const all = (this as unknown as { challenges: Map<string, { expiresAt: Date }> }).challenges;
      const record = all.get(challenge);
      if (!record) return null;
      // The await between reading and deleting is the entire bug: two callers
      // both get past the read before either deletes.
      await Promise.resolve();
      all.delete(challenge);
      return record.expiresAt.getTime() < Date.now() ? null : (record as never);
    }
  }

  const failure = await runCase(
    'takeChallenge is atomic under concurrency',
    new RacyStore() as unknown as PasskeyStore,
  );
  assert.ok(failure, 'the racy store passed the atomicity case');
  assert.match(failure.message, /concurrent callers/);
});

test('a createUser that invents its own id is caught', async () => {
  // The most destructive store bug there is: the id is the WebAuthn user
  // handle, so usernameless login silently never finds the account.
  class IdRewritingStore extends MemoryStore {
    override async createUser(input: { id: string; username: string; displayName: string }) {
      return super.createUser({ ...input, id: `generated-${Math.random()}` });
    }
  }

  const failure = await runCase(
    'createUser persists the id it was given, verbatim',
    new IdRewritingStore() as unknown as PasskeyStore,
  );
  assert.ok(failure, 'the id-rewriting store passed');
  assert.match(failure.message, /different id|could not be fetched/);
});

test('a store that lets a duplicate credential through is caught', async () => {
  class PermissiveStore extends MemoryStore {
    override async createCredential(credential: never) {
      const all = (this as unknown as { credentials: Map<string, unknown> }).credentials;
      all.set((credential as { id: string }).id, credential);
    }
  }

  const failure = await runCase(
    'the same credential id cannot be registered twice',
    new PermissiveStore() as unknown as PasskeyStore,
  );
  assert.ok(failure, 'the permissive store passed');
});

test('every case declares a severity and a consequence worth reading', () => {
  for (const entry of conformanceCases) {
    assert.ok(['required', 'recommended'].includes(entry.severity), entry.name);
    assert.ok(entry.consequence.length > 40, `${entry.name} has a thin consequence`);
  }
});

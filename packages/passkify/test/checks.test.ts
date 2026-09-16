/**
 * The registry and the verifiers must agree, in both directions.
 *
 * Forwards: every id the code asserts exists in the registry — `createTrace`
 * throws otherwise, so this is enforced the moment a ceremony runs.
 *
 * Backwards: every registry entry is actually reached by a real ceremony. That
 * is the direction that rots quietly, because a check deleted from the code
 * leaves a table entry behind that reads as though it were still enforced.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { PasskeyServer, MemoryStore, type PasskeyError } from 'passkify/server';
import {
  VERIFICATION_CHECKS,
  REGISTRATION_CHECKS,
  AUTHENTICATION_CHECKS,
} from '#internal/shared/checks.js';
import type { CheckEvent } from '#internal/shared/trace.js';
import { VirtualAuthenticator } from '#internal/testing/index.js';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

function makeServer(overrides: Record<string, unknown> = {}) {
  const seen: CheckEvent[] = [];
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: RP_ID,
    origin: ORIGIN,
    store: new MemoryStore(),
    explain: true,
    hooks: { onCheck: (event: CheckEvent) => seen.push(event) },
    ...overrides,
  });
  return { server, seen };
}

test('every registry id is unique, and indexes run 1..n per ceremony', () => {
  const ids = VERIFICATION_CHECKS.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate check id');

  for (const group of [REGISTRATION_CHECKS, AUTHENTICATION_CHECKS]) {
    group.forEach((check, i) => {
      assert.equal(check.index, i + 1, `${check.id} has index ${check.index}`);
    });
  }
});

test('every check carries a specification reference, a detail and a consequence', () => {
  // A check nobody can explain the consequence of is one nobody will maintain
  // correctly, so the prose is part of the contract.
  for (const check of VERIFICATION_CHECKS) {
    assert.ok(check.spec.length > 0, `${check.id} has no spec reference`);
    assert.ok(check.detail.length > 20, `${check.id} has a thin detail`);
    assert.ok(check.attack.length > 20, `${check.id} has a thin attack description`);
    assert.ok(check.source.endsWith('.ts'), `${check.id} has no source file`);
    assert.ok(check.id.startsWith(`${check.ceremony === 'registration' ? 'reg' : 'auth'}.`));
  }
});

test('a happy-path registration reaches every registration check', async () => {
  const { server, seen } = makeServer({ requireBackupEligible: true });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });
  const result = await server.finishRegistration(response as never);

  const reached = new Set(seen.map((event) => event.id));
  const missing = REGISTRATION_CHECKS.filter((check) => !reached.has(check.id)).map((c) => c.id);
  assert.deepEqual(missing, [], `registration checks never reached: ${missing.join(', ')}`);
  assert.ok(seen.every((event) => event.ok));

  // The same trace is on the result when `explain` is set.
  assert.equal(result.checks?.length, REGISTRATION_CHECKS.length);
});

test('a happy-path login reaches every authentication check', async () => {
  const { server, seen } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const registration = await server.startRegistration({ username: 'ada' });
  await server.finishRegistration(
    authenticator.create({ challenge: registration.options.challenge, origin: ORIGIN }) as never,
  );

  seen.length = 0;

  const login = await server.startAuthentication({ username: 'ada' });
  const assertion = authenticator.assert({
    challenge: login.options.challenge,
    origin: ORIGIN,
    userHandle: registration.userId,
  });
  const result = await server.finishAuthentication(assertion as never);

  const reached = new Set(seen.map((event) => event.id));
  const missing = AUTHENTICATION_CHECKS.filter((check) => !reached.has(check.id)).map((c) => c.id);
  assert.deepEqual(missing, [], `authentication checks never reached: ${missing.join(', ')}`);
  assert.ok(seen.every((event) => event.ok));
  assert.equal(result.checks?.length, AUTHENTICATION_CHECKS.length);
});

test('the trace records checks in registry order and stops at the first failure', async () => {
  const { server, seen } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { origin: 'https://evil.example' },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'origin_mismatch',
  );

  const last = seen[seen.length - 1];
  assert.equal(last.id, 'reg.origin_allowed');
  assert.equal(last.ok, false);
  assert.equal(last.code, 'origin_mismatch');
  // Everything before it passed, and nothing after it ran — the verifier
  // short-circuits, and the trace shows that.
  assert.ok(seen.slice(0, -1).every((event) => event.ok));

  const indexes = seen.map((event) => event.index);
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
  );
});

test('without explain, no trace is returned and the hook is the only way to see one', async () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: RP_ID,
    origin: ORIGIN,
    store: new MemoryStore(),
  });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const result = await server.finishRegistration(
    authenticator.create({ challenge: options.challenge, origin: ORIGIN }) as never,
  );
  assert.equal(result.checks, undefined);
});

test('every error code a check names is one the errors module defines', async () => {
  // Guards against a registry entry naming a code that was renamed away.
  const { PasskeyError: Err } = await import('passkify/server');
  for (const check of VERIFICATION_CHECKS) {
    const error = new Err(check.code, 'probe');
    assert.equal(error.code, check.code);
    assert.ok(error.status >= 400 && error.status < 600, `${check.id} maps to ${error.status}`);
  }
});

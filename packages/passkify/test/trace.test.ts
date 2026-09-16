/**
 * The check trace.
 *
 * Every verification step in the two ceremonies goes through `trace.assert`,
 * and `test/checks.test.ts` already asserts that the registry and the code
 * agree in both directions. What is left is the machinery in between: that a
 * failed assertion still records before it throws, and that the two guards
 * against an unregistered or misfiled id actually fire — they are the reason
 * the registry cannot quietly drift from the verifiers that index into it.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createTrace, type CheckEvent } from '#internal/shared/trace.js';
import { checksFor, getCheck } from '#internal/shared/checks.js';
import { PasskeyError } from '#internal/shared/errors.js';

const REGISTRATION = checksFor('registration')[0].id;
const AUTHENTICATION = checksFor('authentication')[0].id;

test('a passing assertion is recorded in order, with its registry index', () => {
  const trace = createTrace('authentication');
  const first = checksFor('authentication')[0];
  const second = checksFor('authentication')[1];

  trace.assert(first.id, true, () => new PasskeyError('parse_error', 'unused'));
  trace.assert(second.id, true, () => new PasskeyError('parse_error', 'unused'));

  assert.deepEqual(
    trace.events.map((event) => event.id),
    [first.id, second.id],
  );
  assert.deepEqual(trace.events[0], {
    ceremony: 'authentication',
    id: first.id,
    index: first.index,
    ok: true,
  });
});

test('a failing assertion records the failure and then throws it', () => {
  const trace = createTrace('authentication');
  const failure = new PasskeyError('bad_signature', 'no');

  assert.throws(
    () => trace.assert(AUTHENTICATION, false, () => failure),
    (error: unknown) => error === failure,
  );

  // Recorded before the throw, not instead of it: a trace that stops one event
  // short of the failure is the one event you actually wanted.
  assert.equal(trace.events.length, 1);
  assert.equal(trace.events[0].ok, false);
  assert.equal(trace.events[0].code, 'bad_signature');
});

test('the error factory is only called when the check fails', () => {
  const trace = createTrace('authentication');
  let built = 0;
  const factory = () => {
    built += 1;
    return new PasskeyError('parse_error', 'built');
  };

  trace.assert(AUTHENTICATION, true, factory);
  assert.equal(built, 0);

  assert.throws(() => trace.assert(AUTHENTICATION, false, factory));
  assert.equal(built, 1);
});

test('an observer sees every event as it happens', () => {
  const seen: CheckEvent[] = [];
  const trace = createTrace('registration', (event) => seen.push(event));

  trace.assert(REGISTRATION, true, () => new PasskeyError('parse_error', 'unused'));
  trace.record(checksFor('registration')[1].id, false, 'parse_error');

  assert.equal(seen.length, 2);
  assert.equal(seen[0].ok, true);
  assert.equal(seen[1].code, 'parse_error');
  assert.deepEqual(seen, [...trace.events]);
});

test('an id that is not in the registry is a configuration error, not a check failure', () => {
  const trace = createTrace('authentication');
  assert.equal(getCheck('auth.not_a_real_check'), undefined);
  assert.throws(
    () => trace.record('auth.not_a_real_check', true),
    (error: PasskeyError) => {
      assert.equal(error.code, 'configuration_error');
      assert.match(error.message, /not in the registry/);
      return true;
    },
  );
});

test('an id belonging to the other ceremony is refused', () => {
  // Recording a registration check while verifying a login would put an event
  // in the trace that the registry says cannot happen there, and the docs and
  // diagrams all render from that registry.
  const trace = createTrace('authentication');
  assert.throws(
    () => trace.record(REGISTRATION, true),
    (error: PasskeyError) => {
      assert.equal(error.code, 'configuration_error');
      assert.match(error.message, /belongs to the registration ceremony, not authentication/);
      return true;
    },
  );
});

test('checksFor returns each ceremony in index order', () => {
  for (const ceremony of ['registration', 'authentication'] as const) {
    const checks = checksFor(ceremony);
    assert.ok(checks.length > 0);
    assert.deepEqual(
      checks.map((check) => check.index),
      checks.map((_, i) => i + 1),
    );
    assert.ok(checks.every((check) => check.ceremony === ceremony));
  }
});

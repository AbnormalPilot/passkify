/**
 * Randomness.
 *
 * A predictable challenge defeats the whole ceremony, so the important
 * assertion here is negative: `Math.random` must appear nowhere on this path.
 * The rest covers the UUID fallback, which exists for runtimes without
 * `crypto.randomUUID` and therefore never runs on the machines that test it.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

import { randomBytes, randomUUID } from '#internal/server/crypto/random.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('randomBytes returns the requested length, and not the same bytes twice', () => {
  assert.equal(randomBytes(0).length, 0);
  assert.equal(randomBytes(32).length, 32);

  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) seen.add(randomBytes(32).join(','));
  assert.equal(seen.size, 16, 'randomBytes repeated itself, which it must never do');
});

test('randomUUID produces a version 4 UUID', () => {
  assert.match(randomUUID(), UUID_V4);
  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) seen.add(randomUUID());
  assert.equal(seen.size, 16);
});

test('the fallback UUID sets the version and variant bits itself', () => {
  // Runtimes without crypto.randomUUID take a different path, and it is the
  // path that has to get the version and variant nibbles right by hand. On a
  // machine that has randomUUID it would otherwise never execute.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: undefined,
  });
  try {
    const built = randomUUID();
    assert.match(built, UUID_V4);
    assert.equal(built[14], '4', 'version nibble');
    assert.ok('89ab'.includes(built[19]), `variant nibble was ${built[19]}`);
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  }
});

test('no source file on a ceremony path reaches for Math.random', () => {
  // Worth asserting across the package rather than in the module that happens
  // to own it: a predictable challenge, user handle or credential ID is not a
  // bug you find by reading the diff that introduced it.
  const src = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith('.ts')) continue;

      const relative = path
        .slice(src.length + 1)
        .split(sep)
        .join('/');
      // The virtual authenticator is a test double, not a security boundary,
      // and it says so. It mints credential IDs, which are identifiers rather
      // than secrets.
      if (relative.startsWith('testing/')) continue;

      // Strip comments, so the sentence at the top of random.ts explaining
      // this very rule does not trip it.
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/Math\.random/.test(code)) offenders.push(relative);
    }
  };

  walk(src);
  assert.deepEqual(offenders, []);
});

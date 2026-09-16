/**
 * Proves the thing that actually gets published works.
 *
 * The rest of the suite runs against `src/`, which is fast and portable but
 * says nothing about the build. This file loads `dist/` both ways — and the
 * CommonJS half in particular, which no test has ever loaded, despite `require`
 * being a supported entry point in `package.json`.
 *
 * Run with `npm run test:dist` (it builds first). Excluded from the default
 * run, where `dist/` may be absent or stale.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const distEsm = fileURLToPath(new URL('../dist/esm/server/index.js', import.meta.url));
const distCjs = fileURLToPath(new URL('../dist/cjs/server/index.js', import.meta.url));

const EXPECTED_SERVER_EXPORTS = [
  'PasskeyServer',
  'MemoryStore',
  'PasskeyError',
  'isPasskeyError',
  'COSEAlgorithm',
  'parseAuthenticatorData',
  'parseClientData',
  'parseCOSEPublicKey',
  'verifySignature',
  'algorithmName',
  'decodeCBOR',
  'VERIFICATION_CHECKS',
  'toBase64Url',
  'fromBase64Url',
];

test('the ESM build exports the whole server surface', async () => {
  const mod = await import(distEsm);
  for (const name of EXPECTED_SERVER_EXPORTS) {
    assert.ok(name in mod, `dist/esm is missing ${name}`);
  }
  assert.equal(typeof mod.PasskeyServer, 'function');
});

test('the CommonJS build loads under require() and exports the same surface', () => {
  const mod = require(distCjs);
  for (const name of EXPECTED_SERVER_EXPORTS) {
    assert.ok(name in mod, `dist/cjs is missing ${name}`);
  }
  assert.equal(typeof mod.PasskeyServer, 'function');
});

test('the client build loads in both formats without pulling in node:crypto', async () => {
  const esm = await import(fileURLToPath(new URL('../dist/esm/client/index.js', import.meta.url)));
  assert.equal(typeof esm.register, 'function');
  assert.equal(typeof esm.login, 'function');
  assert.equal(typeof esm.signInWithAutofill, 'function');

  const cjs = require(fileURLToPath(new URL('../dist/cjs/client/index.js', import.meta.url)));
  assert.equal(typeof cjs.register, 'function');
});

test('a full registration runs against the compiled output', async () => {
  const { PasskeyServer, MemoryStore } = await import(distEsm);
  const { VirtualAuthenticator } = await import('#internal/testing/index.js');

  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: 'example.com',
    origin: 'https://example.com',
    store: new MemoryStore(),
  });

  const { options } = await server.startRegistration({ username: 'ada' });
  const authenticator = new VirtualAuthenticator({ rpId: 'example.com' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: 'https://example.com',
  });
  const result = await server.finishRegistration(response as never);

  assert.equal(result.verified, true);
  assert.equal(result.user.username, 'ada');
});

test('the two builds throw the same error codes', async () => {
  const esm = await import(distEsm);
  const cjs = require(distCjs);

  for (const mod of [esm, cjs]) {
    assert.throws(
      () => new mod.PasskeyServer({ rpName: 'x', origin: 'https://example.com' }),
      (error: { code?: string }) => error.code === 'configuration_error',
    );
  }
});

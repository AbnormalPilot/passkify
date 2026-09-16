/**
 * The runtime-neutrality claim, checked rather than asserted.
 *
 * The package advertises Cloudflare Workers, Deno and Bun. That claim used to
 * rest on nothing: every signature verification went through `node:crypto`,
 * which none of them fully provide. These tests exercise the same path those
 * runtimes take — the global-WebCrypto provider — and check that nothing
 * outside it reaches for a Node built-in.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { PasskeyServer, MemoryStore } from 'passkify/server';
import { VirtualAuthenticator } from '#internal/testing/index.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

test('no source file on a ceremony path imports a node: built-in', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const relative = file.slice(SRC.length + 1);
    // The CLI is a command-line tool: Node-only by definition, and unreachable
    // from any `exports` entry — which the next test asserts, because that is
    // the guarantee that actually protects an application bundle.
    if (relative.startsWith('cli/')) continue;

    const source = readFileSync(file, 'utf8');
    // Strip comments so prose mentioning node:crypto does not count.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/from\s+['"]node:/.test(code) || /require\(['"]node:/.test(code)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [
      // A test double for Node test suites, never on a ceremony path. It
      // generates keys, which needs a real CSPRNG API.
      'testing/virtual-authenticator.ts',
    ],
    'a node: import reached the library — this is what breaks Workers, Deno and the edge',
  );
});

test('nothing outside the Node adapter reaches for Buffer or process', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const relative = file.slice(SRC.length + 1);
    // The Express adapter is Node-only by definition; it reads a Node stream.
    // The virtual authenticator is a Node-only test double.
    if (relative === 'server/http/express.ts') continue;
    if (relative.startsWith('testing/')) continue;
    if (relative.startsWith('cli/')) continue;
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/\bBuffer\b/.test(code) || /\bprocess\.(env|version)\b/.test(code)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders.sort(), []);
});

test('the crypto provider is the runtime global, whatever the runtime is', async () => {
  // There is exactly one provider now, and it is `globalThis.crypto`. Workers,
  // Deno, Bun, browsers and Node 20+ all reach the same object, so if it works
  // here the only remaining difference is the runtime's own subtle.
  const { crypto: web } = await import('#internal/server/crypto/provider.js');
  assert.equal(typeof web.subtle.verify, 'function');
  assert.equal(typeof web.getRandomValues, 'function');

  const bytes = web.getRandomValues(new Uint8Array(32));
  assert.equal(bytes.length, 32);
  assert.ok(bytes.some((byte) => byte !== 0));
});

test('a full ceremony runs with only WebCrypto primitives available', async () => {
  // The end-to-end proof: register and log in without a single node: call on
  // the verification path.
  const server = new PasskeyServer({
    rpName: 'Edge',
    rpID: 'example.com',
    origin: 'https://example.com',
    store: new MemoryStore(),
  });

  const authenticator = new VirtualAuthenticator({ rpId: 'example.com' });
  const registration = await server.startRegistration({ username: 'ada' });
  const created = await server.finishRegistration(
    authenticator.create({
      challenge: registration.options.challenge,
      origin: 'https://example.com',
    }) as never,
  );
  assert.equal(created.verified, true);

  const login = await server.startAuthentication({ username: 'ada' });
  const verified = await server.finishAuthentication(
    authenticator.assert({
      challenge: login.options.challenge,
      origin: 'https://example.com',
      userHandle: registration.userId,
    }) as never,
  );
  assert.equal(verified.verified, true);
});

test('every algorithm the package offers can actually be verified here', async () => {
  const { isSupportedAlgorithm } = await import('#internal/server/crypto/cose.js');
  const { DEFAULT_PUB_KEY_CRED_PARAMS } = await import('#internal/shared/types.js');
  for (const param of DEFAULT_PUB_KEY_CRED_PARAMS) {
    assert.ok(isSupportedAlgorithm(param.alg), `default algorithm ${param.alg} is not verifiable`);
  }
});

test('the CLI is unreachable from every exports entry', async () => {
  // The CLI uses node: built-ins freely, which is fine because no bundler can
  // ever follow a path into it: `bin` is the only way in, and `bin` is not a
  // module specifier. If an `exports` entry ever pointed at cli/, an
  // application bundle could pull the whole thing in — hence this test.
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { exports: Record<string, unknown>; bin?: Record<string, string> };

  const targets = JSON.stringify(manifest.exports);
  assert.ok(!targets.includes('/cli/'), 'an exports entry points into the CLI');

  assert.deepEqual(manifest.bin, { passkify: './bin/passkify.mjs' });
});

test('the library declares no runtime dependencies', () => {
  // Asserted here as well as in CI, because the claim is on the landing page,
  // in the README and in the security guide — it becomes false in three places
  // at once.
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { dependencies?: Record<string, string> };

  assert.deepEqual(manifest.dependencies ?? {}, {});
});

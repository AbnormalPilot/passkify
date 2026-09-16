/**
 * Related Origin Requests. Most of this is about the ways the feature fails
 * silently, because that is what makes it hard to operate.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { PasskeyServer, MemoryStore, type PasskeyError } from 'passkify/server';

const STORE = () => new MemoryStore();

function server(overrides: Record<string, unknown>) {
  return new PasskeyServer({
    rpName: 'Example',
    rpID: 'example.com',
    origin: 'https://example.com',
    store: STORE(),
    ...overrides,
  } as never);
}

test('the published file is derived from origin, with the rpID first', () => {
  const passkeys = server({
    origin: ['https://example.de', 'https://example.com', 'https://example.co.uk'],
    relatedOrigins: true,
  });

  // The relying party's own origin leads, so that if a browser truncates at
  // the label limit it truncates the same way on every deploy.
  assert.deepEqual(passkeys.relatedOrigins(), {
    origins: ['https://example.com', 'https://example.co.uk', 'https://example.de'],
  });
});

test('it is off by default, and reports so', () => {
  const passkeys = server({ origin: 'https://example.com' });
  assert.equal(passkeys.publishesRelatedOrigins, false);
  assert.equal(passkeys.relatedOrigins(), null);
});

test('a RegExp origin is refused at construction, not at the first fetch', () => {
  // This is the drift case: the server would accept origins the published file
  // omits, and the browser would refuse ceremonies the server was happy with.
  // Silent, one-sided, and undebuggable — so it is a construction error.
  assert.throws(
    () =>
      server({
        origin: ['https://example.com', /^https:\/\/.*\.example\.com$/],
        rpID: 'example.com',
        relatedOrigins: true,
      }),
    (error: PasskeyError) =>
      error.code === 'configuration_error' && /RegExp or a function/.test(error.message),
  );
});

test('a RegExp origin is fine when related origins are off', () => {
  assert.doesNotThrow(() =>
    server({ origin: ['https://example.com', /^https:\/\/.*\.example\.com$/] }),
  );
});

test('more than five registrable labels is refused', () => {
  // Browsers stop after five and ignore the rest silently: three domains work
  // in development, seven break in production.
  assert.throws(
    () =>
      server({
        origin: [
          'https://example.com',
          'https://second.com',
          'https://third.com',
          'https://fourth.com',
          'https://fifth.com',
          'https://sixth.com',
        ],
        relatedOrigins: true,
      }),
    (error: PasskeyError) => error.code === 'configuration_error' && /5/.test(error.message),
  );
});

test('country-code suffixes count as one label, not several', () => {
  // amazon.com, amazon.de and amazon.co.uk are one label — "amazon".
  assert.doesNotThrow(() =>
    server({
      origin: [
        'https://example.com',
        'https://example.de',
        'https://example.co.uk',
        'https://example.com.au',
        'https://example.co.jp',
        'https://example.com.br',
      ],
      relatedOrigins: true,
    }),
  );
});

test('declared labels override the guess', () => {
  const passkeys = server({
    origin: ['https://example.com', 'https://example.xyzzy'],
    relatedOrigins: { labels: ['example'] },
  });
  assert.equal(passkeys.relatedOrigins()?.origins.length, 2);
});

test('the fetch adapter serves it at the fixed absolute path, cacheably', async () => {
  const passkeys = server({
    origin: ['https://example.com', 'https://example.de'],
    relatedOrigins: true,
  });
  const handler = passkeys.handler({ basePath: '/api/passkey' });

  const response = await handler(new Request('https://example.com/.well-known/webauthn'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  // Public and static, unlike every ceremony response.
  assert.match(response.headers.get('cache-control') ?? '', /max-age/);
  assert.deepEqual(await response.json(), {
    origins: ['https://example.com', 'https://example.de'],
  });
});

test('the well-known path is served even though it sits outside basePath', async () => {
  // The mount check 404s everything else outside the mount, so this has to be
  // handled before it.
  const passkeys = server({ origin: 'https://example.com', relatedOrigins: true });
  const handler = passkeys.handler({ basePath: '/deeply/nested/passkey' });

  const ok = await handler(new Request('https://example.com/.well-known/webauthn'));
  assert.equal(ok.status, 200);

  const elsewhere = await handler(new Request('https://example.com/somewhere-else'));
  assert.equal(elsewhere.status, 404);
});

test('with related origins off, the well-known path is a 404', async () => {
  const passkeys = server({ origin: 'https://example.com' });
  const handler = passkeys.handler();
  const response = await handler(new Request('https://example.com/.well-known/webauthn'));
  assert.equal(response.status, 404);
});

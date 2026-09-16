import { test } from 'vitest';
import assert from 'node:assert/strict';

import { PasskeyServer, MemoryStore, type PasskeyError } from 'passkify/server';

const store = () => new MemoryStore();

function expectConfigError(config: Record<string, unknown>, pattern: RegExp) {
  assert.throws(
    () => new PasskeyServer(config as never),
    (error: PasskeyError) => {
      assert.equal(
        error.code,
        'configuration_error',
        `expected configuration_error: ${error.message}`,
      );
      assert.match(error.message, pattern);
      return true;
    },
  );
}

test('rpID is derived from the origin when not given', () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    origin: 'https://app.example.com',
    store: store(),
  });
  assert.equal(server.rpID, 'app.example.com');
});

test('localhost with a port is accepted for development', () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    origin: 'http://localhost:3000',
    store: store(),
  });
  assert.equal(server.rpID, 'localhost');
});

test('a parent domain is a valid rpID for a subdomain origin', () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    origin: ['https://app.example.com', 'https://www.example.com'],
    rpID: 'example.com',
    store: store(),
  });
  assert.equal(server.rpID, 'example.com');
});

test('the classic rpID mistake is caught at construction, with the fix in the message', () => {
  expectConfigError(
    {
      rpName: 'Example',
      origin: 'https://example.com',
      rpID: 'app.example.com',
      store: store(),
    },
    /rpID "app\.example\.com" is not valid for origin "https:\/\/example\.com".*use rpID "example\.com"/s,
  );
});

test('a plain-HTTP origin is refused with an explanation', () => {
  expectConfigError(
    { rpName: 'Example', origin: 'http://example.com', store: store() },
    /only runs on HTTPS/,
  );
});

test('an origin with a path or missing scheme is refused', () => {
  expectConfigError({ rpName: 'Example', origin: 'example.com', store: store() }, /not a URL/);
  expectConfigError(
    { rpName: 'Example', origin: 'https://example.com/login', store: store() },
    /no path.*try "https:\/\/example\.com"/s,
  );
});

test('an rpID given as a URL is refused, and the message suggests the bare domain', () => {
  expectConfigError(
    {
      rpName: 'Example',
      origin: 'https://example.com',
      rpID: 'https://example.com',
      store: store(),
    },
    /bare domain.*Did you mean "example\.com"/s,
  );
});

test('missing rpName or store is refused', () => {
  expectConfigError({ origin: 'https://example.com', store: store() }, /rpName is required/);
  expectConfigError({ rpName: 'Example', origin: 'https://example.com' }, /store is required/);
});

test('a too-small challenge is refused', () => {
  expectConfigError(
    { rpName: 'Example', origin: 'https://example.com', store: store(), challengeSize: 8 },
    /at least 16 bytes/,
  );
});

test('a RegExp origin requires an explicit rpID', () => {
  expectConfigError(
    { rpName: 'Example', origin: /^https:\/\/.*\.example\.com$/, store: store() },
    /rpID could not be derived/,
  );

  // With one, it is accepted.
  const server = new PasskeyServer({
    rpName: 'Example',
    origin: [/^https:\/\/[a-z0-9-]+\.example\.com$/],
    rpID: 'example.com',
    store: store(),
  });
  assert.equal(server.rpID, 'example.com');
});

test('a user id longer than 64 bytes is caught before the browser sees it', async () => {
  const backing = store();
  const server = new PasskeyServer({
    rpName: 'Example',
    origin: 'https://example.com',
    store: backing,
  });
  await backing.createUser({
    id: 'x'.repeat(65),
    username: 'ada',
    displayName: 'Ada',
  });

  await assert.rejects(
    () => server.startRegistration({ userId: 'x'.repeat(65) }),
    (error: PasskeyError) =>
      error.code === 'configuration_error' && /at most 64/.test(error.message),
  );
});

test('RS1 is refused at construction rather than at login', () => {
  // It used to be verifiable, so a site could opt into SHA-1 signature
  // checking. Now the constructor says so, while nobody is locked out yet.
  assert.throws(
    () =>
      new PasskeyServer({
        rpName: 'Example',
        rpID: 'example.com',
        origin: 'https://example.com',
        store: new MemoryStore(),
        supportedAlgorithms: [-7, -65535],
      }),
    (error: PasskeyError) => error.code === 'configuration_error' && /RS1/.test(error.message),
  );
});

test('an algorithm passkify cannot verify is refused at construction', () => {
  assert.throws(
    () =>
      new PasskeyServer({
        rpName: 'Example',
        rpID: 'example.com',
        origin: 'https://example.com',
        store: new MemoryStore(),
        supportedAlgorithms: [-7, -12345],
      }),
    (error: PasskeyError) => error.code === 'configuration_error',
  );
});

test('hints and extensions reach the options the browser is given', async () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: 'example.com',
    origin: 'https://example.com',
    store: new MemoryStore(),
    hints: ['client-device'],
    extensions: { prf: { eval: { first: 'AAAA' } } },
  });

  const registration = await server.startRegistration({ username: 'ada' });
  assert.deepEqual(registration.options.hints, ['client-device']);
  // credProps is always asked for: it reports whether the credential is really
  // discoverable, which decides whether usernameless sign-in can work.
  assert.equal(registration.options.extensions?.credProps, true);
  assert.ok(registration.options.extensions?.prf);

  const login = await server.startAuthentication({});
  assert.deepEqual(login.options.hints, ['client-device']);
  assert.ok(login.options.extensions?.prf);
});

test('with no hints or extensions configured, neither field is emitted', async () => {
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: 'example.com',
    origin: 'https://example.com',
    store: new MemoryStore(),
  });
  const login = await server.startAuthentication({});
  assert.equal(login.options.hints, undefined);
  assert.equal(login.options.extensions, undefined);
});

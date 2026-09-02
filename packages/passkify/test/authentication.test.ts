import test from 'node:test';
import assert from 'node:assert/strict';

import { PasskeyServer, MemoryStore, PasskeyError } from '../dist/esm/server/index.js';
import { VirtualAuthenticator, FLAG } from './helpers/virtual-authenticator.ts';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';

function makeServer(overrides: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: RP_ID,
    origin: ORIGIN,
    store,
    ...overrides,
  });
  return { server, store };
}

/** Register one passkey and hand back everything a login test needs. */
async function seed(server: PasskeyServer, username = 'ada', options: { algorithm?: 'ES256' | 'RS256' | 'EdDSA' } = {}) {
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID, algorithm: options.algorithm });
  const start = await server.startRegistration({ username });
  const created = authenticator.create({ challenge: start.options.challenge, origin: ORIGIN });
  const registered = await server.finishRegistration(created as never);
  return { authenticator, user: registered.user };
}

test('usernameless login works and resolves the account from the user handle', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  assert.equal(options.allowCredentials, undefined, 'no credentials are disclosed up front');
  assert.equal(options.rpId, RP_ID);

  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
  });
  const result = await server.finishAuthentication(assertion as never);

  assert.equal(result.verified, true);
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.username, 'ada');
  assert.equal(result.userVerified, true);
});

test('username-first login scopes allowCredentials to that account', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options, userId } = await server.startAuthentication({ username: 'ada' });
  assert.equal(userId, user.id);
  assert.equal(options.allowCredentials?.length, 1);
  assert.deepEqual(options.allowCredentials?.[0].transports, ['internal', 'hybrid']);

  const assertion = authenticator.assert({ challenge: options.challenge, origin: ORIGIN });
  const result = await server.finishAuthentication(assertion as never);
  assert.equal(result.user.id, user.id);
});

test('an unknown username does not leak that the account is missing', async () => {
  const { server } = makeServer();
  await seed(server, 'ada');

  const known = await server.startAuthentication({ username: 'ada' });
  const unknown = await server.startAuthentication({ username: 'nobody-here' });

  // Same shape, same challenge length, no error: the login form cannot be used
  // to enumerate accounts.
  assert.equal(unknown.options.challenge.length, known.options.challenge.length);
  assert.equal(unknown.userId, undefined);
  assert.equal(unknown.options.allowCredentials, undefined);
});

test('a tampered signature is rejected', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
  });

  const signature = Buffer.from(assertion.response.signature, 'base64url');
  signature[signature.length - 1] ^= 0x01;
  assertion.response.signature = signature.toString('base64url');

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'bad_signature',
  );
});

test('a signature over different authenticator data is rejected', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
  });

  // Raise the counter in the authenticator data without re-signing.
  const authData = Buffer.from(assertion.response.authenticatorData, 'base64url');
  authData.writeUInt32BE(9999, 33);
  assertion.response.authenticatorData = authData.toString('base64url');

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'bad_signature',
  );
});

test('an assertion cannot be replayed', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
  });

  await server.finishAuthentication(assertion as never);
  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'challenge_not_found',
  );
});

test("a registration challenge cannot be spent on a login", async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const registration = await server.startRegistration({ userId: user.id });
  const assertion = authenticator.assert({
    challenge: registration.options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
  });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'type_mismatch',
  );
});

test('a registration response cannot be replayed as a login', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
    tamper: { clientDataType: 'webauthn.create' },
  });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'type_mismatch',
  );
});

test('an assertion for another RP or origin is rejected', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  for (const [tamper, code] of [
    [{ rpId: 'evil.example.net' }, 'rpid_mismatch'],
    [{ origin: 'https://evil.example.net' }, 'origin_mismatch'],
    [{ crossOrigin: true }, 'origin_mismatch'],
  ] as const) {
    const { options } = await server.startAuthentication();
    const assertion = authenticator.assert({
      challenge: options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      tamper,
    });
    await assert.rejects(
      () => server.finishAuthentication(assertion as never),
      (error: PasskeyError) => error.code === code,
      JSON.stringify(tamper),
    );
  }
});

test('an unregistered credential is rejected', async () => {
  const { server } = makeServer();
  await seed(server, 'ada');

  const stranger = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startAuthentication();
  const assertion = stranger.assert({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'unknown_credential',
  );
});

test("one account's passkey cannot satisfy another account's login", async () => {
  const { server } = makeServer();
  await seed(server, 'ada');
  const bob = await seed(server, 'bob');

  // The ceremony was started for ada, but bob's passkey answers it.
  const { options } = await server.startAuthentication({ username: 'ada' });
  const assertion = bob.authenticator.assert({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'unknown_credential',
  );
});

test('a user handle that disagrees with the credential owner is rejected', async () => {
  const { server } = makeServer();
  const { authenticator } = await seed(server, 'ada');
  const bob = await seed(server, 'bob');

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: bob.user.id,
  });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'unknown_credential',
  );
});

test('userVerification: required rejects a presence-only assertion', async () => {
  const { server } = makeServer({ userVerification: 'required' });
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
    userVerified: false,
  });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'user_not_verified',
  );
});

test('a missing user-present flag is rejected', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  const assertion = authenticator.assert({
    challenge: options.challenge,
    origin: ORIGIN,
    userHandle: user.id,
    tamper: { flags: (flags) => flags & ~FLAG.UP },
  });

  await assert.rejects(
    () => server.finishAuthentication(assertion as never),
    (error: PasskeyError) => error.code === 'user_not_present',
  );
});

test('the signature counter advances and is persisted', async () => {
  const { server, store } = makeServer();
  const { authenticator, user } = await seed(server);

  for (const expected of [1, 2, 3]) {
    const { options } = await server.startAuthentication();
    const assertion = authenticator.assert({
      challenge: options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      signCount: expected,
    });
    const result = await server.finishAuthentication(assertion as never);
    assert.equal(result.signCount, expected);
  }

  const stored = await store.getCredentialById(
    Buffer.from(authenticator.credentialId).toString('base64url'),
  );
  assert.equal(stored?.counter, 3);
  assert.ok(stored?.lastUsedAt instanceof Date);
});

test('a counter that goes backwards is treated as a cloned authenticator', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  const first = await server.startAuthentication();
  await server.finishAuthentication(
    authenticator.assert({
      challenge: first.options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      signCount: 10,
    }) as never,
  );

  const second = await server.startAuthentication();
  await assert.rejects(
    () =>
      server.finishAuthentication(
        authenticator.assert({
          challenge: second.options.challenge,
          origin: ORIGIN,
          userHandle: user.id,
          signCount: 5,
        }) as never,
      ),
    (error: PasskeyError) => error.code === 'counter_regression',
  );
});

test('a counter that never moves is fine — most passkeys report zero forever', async () => {
  const { server } = makeServer();
  const { authenticator, user } = await seed(server);

  for (let i = 0; i < 3; i++) {
    const { options } = await server.startAuthentication();
    const result = await server.finishAuthentication(
      authenticator.assert({
        challenge: options.challenge,
        origin: ORIGIN,
        userHandle: user.id,
        signCount: 0,
      }) as never,
    );
    assert.equal(result.verified, true);
  }
});

test('onCounterRegression can override the rejection', async () => {
  const events: unknown[] = [];
  const { server } = makeServer({
    hooks: {
      onCounterRegression: (event: unknown) => {
        events.push(event);
        return true;
      },
    },
  });
  const { authenticator, user } = await seed(server);

  const first = await server.startAuthentication();
  await server.finishAuthentication(
    authenticator.assert({
      challenge: first.options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      signCount: 10,
    }) as never,
  );

  const second = await server.startAuthentication();
  const result = await server.finishAuthentication(
    authenticator.assert({
      challenge: second.options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      signCount: 5,
    }) as never,
  );

  assert.equal(result.verified, true);
  assert.equal(events.length, 1);
});

test('RSA and Ed25519 credentials authenticate correctly', async () => {
  for (const algorithm of ['RS256', 'EdDSA'] as const) {
    const { server } = makeServer({ supportedAlgorithms: [-7, -257, -8] });
    const { authenticator, user } = await seed(server, 'ada', { algorithm });

    const { options } = await server.startAuthentication();
    const result = await server.finishAuthentication(
      authenticator.assert({
        challenge: options.challenge,
        origin: ORIGIN,
        userHandle: user.id,
      }) as never,
    );
    assert.equal(result.verified, true, algorithm);

    // ...and a tampered one still fails for this algorithm.
    const next = await server.startAuthentication();
    const bad = authenticator.assert({
      challenge: next.options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      tamper: { signature: new Uint8Array(64) },
    });
    await assert.rejects(
      () => server.finishAuthentication(bad as never),
      (error: PasskeyError) => error.code === 'bad_signature',
      algorithm,
    );
  }
});

test('the onAuthenticated hook fires with the updated credential', async () => {
  const events: Array<{ user: { username: string }; credential: { counter: number } }> = [];
  const { server } = makeServer({
    hooks: { onAuthenticated: (event: never) => void events.push(event) },
  });
  const { authenticator, user } = await seed(server);

  const { options } = await server.startAuthentication();
  await server.finishAuthentication(
    authenticator.assert({
      challenge: options.challenge,
      origin: ORIGIN,
      userHandle: user.id,
      signCount: 7,
    }) as never,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].user.username, 'ada');
  assert.equal(events[0].credential.counter, 7);
});

test('credential management is scoped to the owning account', async () => {
  const { server } = makeServer();
  const ada = await seed(server, 'ada');
  const bob = await seed(server, 'bob');

  const adaCredentials = await server.listCredentials(ada.user.id);
  assert.equal(adaCredentials.length, 1);
  assert.equal(adaCredentials[0].deviceType, 'multiDevice');

  // Bob cannot touch ada's passkey even knowing its ID.
  await assert.rejects(
    () => server.deleteCredential(bob.user.id, adaCredentials[0].id),
    (error: PasskeyError) => error.code === 'unknown_credential',
  );
  await assert.rejects(
    () => server.renameCredential(bob.user.id, adaCredentials[0].id, 'mine now'),
    (error: PasskeyError) => error.code === 'unknown_credential',
  );

  await server.renameCredential(ada.user.id, adaCredentials[0].id, 'MacBook');
  assert.equal((await server.listCredentials(ada.user.id))[0].nickname, 'MacBook');
});

test('deleting the last passkey is refused so nobody locks themselves out', async () => {
  const { server } = makeServer();
  const { user } = await seed(server, 'ada');
  const [only] = await server.listCredentials(user.id);

  await assert.rejects(
    () => server.deleteCredential(user.id, only.id),
    (error: PasskeyError) =>
      // 409, not 500: this is a conflict with the account's state, not a fault.
      error.code === 'last_credential' && error.status === 409,
  );

  // With a second one registered, removal is allowed.
  const second = new VirtualAuthenticator({ rpId: RP_ID });
  const start = await server.startRegistration({ userId: user.id });
  await server.finishRegistration(
    second.create({ challenge: start.options.challenge, origin: ORIGIN }) as never,
  );

  await server.deleteCredential(user.id, only.id);
  assert.equal((await server.listCredentials(user.id)).length, 1);
});

test('garbage input produces a helpful error, not a crash', async () => {
  const { server } = makeServer();
  for (const input of [null, undefined, {}, 'nope', [], { type: 'public-key' }]) {
    await assert.rejects(
      () => server.finishAuthentication(input as never),
      (error: PasskeyError) => error instanceof PasskeyError,
      `input: ${JSON.stringify(input)}`,
    );
  }
});

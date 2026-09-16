import { test } from 'vitest';
import assert from 'node:assert/strict';

import { PasskeyServer, MemoryStore, PasskeyError } from 'passkify/server';
import { VirtualAuthenticator, FLAG } from '#internal/testing/index.js';

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

/** Run a whole registration and return the result. */
async function registerFully(
  server: PasskeyServer,
  username: string,
  authenticator = new VirtualAuthenticator({ rpId: RP_ID }),
) {
  const { options } = await server.startRegistration({ username });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });
  const result = await server.finishRegistration(response as never);
  return { result, authenticator, options };
}

test('a registration completes and stores a usable credential', async () => {
  const { server, store } = makeServer();
  const { result, authenticator } = await registerFully(server, 'ada');

  assert.equal(result.verified, true);
  assert.equal(result.user.username, 'ada');
  assert.equal(result.isNewUser, true);
  assert.equal(result.attestation.format, 'none');
  assert.equal(result.attestation.type, 'none');
  assert.equal(result.credential.algorithm, -7);
  assert.equal(result.credential.deviceType, 'multiDevice');
  assert.equal(result.credential.backedUp, true);
  assert.deepEqual(result.credential.transports, ['internal', 'hybrid']);

  const stored = await store.getCredentialById(
    Buffer.from(authenticator.credentialId).toString('base64url'),
  );
  assert.ok(stored, 'the credential was persisted');
  assert.equal(stored.userId, result.user.id);
});

test('the account is only created once the ceremony succeeds', async () => {
  const { server, store } = makeServer();
  await server.startRegistration({ username: 'abandoned' });

  // The visitor closed the prompt. No half-made account should be left behind.
  assert.equal(await store.getUserByUsername('abandoned'), null);
});

test('options carry the configured RP, algorithms and selection criteria', async () => {
  const { server } = makeServer({ userVerification: 'required', residentKey: 'required' });
  const { options } = await server.startRegistration({ username: 'ada', displayName: 'Ada L' });

  assert.equal(options.rp.id, RP_ID);
  assert.equal(options.rp.name, 'Example');
  assert.equal(options.user.name, 'ada');
  assert.equal(options.user.displayName, 'Ada L');
  assert.deepEqual(
    options.pubKeyCredParams.map((p) => p.alg),
    [-7, -257],
  );
  assert.equal(options.authenticatorSelection?.userVerification, 'required');
  assert.equal(options.authenticatorSelection?.residentKey, 'required');
  assert.equal(options.authenticatorSelection?.requireResidentKey, true);
  assert.equal(options.attestation, 'none');
  // 32 random bytes -> 43 base64url characters.
  assert.equal(options.challenge.length, 43);
});

test('challenges are unpredictable', async () => {
  const { server } = makeServer();
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const { options } = await server.startRegistration({ username: `user${i}` });
    seen.add(options.challenge);
  }
  assert.equal(seen.size, 50);
});

test('a challenge cannot be used twice', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });

  await server.finishRegistration(response as never);
  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'challenge_not_found',
  );
});

test('an expired challenge is refused', async () => {
  const { server } = makeServer({ challengeTimeout: -1 });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'challenge_not_found',
  );
});

test('a response signed for a different origin is refused', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { origin: 'https://evil.example.net' },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'origin_mismatch',
  );
});

test('a response signed for a different rpID is refused', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { rpId: 'evil.example.net' },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'rpid_mismatch',
  );
});

test('a login response cannot be replayed as a registration', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { clientDataType: 'webauthn.get' },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'type_mismatch',
  );
});

test('a ceremony run inside a cross-origin frame is refused', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { crossOrigin: true },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'origin_mismatch',
  );
});

test('a response without the user-present flag is refused', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { flags: (flags) => flags & ~FLAG.UP },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'user_not_present',
  );
});

test('userVerification: required rejects a presence-only response', async () => {
  const { server } = makeServer({ userVerification: 'required' });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    userVerified: false,
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'user_not_verified',
  );
});

test('userVerification: preferred accepts a presence-only response', async () => {
  const { server } = makeServer({ userVerification: 'preferred' });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    userVerified: false,
  });

  const result = await server.finishRegistration(response as never);
  assert.equal(result.verified, true);
});

test('the backup-state flag without backup-eligible is refused as malformed', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    tamper: { flags: (flags) => (flags & ~FLAG.BE) | FLAG.BS },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'parse_error',
  );
});

test('requireBackupEligible turns away single-device authenticators', async () => {
  const { server } = makeServer({ requireBackupEligible: true });
  const authenticator = new VirtualAuthenticator({
    rpId: RP_ID,
    backupEligible: false,
    backedUp: false,
  });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'attestation_failed',
  );
});

test('a hardware key registers as singleDevice', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({
    rpId: RP_ID,
    backupEligible: false,
    backedUp: false,
  });
  const { result } = await registerFully(server, 'ada', authenticator);
  assert.equal(result.credential.deviceType, 'singleDevice');
  assert.equal(result.credential.backedUp, false);
});

test('taking over an existing username is refused', async () => {
  const { server } = makeServer();
  await registerFully(server, 'ada');

  await assert.rejects(
    () => server.startRegistration({ username: 'ada' }),
    (error: PasskeyError) =>
      error.code === 'credential_exists' && /sign in first/.test(error.message),
  );
});

test('a signed-in user can add a second passkey, and it is excluded next time', async () => {
  const { server } = makeServer();
  const { result } = await registerFully(server, 'ada');

  const second = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ userId: result.user.id });

  assert.equal(options.excludeCredentials?.length, 1, 'the first passkey is excluded');
  assert.equal(options.user.id, Buffer.from(result.user.id).toString('base64url'));

  const response = second.create({ challenge: options.challenge, origin: ORIGIN });
  const added = await server.finishRegistration(response as never);

  assert.equal(added.isNewUser, false);
  assert.equal(added.user.id, result.user.id);
  assert.equal((await server.listCredentials(result.user.id)).length, 2);
});

test('the same credential cannot be registered twice', async () => {
  const { server } = makeServer();
  const { result, authenticator } = await registerFully(server, 'ada');

  const { options } = await server.startRegistration({ userId: result.user.id });
  const replay = authenticator.create({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishRegistration(replay as never),
    (error: PasskeyError) => error.code === 'credential_exists',
  );
});

test('packed self-attestation verifies, and a wrong signature does not', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    attestation: 'packed',
  });

  const result = await server.finishRegistration(response as never);
  assert.equal(result.attestation.format, 'packed');
  assert.equal(result.attestation.type, 'self');
  // No roots were supplied, so nothing can be called trusted.
  assert.equal(result.attestation.trusted, false);
});

test('an attestation format passkify cannot verify still registers when none was asked for', async () => {
  // A TPM-backed Windows Hello sends fmt: "tpm" even under the default
  // attestation: "none". Refusing it would lock out real users over a
  // statement the site never requested.
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    attestation: {
      format: 'tpm',
      statement: new Map<string | number, never>([['ver', '2.0' as never]]),
    },
  });

  const result = await server.finishRegistration(response as never);

  assert.equal(result.verified, true);
  // Reported honestly: the real format, and nothing claimed about trust.
  assert.equal(result.attestation.format, 'tpm');
  assert.equal(result.attestation.type, 'none');
  assert.equal(result.attestation.trusted, false);
});

test('an unverifiable attestation format is refused when the site did ask for one', async () => {
  const { server } = makeServer({ attestation: 'direct' });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    attestation: { format: 'tpm' },
  });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'unsupported_feature',
  );
});

test('a tampered packed attestation is rejected', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({
    challenge: options.challenge,
    origin: ORIGIN,
    attestation: 'packed',
  });

  // Flip a bit inside the attestation object's signature region.
  const bytes = Buffer.from(response.response.attestationObject, 'base64url');
  bytes[bytes.length - 40] ^= 0xff;
  response.response.attestationObject = bytes.toString('base64url');

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'attestation_failed' || error.code === 'parse_error',
  );
});

test('RSA and Ed25519 authenticators are supported when offered', async () => {
  for (const [algorithm, alg] of [
    ['RS256', -257],
    ['EdDSA', -8],
  ] as const) {
    const { server } = makeServer({ supportedAlgorithms: [-7, -257, -8] });
    const authenticator = new VirtualAuthenticator({ rpId: RP_ID, algorithm });
    const { result } = await registerFully(server, `user-${algorithm}`, authenticator);
    assert.equal(result.credential.algorithm, alg, algorithm);
  }
});

test('an algorithm we did not offer is refused', async () => {
  const { server } = makeServer({ supportedAlgorithms: [-257] });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID, algorithm: 'ES256' });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'unsupported_algorithm',
  );
});

test('rawId must agree with the credential ID inside the authenticator data', async () => {
  const { server } = makeServer();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });
  const { options } = await server.startRegistration({ username: 'ada' });
  const response = authenticator.create({ challenge: options.challenge, origin: ORIGIN });
  response.rawId = Buffer.from('a different credential id').toString('base64url');

  await assert.rejects(
    () => server.finishRegistration(response as never),
    (error: PasskeyError) => error.code === 'malformed_response',
  );
});

test('garbage input produces a helpful error, not a crash', async () => {
  const { server } = makeServer();
  for (const input of [null, undefined, {}, 'nope', 42, [], { type: 'public-key' }]) {
    await assert.rejects(
      () => server.finishRegistration(input as never),
      (error: PasskeyError) => error instanceof PasskeyError,
      `input: ${JSON.stringify(input)}`,
    );
  }
});

test('the onRegistered hook fires with the stored credential', async () => {
  const events: unknown[] = [];
  const { server } = makeServer({
    hooks: { onRegistered: (event: unknown) => void events.push(event) },
  });
  await registerFully(server, 'ada');

  assert.equal(events.length, 1);
  const event = events[0] as { user: { username: string }; isNewUser: boolean };
  assert.equal(event.user.username, 'ada');
  assert.equal(event.isNewUser, true);
});

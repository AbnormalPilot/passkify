/**
 * End-to-end over a real HTTP server.
 *
 * The other tests call the library directly. This one starts `node:http`, mounts
 * the Express-style middleware with no body parser in front of it, and drives it
 * with `fetch` — so it covers the parts only a real request exercises: reading
 * and parsing the body off the raw stream, header handling, status codes, and
 * cookies set from the hooks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { PasskeyServer, MemoryStore } from '../dist/esm/server/index.js';
import { VirtualAuthenticator } from './helpers/virtual-authenticator.ts';

const RP_ID = 'localhost';

/** Boot an http server on an ephemeral port and return its origin. */
async function boot(build: (origin: string) => (req: never, res: never, next: () => void) => unknown) {
  let middleware: ReturnType<typeof build> | undefined;

  const server: Server = createServer((request, response) => {
    void middleware?.(request as never, response as never, () => {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const origin = `http://localhost:${port}`;
  middleware = build(origin);

  return {
    origin,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('a full sign-up and sign-in over real HTTP, with no body parser mounted', async () => {
  const store = new MemoryStore();
  const sessions = new Map<string, string>();

  const app = await boot((origin) => {
    const passkeys = new PasskeyServer({
      rpName: 'Example',
      origin,
      rpID: RP_ID,
      store,
    });
    return passkeys.express({
      basePath: '/passkey',
      getSessionUserId: (request) => {
        const cookie = String(request.headers.cookie ?? '');
        const match = /session=([^;]+)/.exec(cookie);
        return match ? (sessions.get(match[1]) ?? null) : null;
      },
      onRegister: (_request, response, { user }) => {
        const token = `t${sessions.size + 1}`;
        sessions.set(token, user.id);
        response.setHeader('set-cookie', `session=${token}; Path=/; HttpOnly`);
      },
      onLogin: (_request, response, { user }) => {
        const token = `t${sessions.size + 1}`;
        sessions.set(token, user.id);
        response.setHeader('set-cookie', `session=${token}; Path=/; HttpOnly`);
      },
    }) as never;
  });

  try {
    const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

    const post = (path: string, body: unknown, cookie?: string) =>
      fetch(`${app.origin}/passkey${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });

    // --- sign up ---
    const startResponse = await post('/register/start', { username: 'ada' });
    assert.equal(startResponse.status, 200);
    const options = await startResponse.json();
    assert.equal(options.rp.id, RP_ID);

    const finishResponse = await post(
      '/register/finish',
      authenticator.create({ challenge: options.challenge, origin: app.origin }),
    );
    assert.equal(finishResponse.status, 200);
    const registered = await finishResponse.json();
    assert.equal(registered.verified, true);
    assert.equal(registered.user.username, 'ada');

    const cookie = (finishResponse.headers.get('set-cookie') ?? '').split(';')[0];
    assert.match(cookie, /^session=t\d+$/);

    // --- sign in, usernameless ---
    const loginStart = await (await post('/login/start', {})).json();
    assert.equal(loginStart.allowCredentials, undefined);

    const loginResponse = await post(
      '/login/finish',
      authenticator.assert({
        challenge: loginStart.challenge,
        origin: app.origin,
        userHandle: registered.user.id,
      }),
    );
    assert.equal(loginResponse.status, 200);
    assert.equal((await loginResponse.json()).user.id, registered.user.id);

    // --- the session unlocks credential management ---
    const list = await fetch(`${app.origin}/passkey/credentials`, { headers: { cookie } });
    assert.equal(list.status, 200);
    const credentials = await list.json();
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0].deviceType, 'multiDevice');

    // ...and without the cookie it does not.
    assert.equal((await fetch(`${app.origin}/passkey/credentials`)).status, 401);

    // --- unrelated routes still fall through to the app ---
    assert.equal((await fetch(`${app.origin}/anything/else`)).status, 404);

    // --- a replayed login is refused ---
    const replay = await post(
      '/login/finish',
      authenticator.assert({
        challenge: loginStart.challenge,
        origin: app.origin,
        userHandle: registered.user.id,
      }),
    );
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error, 'challenge_not_found');
  } finally {
    await app.close();
  }
});

test('an empty or malformed body is answered, not hung on', async () => {
  const store = new MemoryStore();
  const app = await boot((origin) => {
    const passkeys = new PasskeyServer({ rpName: 'Example', origin, rpID: RP_ID, store });
    return passkeys.express() as never;
  });

  try {
    for (const body of [undefined, '', 'not json at all', '{"broken":']) {
      const response = await fetch(`${app.origin}/passkey/login/finish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body }),
      });
      assert.equal(response.status, 400, `body: ${String(body)}`);
      assert.equal((await response.json()).error, 'malformed_response');
    }
  } finally {
    await app.close();
  }
});

test('an oversized body is rejected rather than buffered', async () => {
  const store = new MemoryStore();
  const app = await boot((origin) => {
    const passkeys = new PasskeyServer({ rpName: 'Example', origin, rpID: RP_ID, store });
    return passkeys.express() as never;
  });

  try {
    const response = await fetch(`${app.origin}/passkey/login/finish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }),
    });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});

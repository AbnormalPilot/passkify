import { test } from 'vitest';
import assert from 'node:assert/strict';

import { PasskeyServer, MemoryStore } from 'passkify/server';
import { VirtualAuthenticator } from '#internal/testing/index.js';

const RP_ID = 'example.com';
const ORIGIN = 'https://example.com';
const BASE = '/api/passkey';

function makeHandler(options: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: RP_ID,
    origin: ORIGIN,
    store,
  });
  return { server, store, handler: server.handler({ basePath: BASE, ...options }) };
}

const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the fetch handler runs a full sign-up then sign-in', async () => {
  const { handler } = makeHandler();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const startResponse = await handler(post('/register/start', { username: 'ada' }));
  assert.equal(startResponse.status, 200);
  assert.equal(startResponse.headers.get('cache-control'), 'no-store');
  const options = await startResponse.json();

  const finishResponse = await handler(
    post(
      '/register/finish',
      authenticator.create({ challenge: options.challenge, origin: ORIGIN }),
    ),
  );
  assert.equal(finishResponse.status, 200);
  const registered = await finishResponse.json();
  assert.equal(registered.verified, true);
  assert.equal(registered.user.username, 'ada');
  assert.equal(registered.isNewUser, true);

  const loginStart = await (await handler(post('/login/start', {}))).json();
  const loginResponse = await handler(
    post(
      '/login/finish',
      authenticator.assert({
        challenge: loginStart.challenge,
        origin: ORIGIN,
        userHandle: registered.user.id,
      }),
    ),
  );
  assert.equal(loginResponse.status, 200);
  const loggedIn = await loginResponse.json();
  assert.equal(loggedIn.user.id, registered.user.id);
});

test('a ceremony response wrapped in { response } is also accepted', async () => {
  const { handler } = makeHandler();
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const options = await (await handler(post('/register/start', { username: 'ada' }))).json();
  const response = await handler(
    post('/register/finish', {
      response: authenticator.create({ challenge: options.challenge, origin: ORIGIN }),
    }),
  );
  assert.equal(response.status, 200);
});

test('failures come back as JSON with a code and a sane status', async () => {
  const { handler } = makeHandler();
  const response = await handler(post('/login/finish', { nonsense: true }));

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'malformed_response');
  assert.match(body.message, /passkify\/client/);
});

test('the onLogin hook can take over the response entirely', async () => {
  const { handler } = makeHandler({
    onLogin: () => new Response('welcome', { status: 302, headers: { location: '/app' } }),
  });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const options = await (await handler(post('/register/start', { username: 'ada' }))).json();
  const registered = await (
    await handler(
      post(
        '/register/finish',
        authenticator.create({ challenge: options.challenge, origin: ORIGIN }),
      ),
    )
  ).json();

  const loginStart = await (await handler(post('/login/start', {}))).json();
  const response = await handler(
    post(
      '/login/finish',
      authenticator.assert({
        challenge: loginStart.challenge,
        origin: ORIGIN,
        userHandle: registered.user.id,
      }),
    ),
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/app');
});

test('the onLogin hook can merge headers, e.g. a session cookie', async () => {
  const { handler } = makeHandler({
    onLogin: (_request: Request, result: { user: { id: string } }) => ({
      'set-cookie': `session=${result.user.id}; HttpOnly; Path=/`,
    }),
  });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  const options = await (await handler(post('/register/start', { username: 'ada' }))).json();
  const registered = await (
    await handler(
      post(
        '/register/finish',
        authenticator.create({ challenge: options.challenge, origin: ORIGIN }),
      ),
    )
  ).json();

  const loginStart = await (await handler(post('/login/start', {}))).json();
  const response = await handler(
    post(
      '/login/finish',
      authenticator.assert({
        challenge: loginStart.challenge,
        origin: ORIGIN,
        userHandle: registered.user.id,
      }),
    ),
  );

  assert.match(response.headers.get('set-cookie') ?? '', /^session=/);
  assert.equal((await response.json()).verified, true);
});

test('credential management requires a session', async () => {
  const { handler } = makeHandler();
  const response = await handler(new Request(`${ORIGIN}${BASE}/credentials`));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unknown_user');
});

test('with a session, credential management works and username is ignored', async () => {
  let sessionUserId: string | null = null;
  const { handler } = makeHandler({ getSessionUserId: () => sessionUserId });

  // Sign up (no session yet).
  const first = new VirtualAuthenticator({ rpId: RP_ID });
  const options = await (await handler(post('/register/start', { username: 'ada' }))).json();
  const registered = await (
    await handler(
      post('/register/finish', first.create({ challenge: options.challenge, origin: ORIGIN })),
    )
  ).json();

  sessionUserId = registered.user.id;

  // A signed-in visitor adding a device: the username in the body must not be
  // able to redirect the registration at somebody else's account.
  const second = new VirtualAuthenticator({ rpId: RP_ID });
  const addOptions = await (
    await handler(post('/register/start', { username: 'someone-else' }))
  ).json();
  assert.equal(addOptions.user.name, 'ada', 'the session wins over the request body');

  await handler(
    post('/register/finish', second.create({ challenge: addOptions.challenge, origin: ORIGIN })),
  );

  const list = await (await handler(new Request(`${ORIGIN}${BASE}/credentials`))).json();
  assert.equal(list.length, 2);

  const rename = await handler(
    new Request(`${ORIGIN}${BASE}/credentials/${encodeURIComponent(list[0].id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'Work laptop' }),
    }),
  );
  assert.equal(rename.status, 200);

  const remove = await handler(
    new Request(`${ORIGIN}${BASE}/credentials/${encodeURIComponent(list[0].id)}`, {
      method: 'DELETE',
    }),
  );
  assert.equal(remove.status, 200);
  assert.equal(
    (await (await handler(new Request(`${ORIGIN}${BASE}/credentials`))).json()).length,
    1,
  );
});

test('a mismatched basePath says so instead of failing mysteriously', async () => {
  const { handler } = makeHandler();
  const response = await handler(
    new Request(`${ORIGIN}/wrong/place/login/start`, { method: 'POST' }),
  );

  assert.equal(response.status, 404);
  const body = await response.json();
  assert.match(body.message, /mounted at "\/api\/passkey".*basePath/s);
});

test('an unknown route under the mount point is a 404', async () => {
  const { handler } = makeHandler();
  const response = await handler(post('/nope', {}));
  assert.equal(response.status, 404);
});

test('the express middleware handles a full sign-up and calls next() for other paths', async () => {
  const store = new MemoryStore();
  const server = new PasskeyServer({
    rpName: 'Example',
    rpID: RP_ID,
    origin: ORIGIN,
    store,
  });
  const middleware = server.express({ basePath: '/passkey' });
  const authenticator = new VirtualAuthenticator({ rpId: RP_ID });

  /** Minimal express-shaped request/response doubles. */
  const run = async (method: string, url: string, body?: unknown) => {
    const chunks: string[] = [];
    let nextCalled = false;
    const response = {
      statusCode: 200,
      writableEnded: false,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(chunk?: string) {
        if (chunk) chunks.push(chunk);
        this.writableEnded = true;
      },
    };
    await middleware(
      { method, url, headers: {}, body, on: () => undefined } as never,
      response as never,
      () => {
        nextCalled = true;
      },
    );
    return {
      status: response.statusCode,
      body: chunks.length ? JSON.parse(chunks.join('')) : undefined,
      nextCalled,
      headers: response.headers,
    };
  };

  const start = await run('POST', '/passkey/register/start', { username: 'ada' });
  assert.equal(start.status, 200);
  assert.equal(start.headers['cache-control'], 'no-store');

  const finish = await run(
    'POST',
    '/passkey/register/finish',
    authenticator.create({ challenge: start.body.challenge, origin: ORIGIN }),
  );
  assert.equal(finish.status, 200);
  assert.equal(finish.body.verified, true);

  const unrelated = await run('GET', '/some/other/route');
  assert.equal(unrelated.nextCalled, true, 'unrelated routes fall through to the app');

  const badLogin = await run('POST', '/passkey/login/finish', { junk: true });
  assert.equal(badLogin.status, 400);
  assert.equal(badLogin.body.error, 'malformed_response');
});

---
name: passkify-server
description: Configure and mount the passkify passkey server — PasskeyServer options (rpID, origin, userVerification, residentKey, relatedOrigins, hints, extensions), the four ceremony methods, and HTTP adapters for Express, Next.js App Router, Hono, Fastify, SvelteKit, Remix and Cloudflare Workers. Use when wiring passkify into a backend, choosing server options, mounting passkey routes, establishing a session after a ceremony, or serving /.well-known/webauthn. Not for browser code (see passkify-client) or for implementing a store (see passkify-storage).
license: MIT
---

# passkify on the server

```ts
import { PasskeyServer } from 'passkify/server';

const passkeys = new PasskeyServer({
  rpName: 'Example',              // shown in the OS prompt
  rpID: 'example.com',
  origin: 'https://example.com',
  store,
});
```

The constructor validates eagerly and refuses configurations that would fail
later at a point where the cause is unrecoverable. That is deliberate: a bad
`rpID` is not discovered until a user cannot sign in, and by then credentials
exist that are bound to the wrong value.

## rpID and origin

The single most common failure.

| Deployment | `origin` | `rpID` |
| --- | --- | --- |
| Local development | `http://localhost:3000` | `localhost` |
| Production | `https://example.com` | `example.com` |
| Subdomain, credentials shared with the parent | `https://app.example.com` | `example.com` |
| Subdomain, credentials scoped to it | `https://app.example.com` | `app.example.com` |
| Several origins, one site | `['https://example.com', 'https://www.example.com']` | `example.com` |

- `origin` is a full origin: scheme, host, and port when it is not the default.
- `rpID` is a bare hostname: no scheme, no port, no path, no trailing slash.
- `rpID` must equal the origin's host or be a registrable parent of it.
- **Changing `rpID` orphans every existing credential.** There is no migration.
  Choose the widest domain you might ever need, once.

For genuinely different domains — `example.de`, `example.co.uk` — see Related
Origins below rather than adding them to `origin` alone.

## Every option

| Option | Default | Notes |
| --- | --- | --- |
| `rpName` | required | Shown in the OS prompt. |
| `rpID` | derived from `origin` | See above. |
| `origin` | required | String, array, `RegExp`, or predicate. |
| `store` | required | See **passkify-storage**. |
| `userVerification` | `'preferred'` | `'required'` forces a PIN or biometric. `'discouraged'` gives presence only. |
| `residentKey` | `'preferred'` | `'required'` enables usernameless sign-in but consumes one of a hardware key's ~25 slots. |
| `authenticatorAttachment` | unset | `'platform'` for this device only, `'cross-platform'` for security keys. |
| `attestation` | `'none'` | Leave it. Requesting attestation shows a scarier prompt and proves nothing without `attestationRootCertificates`. |
| `timeout` | `60000` | How long the browser prompt stays up. |
| `challengeTimeout` | `300000` | Server-side challenge lifetime. |
| `supportedAlgorithms` | `[-7, -257]` | ES256 and RS256. An algorithm passkify cannot verify is refused at construction. |
| `requireBackupEligible` | `false` | Turning this on refuses every hardware security key. |
| `relatedOrigins` | `false` | See below. |
| `hints` | `[]` | `'client-device'`, `'security-key'`, `'hybrid'`. A hint, not a constraint. |
| `extensions` | `{}` | `credProps` is always requested. `prf` derives an encryption key — design the recovery path first. |
| `explain` | `false` | Returns the full check trace on the result. Development only. |
| `hooks` | `{}` | `onRegistered`, `onAuthenticated`, `onCounterRegression`, `onCheck`. |

## The four ceremony methods

```ts
const { options, userId, isNewUser } = await passkeys.startRegistration({ username });
const result = await passkeys.finishRegistration(responseFromBrowser);

const { options } = await passkeys.startAuthentication({ username }); // omit for usernameless
const result = await passkeys.finishAuthentication(responseFromBrowser);
```

**They throw on failure.** There is no `{ verified: false }`; a returned result
is a verified one. Catch `PasskeyError` and branch on `.code`.

**A verified result is not a session.** Issue yours in the adapter hook or
immediately after `finishAuthentication`, or sign-in silently does nothing.

## Registering versus adding a device

```ts
// New account: username from the request body.
await passkeys.startRegistration({ username: body.username });

// Signed-in user adding another passkey: userId from the SESSION, never the body.
await passkeys.startRegistration({ userId: session.userId });
```

Passing a body-supplied `username` for a signed-in user attaches a passkey to a
different account. The mounted routes already prefer the session over the body
for exactly this reason — match that behaviour in any custom route.

## Mounting the routes

Every adapter mounts the same seven routes under `basePath` (default
`/passkey`): `POST /register/start`, `POST /register/finish`,
`POST /login/start`, `POST /login/finish`, `GET /credentials`,
`PATCH /credentials/:id`, `DELETE /credentials/:id`, plus `GET /signals`.

```ts
// Express / Connect
app.use(passkeys.express({
  basePath: '/passkey',
  getSessionUserId: (req) => req.session?.userId ?? null,
  onRegister: (req, res, result) => { req.session.userId = result.user.id; },
  onLogin: (req, res, result) => { req.session.userId = result.user.id; },
}));

// Any fetch runtime
const handler = passkeys.handler({ basePath: '/passkey' });

// Next.js App Router — app/api/passkey/[...passkey]/route.ts
import { passkeyRoutes } from 'passkify/next';
export const { GET, POST, PATCH, DELETE, runtime, dynamic } =
  passkeyRoutes(passkeys, { basePath: '/api/passkey' });

// Hono
import { passkifyHono } from 'passkify/hono';
app.all('/passkey/*', passkifyHono(passkeys));

// Fastify
import { passkifyFastify } from 'passkify/fastify';
await app.register(passkifyFastify, { server: passkeys, basePath: '/passkey' });

// SvelteKit — src/routes/passkey/[...path]/+server.ts
import { passkeyHandlers } from 'passkify/sveltekit';
export const { GET, POST, PATCH, DELETE } = passkeyHandlers(passkeys);

// Remix — app/routes/passkey.$.tsx
import { passkeyLoader, passkeyAction } from 'passkify/remix';
export const loader = passkeyLoader(passkeys);
export const action = passkeyAction(passkeys);

// Cloudflare Workers
import { passkeyWorker } from 'passkify/cloudflare';
export default { fetch: passkeyWorker((env) => buildServer(env)) };
```

**`basePath` must match where the routes actually live**, and the client's
`baseUrl` must match `basePath`. A mismatch is the most common "it returns 500"
report. In Next.js the directory name is the path: `app/api/passkey/[...x]/`
means `basePath: '/api/passkey'`.

## Related Origin Requests

One passkey across `example.com`, `example.de` and `example.co.uk`:

```ts
new PasskeyServer({
  rpID: 'example.com',
  origin: ['https://example.com', 'https://example.de', 'https://example.co.uk'],
  relatedOrigins: true,
  store,
});
```

The adapters then serve `/.well-known/webauthn` at the site root. The list is
derived from `origin` — there is no second list to keep in sync, which is the
whole point, because a file that disagrees with the server fails silently in one
direction only.

Constraints, both enforced at construction: every `origin` must be a plain
string (a `RegExp` cannot be published), and the list may cover at most **five**
registrable labels, because browsers ignore the rest silently.

Browser support: Chrome/Edge 128+, Safari 18+, Firefox 152+.

## Do not do this

```ts
// ✗ Trusting the body for a signed-in user
await passkeys.startRegistration({ username: req.body.username });

// ✓ The session decides whose account this is
await passkeys.startRegistration({ userId: req.session.userId });
```

```ts
// ✗ Checking a boolean that is always true
const result = await passkeys.finishAuthentication(response);
if (result.verified) { /* ... */ }

// ✓ Failure arrives as an exception
try {
  const result = await passkeys.finishAuthentication(response);
  req.session.userId = result.user.id;
} catch (error) {
  if (error instanceof PasskeyError) return res.status(error.status).json(error.toJSON());
  throw error;
}
```

```ts
// ✗ Verified, and then nothing happens
await passkeys.finishAuthentication(response);
return res.json({ ok: true });

// ✓ Verification is not a session
const result = await passkeys.finishAuthentication(response);
req.session.userId = result.user.id;
```

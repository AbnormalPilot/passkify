<div align="center">

# passkify

**Passkeys for your website, without the WebAuthn homework.**

[![npm](https://img.shields.io/npm/v/passkify?color=%23f36458&label=npm)](https://www.npmjs.com/package/passkify)
[![downloads](https://img.shields.io/npm/dm/passkify?color=%23f36458)](https://www.npmjs.com/package/passkify)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://docs.npmjs.com/generating-provenance-statements)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/passkify?activeTab=dependencies)
[![CI](https://github.com/AbnormalPilot/passkify/actions/workflows/ci.yml/badge.svg)](https://github.com/AbnormalPilot/passkify/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[Documentation](https://passkify.himanshubuilds.in) ·
[Live demo](https://passkify.himanshubuilds.in/demo) ·
[Quickstart](https://passkify.himanshubuilds.in/docs/quickstart) ·
[For AI agents](https://passkify.himanshubuilds.in/llms.txt)

</div>

---

Signing in with a passkey takes one tap. Accepting one takes about six hundred
lines of specification. This library is that six hundred lines, so your
application does not have to be.

```bash
npm install passkify
```

## The whole thing

```ts
// server.ts
import { PasskeyServer, MemoryStore } from 'passkify/server';

const passkeys = new PasskeyServer({
  rpName: 'Example',
  rpID: 'example.com',            // bare hostname
  origin: 'https://example.com',  // scheme, and port when non-default
  store: new MemoryStore(),       // development only
});

app.use(
  passkeys.express({
    getSessionUserId: (req) => req.session.userId ?? null,
    onLogin: (req, _res, result) => {
      req.session.userId = result.user.id;
    },
  }),
);
```

```ts
// browser.ts
import { register, login } from 'passkify/client';

await register({ username: 'ada@example.com' });
await login({ username: 'ada@example.com' });
```

That is a working passwordless sign-up and sign-in. Everything below is
configuration.

## What you get

- **Client and server in one package.** Not two installs that have to agree.
- **Zero runtime dependencies**, enforced in CI. The CBOR decoder, the COSE key
  parsing, the X.509 handling and the CLI are all written here, on purpose.
- **Every check the specification asks for** — 33 of them, in a table the tests
  verify the code actually performs.
- **Runs everywhere**: Node 20+, Bun, Deno, Cloudflare Workers, Vercel Edge.
  The verification path is pure WebCrypto, with no `node:crypto` anywhere.
- **WebAuthn Level 3**: the signal methods that stop deleted passkeys haunting
  the OS picker, `getClientCapabilities()`, Related Origin Requests, conditional
  create, and the `prf` extension.
- **Typed errors on both sides of the wire.** The same `code` in the browser and
  on the server.
- **Adapters that exist**: Express, Next.js, Hono, Fastify, SvelteKit, Remix,
  Cloudflare Workers · Postgres, Prisma, Redis, MongoDB, SQLite · React hooks.

## Framework and storage

<details>
<summary><b>Next.js App Router</b></summary>

```ts
// app/api/passkey/[...passkey]/route.ts
import { passkeyRoutes } from 'passkify/next';
import { passkeys } from '@/lib/passkeys';

export const { GET, POST, PATCH, DELETE, runtime, dynamic } = passkeyRoutes(passkeys, {
  basePath: '/api/passkey',   // must match this directory
});
```
</details>

<details>
<summary><b>Hono, Fastify, SvelteKit, Remix, Cloudflare Workers</b></summary>

```ts
import { passkifyHono } from 'passkify/hono';
app.all('/passkey/*', passkifyHono(passkeys));

import { passkifyFastify } from 'passkify/fastify';
await app.register(passkifyFastify, { server: passkeys, basePath: '/passkey' });

import { passkeyHandlers } from 'passkify/sveltekit';
export const { GET, POST, PATCH, DELETE } = passkeyHandlers(passkeys);

import { passkeyLoader, passkeyAction } from 'passkify/remix';
export const loader = passkeyLoader(passkeys);
export const action = passkeyAction(passkeys);

import { passkeyWorker } from 'passkify/cloudflare';
export default { fetch: passkeyWorker((env) => buildServer(env)) };
```
</details>

<details>
<summary><b>Postgres, Prisma, Redis, MongoDB, SQLite</b></summary>

Each takes the client you already have — none of them is a dependency of this
package.

```ts
import { postgresStore } from 'passkify/stores/postgres';
const store = postgresStore(pool);

import { prismaStore } from 'passkify/stores/prisma';
const store = prismaStore(prisma);

import { redisStore } from 'passkify/stores/redis';
const store = redisStore(redis);
```

Writing your own? Run the contract against it:

```ts
import { runStoreConformance } from 'passkify/store-conformance';
runStoreConformance({ test, createStore });
```

Nineteen cases, including a real concurrency race on `takeChallenge` — the
check that catches a read-then-delete implementation, which permits replay.
</details>

<details>
<summary><b>React</b></summary>

```tsx
import { useLogin, usePasskeyAutofill } from 'passkify/react';

const { login, pending, error } = useLogin();
usePasskeyAutofill((result) => router.push('/dashboard'));
```
</details>

## Design decisions

**Failure throws.** `finishRegistration` and `finishAuthentication` never return
`{ verified: false }`. A returned result is a verified one, so there is no
truthiness check to forget.

**One challenge, one attempt.** `takeChallenge` fetches and deletes atomically.
A replayed response finds nothing.

**Registration cannot claim an account.** When a session exists, the username in
the request body is ignored entirely.

**Login reveals nothing.** An unknown username gets a normal-looking challenge,
so the login endpoint is not an account-enumeration oracle.

**Attestation is verified, never required.** Consumer passkeys send
`fmt: "none"` by design. A format passkify cannot verify is reported honestly
rather than refused — which is why a TPM-backed Windows Hello registers.

**Zero runtime dependencies.** Every byte that verifies a signature is in this
repository and is auditable in an afternoon.

## Why not `@simplewebauthn/server`?

SimpleWebAuthn is the incumbent, it is FIDO-conformance tested, it has years of
production use behind it, and if you want the most widely deployed option it is
the right answer. Use it without hesitation.

passkify is a different trade. It gives you the browser half, the server half,
the framework adapters, the database adapters and the React hooks in one install
with no dependencies; the same typed error codes on both sides of the wire; a
verification checklist the test suite proves the code performs; a conformance
suite for your own storage layer; and `npx passkify doctor` to find the wiring
mistake before your users do. It is younger, and it has not been through FIDO
conformance.

## For AI agents

```bash
npx passkify skills install    # five skills, for Claude Code, Cursor, Codex, Copilot, Gemini, OpenCode
npx passkify mcp               # an MCP server over the docs, error codes and config validator
npx passkify doctor            # check an integration
npx passkify init              # scaffold one
```

Also: [`/llms.txt`](https://passkify.himanshubuilds.in/llms.txt),
[`/llms-full.txt`](https://passkify.himanshubuilds.in/llms-full.txt), and a
`.md` twin of every documentation page.

## Requirements

Node 20+, Bun, Deno, Cloudflare Workers or Vercel Edge on the server. In the
browser: Safari 16+, Chrome 108+, Firefox 122+, Edge 108+ — and a secure
context, which means `https` or `localhost`.

## Security

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/AbnormalPilot/passkify/security/advisories/new),
never as a public issue. See [SECURITY.md](https://github.com/AbnormalPilot/passkify/blob/main/SECURITY.md)
for scope, and the [threat model](https://passkify.himanshubuilds.in/docs/guides/security)
for what passkify defends and what stays your application's job.

## License

MIT. Built by [Himanshu Dubey](https://github.com/AbnormalPilot).

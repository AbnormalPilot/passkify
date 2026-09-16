---
name: passkify
description: Add passkeys (WebAuthn, FIDO2, passwordless sign-in) to a website with the passkify npm package — client and server in one zero-dependency install. Use when the user wants passkeys, WebAuthn, passwordless login, Touch ID / Face ID / Windows Hello sign-in, or security-key authentication in a JavaScript or TypeScript app, or when they mention passkify by name. Routes to passkify-server, passkify-client, passkify-storage and passkify-debugging. Do not use for OAuth, magic links, SMS codes, or TOTP — passkify does none of those.
license: MIT
---

# passkify

Passkeys for a website. One npm package, zero runtime dependencies, client and
server both. Runs on Node 20+, Bun, Deno, Cloudflare Workers and Vercel Edge.

Docs: <https://passkify.himanshubuilds.in> · Full text for agents:
<https://passkify.himanshubuilds.in/llms-full.txt>

## The whole thing

```bash
npm install passkify
```

```ts
// server
import { PasskeyServer, MemoryStore } from 'passkify/server';

export const passkeys = new PasskeyServer({
  rpName: 'Example',
  rpID: 'example.com',          // bare host, no scheme or port
  origin: 'https://example.com', // scheme, and port when non-default
  store: new MemoryStore(),      // development only — see passkify-storage
});

app.use(
  passkeys.express({
    getSessionUserId: (req) => req.session?.userId ?? null,
    onLogin: (req, res, result) => {
      req.session.userId = result.user.id; // ← without this, nothing happens
    },
  }),
);
```

```ts
// browser
import { register, login } from 'passkify/client';

await register({ username: 'ada@example.com' });
await login({ username: 'ada@example.com' });
```

That is a working passwordless sign-up and sign-in. Everything else is
configuration.

## Which skill to read next

| You are doing | Read |
| --- | --- |
| Configuring the server, mounting routes, a framework other than Express | **passkify-server** |
| The browser half: autofill, error handling, React | **passkify-client** |
| Anything other than `MemoryStore` — Postgres, Prisma, Drizzle, Redis, Mongo | **passkify-storage** |
| A ceremony is failing, or an error code needs decoding | **passkify-debugging** |

## The six things to get right

These account for nearly every passkify integration that does not work. Full
detail in the other skills; the list is here so it is seen first.

1. **`passkify/server` on the server, `passkify/client` in the browser.**
   Importing the package root from browser code pulls in server code and fails
   at build time.

2. **`origin` needs the scheme and the port; `rpID` is a bare hostname.**
   `origin: 'http://localhost:3000'`, `rpID: 'localhost'`. The rpID must be the
   origin's host or a registrable parent of it. This is failure number one, and
   the constructor rejects the mistakes it can detect.

3. **Never take a username from the request body when a session exists.**
   `{ username }` creates a *new* account. Adding a second passkey to a
   signed-in account uses `{ userId }` from the session. Getting this backwards
   lets a signed-in user attach a passkey to someone else's account.

4. **The ceremony functions throw. They never return `{ verified: false }`.**
   `if (result.verified)` is a smell. Branch on `error.code`, never on message
   text, and re-throw anything that is not a `PasskeyError`.

5. **A successful verification is not a session.** Issue yours in `onLogin` or
   `onRegister`, or the ceremony succeeds and the user is still signed out with
   no error anywhere.

6. **`MemoryStore` is development only.** Across more than one worker it
   produces intermittent `challenge_not_found`, because the challenge is issued
   by one process and redeemed by another.

## Verify the integration

```bash
npx passkify doctor
```

It checks the configuration, the wiring and a custom store against the mistakes
above, and prints the fix for each. Run it after writing an integration and
paste the output.

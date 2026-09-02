# passkify

**Passkeys for your website, without the WebAuthn homework.**

Zero runtime dependencies. Client and server in one package. TypeScript throughout.

```bash
npm install passkify
```

---

## Quickstart

```js
// --- server ---
import { PasskeyServer, MemoryStore } from 'passkify';

const passkeys = new PasskeyServer({
  rpName: 'Acme',
  origin: 'https://acme.com',   // scheme + host + port, exactly as served
  store: new MemoryStore(),     // development only
});

app.use(passkeys.express({
  onLogin: (req, res, { user }) => { req.session.userId = user.id; },
}));
```

```js
// --- browser ---
import { register, login } from 'passkify/client';

await register({ username: 'ada' });  // sign up
await login();                        // sign in: no username, no password
```

That is a working passwordless login.

## Documentation

Everything lives in the site: **`/docs`**, 23 pages covering every method and
option with the reasoning behind each one, plus a **live demo at `/demo`** that
runs this package against your own authenticator.

```bash
git clone https://github.com/USER/passkify.git
cd passkify
npm install                     # one install for the whole workspace
npm run dev                     # http://localhost:3000
```

The site consumes `src/` directly, so there is no build step in the dev loop and
editing the library hot-reloads the site. `dist/` is only ever a publish
artifact: `npm run build` produces it, `npm publish` ships it, and nothing else
needs it to exist.

| Route | |
|---|---|
| `/` | Landing page |
| `/demo` | Working passkey sign-up and sign-in |
| `/docs` | Full reference: server, client, storage, errors, guides |

## What it does

Passkeys are a good idea wrapped in a specification that is hard to implement.
The browser hands you `ArrayBuffer`s that cannot be JSON-encoded, the server
needs a CBOR parser sitting on attacker-controlled bytes, and about fifteen
checks have to pass before an assertion means anything. Miss one and you get
either a login that never works or a login that always works.

passkify does that part. Four methods on the server, two calls in the browser,
and a storage interface you write against whatever you already run.

## Design decisions

- **Failure throws.** `finishRegistration` and `finishAuthentication` never
  return `{ verified: false }`, so there is no falsy result to mistake for
  success.
- **One challenge, one attempt.** Reading a challenge deletes it, whether
  verification then succeeds or fails. A replayed response finds nothing.
- **Registration cannot claim an account.** An existing username is refused;
  adding a passkey to an account requires a session, never a request body.
  Without this rule, anyone who knows a username owns that account.
- **Login reveals nothing.** An unknown username gets an ordinary challenge, so
  the form is not an account-enumeration oracle.
- **Attestation is verified but never required.** `trusted` is true only if you
  supplied root certificates and the chain validated. No stale metadata blob is
  bundled.
- **Zero runtime dependencies.** The only supply chain is Node's own `crypto`.

## Requirements

Node 18+. ESM and CommonJS builds both ship. Safari 16+, Chrome 108+,
Firefox 122+, Edge 108+ for the full feature set including conditional UI.

## Development

```bash
npm test        # builds, then runs the suite against the built output
npm run build
npm run typecheck
```

The suite drives a virtual authenticator that assembles authenticator data byte
by byte and signs with real keys, so every check is exercised against a tampered
response (wrong origin, wrong RP ID, flipped flags, replayed challenge, cloned
counter) rather than only the happy path.

## License

MIT

# passkify

**Passkeys for your website, without the WebAuthn homework.**

A passkey is a key pair. The private half never leaves the visitor's device and
the public half is all you store, so there is no password to reuse, no hash to
crack, and nothing worth stealing in a database dump. What stands between that
idea and a working login is about six hundred lines of specification. This
library is that six hundred lines, so your application does not have to be.

Zero runtime dependencies. Client and server in one package. TypeScript
throughout.

```bash
npm install passkify
```

## What it looks like

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

That is a working passwordless login. Everything else — the fourteen checks the
authentication path runs, the typed errors it throws instead of returning a
boolean, the store you implement for production — is documented rather than
assumed.

## What is in this repository

| Path                | What it is                                  | Ships to |
| ------------------- | ------------------------------------------- | -------- |
| `packages/passkify` | The library. Zero runtime dependencies.     | npm      |
| `apps/docs`         | Documentation site and live demo.           | Vercel   |

The docs site is not a folder of markdown next to the code — it imports the
library's TypeScript source directly, so an example that would not compile does
not ship. It also hosts a working demo at `/demo` that runs a real ceremony
against your own authenticator.

## Documentation

- **[Full documentation](https://passkify.himanshubuilds.in)** — API reference, guides, and
  the security model.
- **[Package README](./packages/passkify/README.md)** — what npm shows.
- **[QUICKSTART.md](./QUICKSTART.md)** — running, testing and releasing this
  repository locally.

## Contributing

Start with [QUICKSTART.md](./QUICKSTART.md). Two things are worth knowing before
opening a pull request: the library takes **no runtime dependencies**, and every
public API change needs the documentation site updated in the same commit, since
the site compiles against the source it documents.

## License

MIT — see [LICENSE](./packages/passkify/LICENSE).

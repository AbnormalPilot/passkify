<div align="center">

# passkify

**Passkeys for your website, without the WebAuthn homework.**

[![npm](https://img.shields.io/npm/v/passkify?color=%23f36458&label=npm)](https://www.npmjs.com/package/passkify)
[![CI](https://github.com/AbnormalPilot/passkify/actions/workflows/ci.yml/badge.svg)](https://github.com/AbnormalPilot/passkify/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://docs.npmjs.com/generating-provenance-statements)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/passkify?activeTab=dependencies)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[Documentation](https://passkify.himanshubuilds.in) ·
[Live demo](https://passkify.himanshubuilds.in/demo) ·
[Changelog](./CHANGELOG.md) ·
[Contributing](./CONTRIBUTING.md)

</div>

---

This is the monorepo. The package itself is
[`packages/passkify`](./packages/passkify), and its README is what npm shows.

```bash
npm install passkify
```

```ts
import { PasskeyServer, MemoryStore } from 'passkify/server';

const passkeys = new PasskeyServer({
  rpName: 'Example',
  rpID: 'example.com',
  origin: 'https://example.com',
  store: new MemoryStore(),
});

app.use(passkeys.express({ onLogin: (req, _res, r) => { req.session.userId = r.user.id; } }));
```

```ts
import { register, login } from 'passkify/client';

await register({ username: 'ada@example.com' });
await login({ username: 'ada@example.com' });
```

## What is in here

| Path | What |
| --- | --- |
| [`packages/passkify`](./packages/passkify) | The library. Client, server, adapters, stores, CLI. Zero runtime dependencies. |
| [`apps/docs`](./apps/docs) | The documentation site and live demo, at [passkify.himanshubuilds.in](https://passkify.himanshubuilds.in). |
| [`skills/`](./skills) | Agent skills, installable with `npx passkify skills install` or `npx skills add AbnormalPilot/passkify`. |

## Documentation

Start at the [quickstart](https://passkify.himanshubuilds.in/docs/quickstart), or
go straight to what you need:

- [Server API](https://passkify.himanshubuilds.in/docs/server/passkey-server) ·
  [Configuration](https://passkify.himanshubuilds.in/docs/server/configuration) ·
  [HTTP adapters](https://passkify.himanshubuilds.in/docs/server/adapters)
- [Client API](https://passkify.himanshubuilds.in/docs/client) ·
  [Error codes](https://passkify.himanshubuilds.in/docs/errors) ·
  [Types](https://passkify.himanshubuilds.in/docs/types)
- [Storage](https://passkify.himanshubuilds.in/docs/storage) ·
  [Store adapters](https://passkify.himanshubuilds.in/docs/storage/adapters)
- [Security model](https://passkify.himanshubuilds.in/docs/guides/security) ·
  [Troubleshooting](https://passkify.himanshubuilds.in/docs/guides/troubleshooting)

## For AI agents

```bash
npx passkify skills install   # Claude Code, Cursor, Codex, Copilot, Gemini, OpenCode
npx passkify mcp              # MCP server over the docs and a live config validator
npx passkify doctor           # check an integration for the mistakes that break it
npx passkify init             # scaffold one
```

Plus [`/llms.txt`](https://passkify.himanshubuilds.in/llms.txt),
[`/llms-full.txt`](https://passkify.himanshubuilds.in/llms-full.txt), and a `.md`
twin of every documentation page — `curl https://passkify.himanshubuilds.in/docs/client.md`.

## Contributing

[CONTRIBUTING.md](./CONTRIBUTING.md) covers running the site, testing the
library and cutting a release. In short:

```bash
npm install
npm run dev       # docs site on :3000
npm run verify    # everything CI runs
```

Security reports go through
[private advisories](https://github.com/AbnormalPilot/passkify/security/advisories/new),
never public issues — see [SECURITY.md](./SECURITY.md).

## License

MIT. Built by [Himanshu Dubey](https://github.com/AbnormalPilot).

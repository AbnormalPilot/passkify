# Quickstart — working on this repository

Running the site, testing the library, and releasing both. For using `passkify`
in your own project, see the [documentation](https://passkify.himanshubuilds.in) instead.

## Prerequisites

| | |
| --- | --- |
| **Node** | **23.6 or newer** for development. The test script runs TypeScript directly (`node --test test/*.test.ts`) and relies on native type stripping, which is only on by default from 23.6. |
| **npm** | 9 or newer, for workspaces. |

The *published* package supports Node 18+ — `dist/` is compiled JavaScript. The
higher requirement is for working on the repository, not for using it.

## Setup

```bash
git clone <your-fork-url> passkify
cd passkify
npm install        # installs both workspaces from the single root lockfile
```

One lockfile at the root covers everything. Do not run `npm install` inside a
workspace directory.

## Run it

```bash
npm run dev        # docs site at http://localhost:3000
```

Two things worth opening: `/docs` for the documentation, and `/demo` for a live
passkey ceremony against your own authenticator (Touch ID, Windows Hello, or a
hardware key). The demo is the fastest way to confirm a change to the ceremony
code actually works in a browser.

**There is no build step between the library and the site.** `apps/docs/next.config.mjs`
aliases the `passkify` specifier to `packages/passkify/src`, so editing the
library hot-reloads the site like any other file. You never need to build the
library to see a change — and a stale `dist/` can never be what the docs
demonstrate.

## Test

```bash
npm test           # builds dist/, then runs the library suite (92 tests)
```

`npm test` builds first by design: the suite exercises the compiled output, so a
passing run also proves the thing that gets published actually works. Expect it
to finish in under a second once built.

Run a single file while iterating:

```bash
cd packages/passkify
node --test test/authentication.test.ts
```

Type checking is separate and covers both workspaces:

```bash
npm run typecheck
```

And the full docs check — typecheck, internal link check, production build:

```bash
npm run verify
```

## Every script

Run these from the repository root.

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Docs site in development mode.                     |
| `npm run build`      | Builds the library (`dist/esm` and `dist/cjs`).    |
| `npm run build:docs` | Production build of the docs site.                 |
| `npm test`           | Builds the library, then runs its test suite.      |
| `npm run typecheck`  | Type-checks both workspaces.                       |
| `npm run verify`     | Docs typecheck, link check, and production build.  |

Target one workspace with `-w`, e.g. `npm run typecheck -w passkify`.

## What CI runs

`.github/workflows/ci.yml`, on every push to `main` and every pull request:

- **library** — `npm run typecheck -w passkify`, then `npm test -w passkify`.
- **docs** — `npm run verify -w passkify-docs`.

Running `npm run typecheck && npm test && npm run verify` locally covers the
same ground before you push.

## Deploying the docs

Vercel, with **Root Directory** set to `apps/docs`. Vercel detects the npm
workspaces at the repository root and installs from the root lockfile, so the
library source the site imports is present at build time. No other settings
need changing, and no `vercel.json` is required.

## Publishing the library

Publishing is driven by tags. `prepublishOnly` type-checks and tests (which
builds `dist/`) before anything leaves the machine.

```bash
npm version patch -w passkify     # or minor / major
git push --follow-tags
```

The `Release` workflow publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements), which
requires an `NPM_TOKEN` secret on the repository.

To publish by hand instead:

```bash
npm publish -w passkify
```

## Troubleshooting

**`Unknown file extension ".ts"` when testing.** Your Node is older than 23.6.
Check with `node -v`.

**Docs show a library change that is not there, or miss one that is.** Restart
`npm run dev`. The source alias is resolved by webpack at startup, so a change
to `next.config.mjs` itself needs a restart.

**`npm install` inside a workspace creates a second lockfile.** Delete it and
the local `node_modules`, then install from the root.

**Passkeys registered against `localhost` stop working elsewhere.** They are
bound to the RP ID. Re-register per environment; this is WebAuthn behaving
correctly, not a bug in the demo.

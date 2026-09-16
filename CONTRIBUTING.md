# Contributing to passkify

Running the site, testing the library, and releasing both. For *using* `passkify`
in your own project, see the [documentation](https://passkify.himanshubuilds.in)
instead.

## Prerequisites

| | |
| --- | --- |
| **Node** | **20.19 or newer.** `.nvmrc` pins 24, which is what CI uses. The published package supports Node 18.17+, and CI tests that. |
| **npm** | 10 or newer, for workspaces. |

## Setup

```bash
git clone https://github.com/AbnormalPilot/passkify.git
cd passkify
npm install        # installs both workspaces from the single root lockfile
```

One lockfile at the root covers everything. Do not run `npm install` inside a
workspace directory — it creates a second lockfile and a second `node_modules`.

## Run it

```bash
npm run dev        # docs site at http://localhost:3000
```

Two things worth opening: `/docs` for the documentation, and `/demo` for a live
passkey ceremony against your own authenticator (Touch ID, Windows Hello, or a
hardware key). The demo is the fastest way to confirm a change to the ceremony
code actually works in a browser.

**There is no build step between the library and the site.**
`apps/docs/next.config.mjs` aliases the `passkify` specifier to
`packages/passkify/src`, so editing the library hot-reloads the site like any
other file. You never need to build the library to see a change — and a stale
`dist/` can never be what the docs demonstrate.

## Test

```bash
npm test           # the library suite, against src/
```

The suite imports `passkify/server` and `passkify/client` — the same specifiers
a user writes — and `vitest.config.ts` points those at `src/`. No build needed,
which is what lets the same tests run on every Node version the package claims
to support.

```bash
npm run test:dist -w passkify   # builds, then runs the identical suite against dist/
```

That run additionally loads `dist/cjs` through `require()`, so the CommonJS half
of the package is exercised rather than merely published.

```bash
npm run test:watch                     # while iterating
npm run test:coverage -w passkify      # with thresholds
npx vitest run test/authentication     # one file
```

## Every script

Run these from the repository root.

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Docs site in development mode.                          |
| `npm run build`        | Builds the library (`dist/esm` and `dist/cjs`).         |
| `npm run build:docs`   | Production build of the docs site.                      |
| `npm test`             | Library suite against `src/`.                           |
| `npm run typecheck`    | Type-checks both workspaces.                            |
| `npm run lint`         | Biome — lint and format check.                          |
| `npm run lint:fix`     | Biome, applying every safe fix.                         |
| `npm run verify`       | Everything CI runs: lint, typecheck, tests, docs build. |

Target one workspace with `-w`, e.g. `npm run typecheck -w passkify`.

## House rules

**The library has zero runtime dependencies, and that is enforced.** CI fails if
`dependencies` in `packages/passkify/package.json` is anything but `{}`. Adapters
take the driver as an argument and import its types with `import type`, which is
erased at build time — that is how `passkify/stores/postgres` exists without
`pg` being a dependency.

**A public API change needs the docs updated in the same commit.** The site
compiles against `src/`, so a rename that misses the documentation fails the
docs build rather than shipping quietly.

**Verification changes need a test for the case that should now be rejected.**
A test proving the happy path still works proves very little; the suite's value
is in `test/helpers/virtual-authenticator.ts`, which can tamper with any field
of a response so the verifier can be shown to notice.

**Formatting is Biome's job, not yours.** `npm run lint:fix` before committing,
or install the pre-commit hook:

```bash
git config core.hooksPath .githooks
```

## What CI runs

`.github/workflows/ci.yml`, on every push to `main` and every pull request:

- **lint** — `biome ci .`
- **library** — typecheck, unit tests, and dist tests across Node 18.17 / 20 / 22 / 24 on Linux, plus Node 24 on macOS and Windows.
- **package** — `publint` and `@arethetypeswrong/cli` against the packed tarball, the zero-dependency assertion, and a tarball size budget.
- **coverage** — thresholds, uploaded to Codecov.
- **docs** — typecheck, link check, production build.
- **codeql** and **dependency review**.

`npm run verify` locally covers the same ground, minus the matrix.

## Deploying the docs

Vercel, with **Root Directory** set to `apps/docs`. Vercel detects the npm
workspaces at the repository root and installs from the root lockfile, so the
library source the site imports is present at build time. No `vercel.json` is
required.

`NEXT_PUBLIC_SITE_ORIGIN` must be set to the public origin — it is both the
demo's RP ID and the base for every canonical URL and sitemap entry.

## Publishing the library

Publishing is driven by tags, and the workflow refuses to publish if the tag and
`package.json` disagree.

```bash
# 1. Update CHANGELOG.md — move entries out of [Unreleased] into a new section.
npm version patch -w passkify     # or minor / major
git push --follow-tags
```

The `Release` workflow verifies, publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements), and
creates a GitHub Release from the matching `CHANGELOG.md` section. A pre-release
tag (`v1.0.0-rc.1`) publishes to the `next` dist-tag instead of `latest`.

Publishing requires an `NPM_TOKEN` secret on the repository.

## Troubleshooting

**Docs show a library change that is not there, or miss one that is.** Restart
`npm run dev`. The source alias is resolved by webpack at startup, so a change
to `next.config.mjs` itself needs a restart.

**`npm install` inside a workspace creates a second lockfile.** Delete it and
the local `node_modules`, then install from the root.

**Passkeys registered against `localhost` stop working elsewhere.** They are
bound to the RP ID. Re-register per environment; this is WebAuthn behaving
correctly, not a bug in the demo.

**`attw` reports "masquerading as ESM".** The CommonJS declarations did not get
built or renamed. Run `npm run build -w passkify` and check that
`dist/cjs/**/*.d.cts` exists.

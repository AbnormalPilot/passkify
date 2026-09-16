# Working on passkify

Instructions for coding agents contributing to **this repository**. If you are
instead helping someone *use* passkify in their own project, install the skills
(`npx passkify skills install`) or read <https://passkify.himanshubuilds.in/llms.txt>.

## What this is

A monorepo (npm workspaces, one root lockfile):

| Path | What |
| --- | --- |
| `packages/passkify` | The library. WebAuthn/passkeys, client + server, **zero runtime dependencies**. |
| `apps/docs` | Next.js 15 documentation site and live demo, deployed at passkify.himanshubuilds.in. |
| `skills/` | Agent skills, published to git so `npx skills add AbnormalPilot/passkify` works. |

## Commands

```bash
npm install                    # from the root only, never inside a workspace
npm run dev                    # docs site on :3000
npm test                       # library suite against src/ — fast, no build
npm run test:dist -w passkify  # builds, then the same suite against dist/ incl. require()
npm run typecheck              # both workspaces
npm run lint:fix               # Biome; formatting is not a matter of taste here
npm run verify                 # everything CI runs
```

Run `npm run verify` before you consider a change finished.

## Rules that are enforced, not merely preferred

**Zero runtime dependencies.** CI fails if `packages/passkify/package.json` has a
non-empty `dependencies`. Store and framework adapters take the driver as an
argument and import its types with `import type`, which the compiler erases —
that is how `passkify/stores/postgres` works without `pg` being installed. If you
think you need a dependency, you need a different design.

**A public API change updates the docs in the same commit.** `apps/docs`
compiles against `packages/passkify/src`, and the docs build diffs itself
against the library's real exports, so drift fails the build rather than
shipping quietly.

**A verification change needs a test for the case that should now be rejected.**
`packages/passkify/test/helpers/virtual-authenticator.ts` is a software
authenticator that signs with real keys and can tamper with any field — origin,
challenge, RP ID hash, flags, signature. Use it. A test proving the happy path
still passes proves almost nothing.

**Never weaken a check to make a test pass.** If a ceremony is failing, the
question is which specification requirement is being violated, not which line to
delete.

## Generated files — do not edit by hand

| File | Regenerate with |
| --- | --- |
| `packages/passkify/generated/*.json` | `npm run build -w passkify` |
| `apps/docs/lib/generated/*` | `npm run content -w passkify-docs` |
| `apps/docs/public/search/*` | same |
| The `<!-- generated:… -->` blocks in `skills/**/SKILL.md` | `npm run build -w passkify` |

CI fails if any of these are stale relative to their source.

## The check registry

Every verification step in `src/server/registration.ts` and
`src/server/authentication.ts` goes through `trace.assert(id, …)`, and every id
must exist in `src/shared/checks.ts`. `test/checks.test.ts` asserts coverage in
both directions: you cannot add a check without registering it, and you cannot
register one the code never reaches. The docs tables, the ceremony diagrams, the
playground trace and the skills all render from that registry, so this is the
single thing keeping them all honest.

## Style

Biome decides formatting. Beyond that, match the surrounding code: this codebase
explains *why* in comments and leaves the *what* to the code. Comments that
restate the line below them will be removed in review. The documentation has the
same rule — every `<ApiMethod>` in the MDX carries a `<Reason>`.

Errors throw. `finishRegistration` and `finishAuthentication` never return
`{ verified: false }`, and new code should not introduce a result type that
reports failure in-band.

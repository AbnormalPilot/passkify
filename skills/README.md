# passkify agent skills

Five skills that teach a coding agent to integrate passkeys with
[passkify](https://github.com/AbnormalPilot/passkify), so it writes a
ceremony that verifies rather than one that merely returns `true`.

```bash
npx skills add AbnormalPilot/passkify   # any agent the skills CLI supports
npx passkify skills install             # the same set, from the package
```

| Skill | Covers |
| --- | --- |
| [`passkify`](./passkify) | The entry point. Routes to the other four, and states what passkify does not do — no OAuth, magic links, SMS or TOTP. |
| [`passkify-server`](./passkify-server) | `PasskeyServer` options, the four ceremony methods, and the HTTP adapters for Express, Next.js, Hono, Fastify, SvelteKit, Remix and Workers. |
| [`passkify-client`](./passkify-client) | `register`, `login`, `signInWithAutofill`, capability detection, the React hooks, and what to show when a browser cannot do WebAuthn. |
| [`passkify-storage`](./passkify-storage) | The `PasskeyStore` interface, the shipped database adapters, and the conformance suite a custom store has to pass. |
| [`passkify-debugging`](./passkify-debugging) | Every `PasskeyErrorCode` with its cause and fix, `NotAllowedError` triage, and why a ceremony works locally but not in production. |

## Why they are split this way

An agent wiring up a backend does not need the browser API in its context, and
an agent debugging `origin_mismatch` needs neither. Each skill's `description`
says what it covers *and* what it does not, so the router picks one rather than
loading all five.

## What is generated

The error-code and verification-check tables inside these files sit between
`<!-- generated:… -->` markers and are written by `npm run build -w passkify`
from the library's own check registry. CI fails if they drift from the source,
which is the point: a skill that documents a check the verifier no longer runs
is worse than no skill at all. Edit the prose around them freely; do not edit
between the markers.

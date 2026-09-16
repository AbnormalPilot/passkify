# Changelog

All notable changes to `passkify` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

What counts as a breaking change is spelled out at
[passkify.himanshubuilds.in/docs/changelog](https://passkify.himanshubuilds.in/docs/changelog).

## [Unreleased]

## [0.2.0] — 2026-09-16

Two changes need a look before you upgrade, both of them on paths that
previously behaved differently rather than not at all:

- `counter_regression` now answers **403** instead of 401. If you branch on the
  status rather than the code, branch on the code.
- **RS1** (COSE `-65535`, RSA with SHA-1) is gone. A config that lists it in
  `supportedAlgorithms` now throws at construction instead of starting.

### Added

- **WebAuthn Level 3.** The three signal methods, which stop a deleted passkey
  haunting the operating system's account picker; `getClientCapabilities()`;
  Related Origin Requests, with the published file derived from `origin` so the
  two cannot drift; conditional create; and `hints` and `extensions`
  pass-through, including `prf`.
- **First-party adapters.** Next.js, Hono, Fastify, SvelteKit, Remix and
  Cloudflare Workers. Postgres, Prisma, Redis, MongoDB and SQLite stores, each
  taking the driver you already have so none of them is a dependency.
- **`passkify/react`** — `useRegister`, `useLogin`, `usePasskeyAutofill`,
  `usePasskeys`, `usePasskeySupport`.
- **`passkify/store-conformance`** — 19 cases including a genuine concurrency
  race on `takeChallenge`, so a read-then-delete store fails rather than
  silently permitting replay.
- **`passkify/testing`** — the virtual authenticator the library's own suite
  uses, for testing your integration including the tampered cases.
- **`npx passkify`** — `init`, `doctor`, `skills install`, and `mcp`, an MCP
  server whose `validate_config` runs the real validator.
- **A check registry** (`VERIFICATION_CHECKS`) that the verifiers index into and
  the tests verify in both directions, plus `explain: true` and an `onCheck`
  hook that return the trace.
- Client APIs for the credential-management routes that previously existed only
  on the server: `listPasskeys`, `renamePasskey`, `deletePasskey`, `syncPasskeys`.
- `/llms.txt`, `/llms-full.txt` and a `.md` twin of every documentation page.

### Changed

- **The verification path is now pure WebCrypto.** No `node:crypto` anywhere in
  the library, which makes the Cloudflare Workers, Deno and Vercel Edge support
  real rather than aspirational. ECDSA signatures are converted from DER to the
  fixed-width form WebCrypto requires, by a deliberately strict parser — a
  lenient one there is a signature-malleability bug.
- X.509 handling is runtime-neutral, written here rather than delegated to
  `node:crypto`. Apple attestation now reads its nonce from the extension OID
  rather than scanning the certificate for the bytes.
- `counter_regression` returns **403** rather than 401, and no longer puts the
  stored and presented counters in the response body. They are on
  `error.details` for your logs.
- `PasskeyError` gained `publicMessage` and `details`, so messages written for a
  developer are not sent to an unauthenticated caller. The adapters take
  `verbose: true` to restore the old behaviour in development.
- Declaration files are now emitted for the CommonJS build as `.d.cts`, with
  `types` per condition — `@arethetypeswrong/cli` reported the old layout as
  "masquerading as ESM" for every `require()`.

### Removed

- **RS1 (COSE `-65535`, RSA with SHA-1).** It was reachable for anyone who put
  it in `supportedAlgorithms`. Asking for it now fails at construction.

### Fixed

- An oversized request body returns **413** and is drained rather than buffered.
  It previously resolved to `undefined` and left the connection open while the
  client uploaded the rest into a socket nobody was reading.
- **An attestation format passkify cannot verify no longer fails the registration
  when the site never asked for attestation.** `verifyAttestation` ran on every
  registration and threw `unsupported_feature` (HTTP 500) for any format without a
  verifier, including under the default `attestation: 'none'`. TPM-backed Windows
  Hello sends `fmt: "tpm"` in that configuration, so those users could not register
  at all. The statement is now reported honestly instead — `format` carries what
  actually arrived and `trusted` stays `false` — and the error is still raised when
  the site did request attestation. Statements in formats passkify *does* verify
  (`none`, `packed`, `fido-u2f`, `apple`) are checked exactly as before: a bad one
  is still a real signal.

## [0.1.0] — 2026-09-02

Initial release. See the
[full 0.1.0 entry](https://passkify.himanshubuilds.in/docs/changelog) for the
complete API surface.

[Unreleased]: https://github.com/AbnormalPilot/passkify/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AbnormalPilot/passkify/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AbnormalPilot/passkify/releases/tag/v0.1.0

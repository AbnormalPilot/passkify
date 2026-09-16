# Security policy

`passkify` verifies authentication credentials. A defect here is an
authentication bypass, so please report suspected vulnerabilities privately.

## Reporting a vulnerability

Use **[GitHub's private vulnerability reporting](https://github.com/AbnormalPilot/passkify/security/advisories/new)**.
It is the only channel — please do not open a public issue, and please do not
disclose the problem publicly before a fix is available.

Include, where you can: the affected version, the ceremony (registration or
authentication), a minimal reproduction, and what an attacker gains. A failing
test against `packages/passkify/test/` is the most useful thing you can send.

You should get an acknowledgement within **72 hours** and an assessment within
**7 days**. Fixes ship as soon as they are ready; the default disclosure window
is **90 days** from the report, or sooner by mutual agreement.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ |

Pre-1.0, only the latest published version receives fixes.

## Scope

**In scope** — anything that lets an attacker authenticate as someone else, or
that weakens a check the WebAuthn specification requires:

- Signature verification, COSE key parsing, or CBOR decoding accepting input it
  should reject.
- Origin, RP ID, challenge, or user-handle validation being bypassable.
- Challenge replay, or a challenge surviving a failed ceremony.
- A registration ceremony that can bind a credential to an account the caller
  does not control.
- Cross-account credential use, or the sign-count regression check being evaded.
- Denial of service through the parsers, which run on attacker-supplied bytes.

**Out of scope** — real, but not defects in this library:

- `MemoryStore` losing state across processes. It is documented as
  development-only, and warns in production.
- A misconfigured `rpID` or `origin` in an application. The constructor rejects
  the mistakes it can detect; the rest is the application's.
- Attestation not proving hardware provenance without `attestationRootCertificates`
  and FIDO MDS. This is documented behaviour, not a weakness.
- Anything requiring an already-compromised authenticator, operating system, or
  password manager.
- Missing CSRF protection, rate limiting, or session management **in your own
  application**. See the [security guide](https://passkify.himanshubuilds.in/docs/guides/security)
  for what stays your job.

## What this library does and does not defend

passkify performs the verification the specification asks for on both
ceremonies, and refuses rather than reporting `{ verified: false }`. It does not
issue sessions, and it never sees your password reset or account recovery flow —
which, on a passkey-only site, is the most likely place an attacker will go
instead. Threat model: <https://passkify.himanshubuilds.in/docs/guides/security>.

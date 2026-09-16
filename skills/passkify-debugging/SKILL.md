---
name: passkify-debugging
description: Diagnose a failing passkify passkey ceremony — every PasskeyErrorCode with its cause and fix, NotAllowedError triage, origin_mismatch and rpid_mismatch, challenge_not_found, testing on a phone over a tunnel, and the verification checks the server performs. Use when a passkey registration or login is failing, when an error code needs decoding, when the browser prompt does not appear, or when a ceremony works locally but not in production.
license: MIT
---

# Debugging a passkey ceremony

Start here:

```bash
npx passkify doctor            # static checks on the project
npx passkify doctor --serve http://localhost:3000   # and against a running app
```

## Read the error first

`PasskeyError` has a stable `code`. Branch on it, never on the message.

<!-- generated:errors-table -->
| Code | HTTP | What it means |
| --- | --- | --- |
| `unsupported` | 401 | This browser or context has no WebAuthn support at all. |
| `cancelled` | 401 | The user dismissed the prompt, or it timed out. Not an error to log loudly. |
| `already_registered` | 401 | The authenticator already holds a credential for this account. |
| `insecure_context` | 401 | The page is not on a secure origin, or `rpId` does not match the page. |
| `not_allowed` | 401 | The authenticator refused: no matching credential, or policy mismatch. |
| `ceremony_in_progress` | 401 | A ceremony is already in flight; browsers allow only one at a time. |
| `server_error` | 401 | Talking to your own server failed (network, non-2xx, bad JSON). |
| `malformed_response` | 400 | The response was not valid JSON of the expected shape. |
| `payload_too_large` | 413 | The request body exceeded the adapter's cap before it could be parsed. The rest is drained and discarded rather than buffered: holding an unbounded body from an unauthenticated caller in memory is the cheapest denial of service there is. |
| `challenge_not_found` | 401 | No pending challenge, or it expired / was already used. |
| `challenge_mismatch` | 401 | The signed challenge is not the one we issued. |
| `origin_mismatch` | 401 | `clientData.origin` is not in the allow-list. |
| `type_mismatch` | 401 | `clientData.type` is not the expected ceremony type. |
| `rpid_mismatch` | 401 | The authenticator signed for a different Relying Party ID. |
| `user_not_present` | 401 | The user-present flag was not set. |
| `user_not_verified` | 401 | User verification was required but the flag was not set. |
| `bad_signature` | 401 | The signature did not verify against the stored public key. |
| `counter_regression` | 403 | The signature counter went backwards — a possible cloned authenticator. |
| `unknown_credential` | 404 | The credential is not registered, or not for this user. |
| `credential_exists` | 409 | This credential ID is already registered. |
| `last_credential` | 409 | Refusing to remove an account's only passkey, which would lock the user out. A conflict with the account's current state, not a fault. |
| `unsupported_algorithm` | 401 | The public key algorithm is not one we offered or can verify. |
| `attestation_failed` | 401 | The attestation statement is malformed or failed to verify. |
| `unsupported_feature` | 500 | Well-formed input we simply do not implement (e.g. an exotic attestation format). |
| `parse_error` | 400 | Bad CBOR, truncated authenticator data, etc. |
| `configuration_error` | 500 | The library was configured incorrectly (wrong origin, missing store, ...). |
| `unknown_user` | 404 | The user record could not be found or created. |
<!-- /generated -->

## The four that account for most reports

**`origin_mismatch`** — the origin the browser reported is not in `origin`.
Compare them character by character; it is almost always a missing port
(`http://localhost:3000`, not `http://localhost`), a missing scheme, or `http`
where the config says `https`. In development behind a proxy, the browser
reports the *public* origin, not the one your server binds to.

**`rpid_mismatch`** — the credential was created for a different `rpID`. Either
`rpID` changed since registration, in which case every existing credential is
orphaned and there is no migration, or `rpID` is not the origin's host or a
registrable parent of it.

**`challenge_not_found`** — the challenge was already used, has expired, or was
issued by a different process. If it is intermittent and you are on
`MemoryStore`, that is the cause: one worker issued it, another was asked to
redeem it. Move to a real store.

**`NotAllowedError` in the browser, surfacing as `cancelled`** — one of:
the user dismissed the prompt; the page is not a secure context (WebAuthn needs
`https` or `localhost`); a previous ceremony is still pending, because browsers
allow one at a time; or the ceremony ran in a cross-origin iframe.

## The prompt does not appear at all

In order of likelihood:

1. Not a secure context. `https`, or `localhost` — a LAN IP will not do.
2. Another ceremony is in flight. `signInWithAutofill` left running counts;
   passkify aborts its own, but a hand-rolled `navigator.credentials` call does
   not.
3. `isSupported()` is false — an in-app browser or an old engine.
4. For autofill specifically: the input is missing
   `autocomplete="username webauthn"`, and nothing reports that.

## Testing on a phone

The phone must reach your machine over **https** at a hostname that matches
`rpID`. A tunnel is the usual way:

```bash
npx localtunnel --port 3000     # or cloudflared, or ngrok
```

Then set `origin` and `rpID` to the tunnel host for that run. Credentials
registered against the tunnel do not work on `localhost` afterwards, and that is
WebAuthn behaving correctly rather than a bug: a credential is bound to its RP
ID.

## Seeing what the server checked

```ts
const passkeys = new PasskeyServer({ ..., explain: true });
const result = await passkeys.finishAuthentication(response);
console.log(result.checks);   // every check, in order, with pass/fail
```

Or watch them as they happen:

```ts
new PasskeyServer({ ..., hooks: { onCheck: (e) => console.log(e.id, e.ok) } });
```

The trace stops at the first failure, which tells you not just what failed but
how far it got. Development only — a trace describes your verification path.

<!-- generated:checks-table -->
### Registration — 18 checks

| # | Check | Code on failure | Specification |
| --- | --- | --- | --- |
| 1 | The response has the fields it must have | `malformed_response` | WebAuthn §7.1 step 1 |
| 2 | The challenge is one we issued and have not yet consumed | `challenge_not_found` | WebAuthn §7.1 step 8 |
| 3 | The challenge was issued for a registration, not a login | `type_mismatch` | WebAuthn §7.1 step 8 |
| 4 | The signed challenge equals the stored one | `challenge_mismatch` | WebAuthn §7.1 step 8 |
| 5 | clientData.type is exactly "webauthn.create" | `type_mismatch` | WebAuthn §7.1 step 7 |
| 6 | clientData.origin is in the allow-list | `origin_mismatch` | WebAuthn §7.1 step 9 |
| 7 | The ceremony did not run in a cross-origin frame | `origin_mismatch` | WebAuthn §7.1 step 10 |
| 8 | The attestation object has fmt, attStmt and authData | `parse_error` | WebAuthn §7.1 step 12 |
| 9 | The RP ID hash matches this relying party | `rpid_mismatch` | WebAuthn §7.1 step 13 |
| 10 | The user-present flag is set | `user_not_present` | WebAuthn §7.1 step 14 |
| 11 | The user was verified, when the ceremony required it | `user_not_verified` | WebAuthn §7.1 step 15 |
| 12 | The backup-state flag is not set without backup-eligible | `parse_error` | WebAuthn §6.1.3 |
| 13 | The credential is backup-eligible, when the site requires it | `attestation_failed` | passkify policy |
| 14 | The response carries attested credential data | `parse_error` | WebAuthn §7.1 step 12 |
| 15 | rawId equals the credential ID inside the authenticator data | `parse_error` | WebAuthn §7.1 step 12 |
| 16 | The public key uses an algorithm we offered | `unsupported_algorithm` | WebAuthn §7.1 step 16 |
| 17 | The attestation statement, if present, is internally consistent | `attestation_failed` | WebAuthn §7.1 step 19 |
| 18 | The credential is not already registered, to anyone | `credential_exists` | WebAuthn §7.1 step 22 |

### Authentication — 15 checks

| # | Check | Code on failure | Specification |
| --- | --- | --- | --- |
| 1 | The response has the fields it must have | `malformed_response` | WebAuthn §7.2 step 1 |
| 2 | The challenge is one we issued and have not yet consumed | `challenge_not_found` | WebAuthn §7.2 step 11 |
| 3 | The challenge was issued for a login, not a registration | `type_mismatch` | WebAuthn §7.2 step 11 |
| 4 | The signed challenge equals the stored one | `challenge_mismatch` | WebAuthn §7.2 step 11 |
| 5 | clientData.type is exactly "webauthn.get" | `type_mismatch` | WebAuthn §7.2 step 10 |
| 6 | clientData.origin is in the allow-list | `origin_mismatch` | WebAuthn §7.2 step 12 |
| 7 | The ceremony did not run in a cross-origin frame | `origin_mismatch` | WebAuthn §7.2 step 13 |
| 8 | The credential ID is one we have stored | `unknown_credential` | WebAuthn §7.2 step 5 |
| 9 | The credential belongs to the account being signed into | `unknown_credential` | WebAuthn §7.2 step 6 |
| 10 | The user handle, when present, names the credential owner | `unknown_credential` | WebAuthn §7.2 step 6 |
| 11 | The RP ID hash matches this relying party | `rpid_mismatch` | WebAuthn §7.2 step 15 |
| 12 | The user-present flag is set | `user_not_present` | WebAuthn §7.2 step 16 |
| 13 | The user was verified, when the ceremony required it | `user_not_verified` | WebAuthn §7.2 step 17 |
| 14 | The signature verifies against the stored public key | `bad_signature` | WebAuthn §7.2 step 20 |
| 15 | The signature counter has not gone backwards | `counter_regression` | WebAuthn §7.2 step 21 |
<!-- /generated -->

## It works locally and not in production

Check, in this order:

1. `origin` and `rpID` differ per environment. They must be configured per
   environment, not hard-coded.
2. Behind a proxy or CDN, the browser's origin is the public one.
3. `MemoryStore` in a multi-worker deployment (see `challenge_not_found`).
4. A serverless platform where each invocation is a fresh process — same cause,
   same fix.
5. `cache-control` stripped by a CDN. Challenge responses must not be cached;
   passkify sets `no-store`, but a CDN can override it.

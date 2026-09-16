---
name: passkify-client
description: The passkify browser API — register, login, signInWithAutofill (conditional UI), capability detection, listing and removing passkeys, the React hooks (useRegister, useLogin, usePasskeyAutofill, usePasskeys), and handling PasskeyError in the UI. Use when writing the front-end half of a passkey integration, adding passkey autofill to a sign-in form, building an account-settings page for passkeys, or deciding what to show when a browser cannot do WebAuthn. Not for server configuration (see passkify-server).
license: MIT
---

# passkify in the browser

```ts
import { register, login, signInWithAutofill } from 'passkify/client';
```

Always `passkify/client`, never the package root. The root is the server half:
since verification moved to WebCrypto it bundles for a browser without
complaint, at roughly six times the size and with the whole verifier along for
the ride. Nothing errors, so nothing will catch this for you.

## Sign up and sign in

```ts
const result = await register({ username: 'ada@example.com' });
const result = await login({ username: 'ada@example.com' });
const result = await login();  // usernameless: the browser shows the picker
```

Each returns `{ verified: true, user, credentialId }`, or throws.

If your routes are not at `/passkey`, say so once at startup:

```ts
import { configure } from 'passkify/client';
configure({ baseUrl: '/api/passkey' });  // must match the server's basePath
```

## Autofill (conditional UI)

The good version of passkey sign-in: the passkey appears in the browser's own
autofill dropdown, with no button to press.

```html
<input name="username" autocomplete="username webauthn" />
```

```ts
signInWithAutofill()
  .then((result) => { if (result) location.href = '/dashboard'; })
  .catch(() => {});
```

Three things, all easy to miss:

- **`autocomplete="username webauthn"` is required.** Without the `webauthn`
  token the dropdown never offers a passkey, and nothing reports an error.
- **Do not `await` it in a way that blocks rendering.** It resolves when the
  user picks a passkey, which may be never.
- **Returns `null`** where the browser cannot do conditional mediation. That is
  not an error; show the ordinary sign-in form.

## Errors

```ts
import { PasskeyError } from 'passkify/client';

try {
  await login({ username });
} catch (error) {
  if (error instanceof PasskeyError) {
    if (error.isUserCancellation) return;      // closed the prompt; not a failure
    setMessage(messageFor(error.code));
  } else {
    throw error;
  }
}
```

**Branch on `error.code`, never on `error.message`.** Messages are written for
developers and are reworded freely; codes are stable across minor versions.

`cancelled` is the one to handle first and specially: the user dismissed the
prompt, and showing a red error for that is wrong.

## Capability detection

```ts
import { isSupported, isPlatformAuthenticatorAvailable, getCapabilities } from 'passkify/client';

if (!isSupported()) { /* offer another way in */ }
if (await isPlatformAuthenticatorAvailable()) { /* Touch ID / Windows Hello is here */ }

const capabilities = await getCapabilities();  // WebAuthn Level 3
```

Use these to decide **how prominently** to offer passkeys, never whether to
offer them at all: a negative answer describes this browser and this device, not
the user's options — they may have a phone or a security key.

## Managing passkeys

```ts
import { listPasskeys, renamePasskey, deletePasskey } from 'passkify/client';

const passkeys = await listPasskeys();
await renamePasskey(id, 'Work laptop');
await deletePasskey(id);   // refused for the last one: `last_credential`, 409
```

All three need a signed-in session. `renamePasskey` and `deletePasskey` also
signal the platform, which is what stops a deleted passkey lingering in the
operating system's account picker forever.

## Keeping the OS picker in step

```ts
import { syncPasskeys } from 'passkify/client';
await syncPasskeys();   // after login, and on the passkey settings page
```

Without this, a passkey the user deleted on your site still appears in their
system picker and fails when chosen. Feature-detected, and every failure is
swallowed — it is housekeeping and must never break a page.

## React

```tsx
import { useRegister, useLogin, usePasskeyAutofill, usePasskeys, usePasskeySupport }
  from 'passkify/react';

function SignIn() {
  const { login, pending, error } = useLogin();
  usePasskeyAutofill((result) => router.push('/dashboard'));

  return (
    <>
      <input name="username" autoComplete="username webauthn" />
      <button onClick={() => login({ username })} disabled={pending}>Sign in</button>
      {error && !error.isUserCancellation && <p role="alert">{error.message}</p>}
    </>
  );
}
```

The hooks abort on unmount, which hand-written versions usually miss: a
conditional-mediation request outliving its form blocks the next ceremony, and
the symptom is that nothing happens.

## Do not do this

```ts
// ✗ Pulls server code into the browser bundle
import { register } from 'passkify';

// ✓
import { register } from 'passkify/client';
```

```html
<!-- ✗ Autofill will never offer a passkey -->
<input name="username" autocomplete="username" />

<!-- ✓ -->
<input name="username" autocomplete="username webauthn" />
```

```ts
// ✗ A dismissed prompt is not an error to show
catch (error) { setError(error.message); }

// ✓
catch (error) {
  if (error instanceof PasskeyError && error.isUserCancellation) return;
  setError(error.message);
}
```

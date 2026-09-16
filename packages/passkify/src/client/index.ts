/**
 * The browser half of passkify.
 *
 * ```js
 * import { register, login } from 'passkify/client';
 *
 * await register({ username: 'ada' });   // sign up
 * await login();                         // sign in, no username needed
 * ```
 *
 * This module holds the two calls you actually make. Each does the whole round
 * trip: fetch options from your server, run the WebAuthn ceremony, post the
 * result back, return the verified user.
 *
 * The pieces live alongside it, one job each:
 *
 *   capabilities.ts  feature detection
 *   ceremony.ts      the navigator.credentials calls and abort bookkeeping
 *   config.ts        defaults set by configure()
 *   encoding.ts      JSON to WebAuthn and back
 *   errors.ts        DOMException to PasskeyError
 *   transport.ts     fetch, and turning a non-2xx back into a PasskeyError
 */

import { resolveConfig } from './config.js';
import { assertSupported, isAutofillAvailable } from './capabilities.js';
import { createCredential, getAssertion } from './ceremony.js';
import { request } from './transport.js';
import { signalUnknownCredential } from './signals.js';
import { PasskeyError } from '../shared/errors.js';
import type { ClientConfig, PasskeyClientResult, ResolvedClientConfig } from './types.js';
import type {
  RegistrationOptionsJSON,
  AuthenticationOptionsJSON,
  AuthenticationResponseJSON,
} from '../shared/types.js';

// --- public surface --------------------------------------------------------

export { configure } from './config.js';
export {
  isSupported,
  isPlatformAuthenticatorAvailable,
  isAutofillAvailable,
  getCapabilities,
} from './capabilities.js';
export { createCredential, getAssertion, cancelPendingCeremony } from './ceremony.js';

/** Managing an account's passkeys. All three need a signed-in session. */
export { listPasskeys, renamePasskey, deletePasskey, type PasskeySummary } from './credentials.js';

/**
 * WebAuthn Level 3 signal methods — what keeps the operating system's passkey
 * picker in step with what your server actually has.
 */
export { syncPasskeys, getSignalSupport, type SyncResult } from './signals.js';

export { PasskeyError, isPasskeyError } from '../shared/errors.js';
export type { PasskeyErrorCode } from '../shared/errors.js';
export type { AuthenticatedUser, PasskeyClientResult, ClientConfig } from './types.js';
export type {
  RegistrationOptionsJSON,
  AuthenticationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '../shared/types.js';

// --- the two calls you make ------------------------------------------------

export interface RegisterInput {
  /**
   * `'conditional'` asks the browser to offer passkey creation inside its own
   * UI rather than a modal — the way a site upgrades a password login to a
   * passkey without an extra screen. Browsers without it show the usual prompt.
   */
  mediation?: CredentialMediationRequirement;
  /** Username for a new account. Omit when a signed-in user is adding a device. */
  username?: string;
  /** Shown in the OS passkey picker. Defaults to the username. */
  displayName?: string;
  /** Abort the ceremony from your own controller, e.g. on route change. */
  signal?: AbortSignal;
  /** Per-call overrides of `configure()`. */
  config?: ClientConfig;
}

/**
 * Register a passkey.
 *
 * Creates the account when called with a `username`; adds another passkey to
 * the signed-in account when called with none.
 */
export async function register(input: RegisterInput = {}): Promise<PasskeyClientResult> {
  assertSupported();
  const config = resolveConfig(input.config);

  const options = await request<RegistrationOptionsJSON>(config, '/register/start', {
    username: input.username,
    displayName: input.displayName,
  });

  const credential = await createCredential(options, {
    signal: input.signal,
    mediation: input.mediation,
  });

  return request<PasskeyClientResult>(config, '/register/finish', credential);
}

export interface LoginInput {
  /**
   * Only if you must. Leaving this out is the point: the browser already knows
   * which passkeys exist for your site and will show a picker.
   */
  username?: string;
  signal?: AbortSignal;
  config?: ClientConfig;
}

/** Sign in with a passkey. */
/**
 * Finish a login, and clean up after a stale passkey if the server rejects one.
 *
 * `unknown_credential` means the browser offered a passkey this site has no
 * record of — almost always one the user deleted here but which still sits in
 * their operating system's picker. Telling the platform is the whole reason
 * `signalUnknownCredential` exists, and this is the only moment we know to.
 */
async function finishLogin(
  config: ResolvedClientConfig,
  assertion: AuthenticationResponseJSON,
  rpId: string | undefined,
): Promise<PasskeyClientResult> {
  try {
    return await request<PasskeyClientResult>(config, '/login/finish', assertion);
  } catch (error) {
    if (
      rpId &&
      config.signalUnknownCredentials !== false &&
      error instanceof PasskeyError &&
      error.code === 'unknown_credential'
    ) {
      await signalUnknownCredential(rpId, assertion.id);
    }
    throw error;
  }
}

export async function login(input: LoginInput = {}): Promise<PasskeyClientResult> {
  assertSupported();
  const config = resolveConfig(input.config);

  const options = await request<AuthenticationOptionsJSON>(config, '/login/start', {
    username: input.username,
  });

  const assertion = await getAssertion(options, { signal: input.signal });

  return finishLogin(config, assertion, options.rpId);
}

export interface AutofillInput {
  signal?: AbortSignal;
  config?: ClientConfig;
}

/**
 * Offer passkeys inside the browser's autofill dropdown ("conditional UI").
 *
 * Call it once when your sign-in page mounts. It resolves only when the visitor
 * picks a passkey, which may be never, so do not await it in a way that blocks
 * rendering:
 *
 * ```js
 * signInWithAutofill()
 *   .then((result) => { if (result) location.href = '/dashboard'; })
 *   .catch(() => {});
 * ```
 *
 * Your username input needs `autocomplete="username webauthn"`. Returns `null`
 * where the browser cannot do this. A pending request is aborted automatically
 * when `login` or `register` runs, since browsers allow one ceremony at a time.
 */
export async function signInWithAutofill(
  input: AutofillInput = {},
): Promise<PasskeyClientResult | null> {
  if (!(await isAutofillAvailable())) {
    return null;
  }
  const config = resolveConfig(input.config);

  const options = await request<AuthenticationOptionsJSON>(config, '/login/start', {});

  const assertion = await getAssertion(options, {
    signal: input.signal,
    mediation: 'conditional',
  });

  return finishLogin(config, assertion, options.rpId);
}

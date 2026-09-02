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
import type { ClientConfig, PasskeyClientResult } from './types.js';
import type { RegistrationOptionsJSON, AuthenticationOptionsJSON } from '../shared/types.js';

// --- public surface --------------------------------------------------------

export { configure } from './config.js';
export {
  isSupported,
  isPlatformAuthenticatorAvailable,
  isAutofillAvailable,
} from './capabilities.js';
export { createCredential, getAssertion, cancelPendingCeremony } from './ceremony.js';

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

  const credential = await createCredential(options, input.signal);

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
export async function login(input: LoginInput = {}): Promise<PasskeyClientResult> {
  assertSupported();
  const config = resolveConfig(input.config);

  const options = await request<AuthenticationOptionsJSON>(config, '/login/start', {
    username: input.username,
  });

  const assertion = await getAssertion(options, { signal: input.signal });

  return request<PasskeyClientResult>(config, '/login/finish', assertion);
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

  return request<PasskeyClientResult>(config, '/login/finish', assertion);
}

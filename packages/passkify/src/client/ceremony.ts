/**
 * The WebAuthn calls themselves, plus the bookkeeping browsers require.
 *
 * `createCredential` and `getAssertion` are exported for people whose backend
 * is not passkify: they run only the browser half and hand back a JSON-safe
 * object, so you keep your own endpoints and still get the encoding handled.
 */

import { PasskeyError } from '../shared/errors.js';
import type {
  RegistrationOptionsJSON,
  AuthenticationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '../shared/types.js';
import { assertSupported } from './capabilities.js';
import {
  toCreationOptions,
  toRequestOptions,
  serializeRegistration,
  serializeAuthentication,
} from './encoding.js';
import { translateWebAuthnError } from './errors.js';

/**
 * Browsers permit exactly one outstanding WebAuthn request, and a
 * conditional-UI request left running in the background counts. Starting a
 * ceremony therefore cancels whatever was in flight, which is why calling
 * `login()` while autofill is armed works instead of failing.
 */
let activeCeremony: AbortController | null = null;

function beginCeremony(signal?: AbortSignal): AbortController {
  activeCeremony?.abort(new DOMException('superseded by a new request', 'AbortError'));
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
  }
  activeCeremony = controller;
  return controller;
}

function endCeremony(controller: AbortController): void {
  if (activeCeremony === controller) {
    activeCeremony = null;
  }
}

/**
 * Cancel any in-flight ceremony, for example when unmounting a sign-in
 * component. `register`, `login` and `signInWithAutofill` already cancel each
 * other, so this is only needed when calling `navigator.credentials` directly.
 */
export function cancelPendingCeremony(): void {
  activeCeremony?.abort(new DOMException('cancelled by the application', 'AbortError'));
  activeCeremony = null;
}

/**
 * Run only the WebAuthn creation ceremony, given options from any server.
 *
 * `mediation: 'conditional'` is the Level 3 addition: the browser offers to
 * create a passkey inside its own UI, after the user has just signed in some
 * other way, without a modal interrupting them. It is how a site upgrades an
 * existing password login to a passkey with no extra screen. Browsers that do
 * not support it ignore the option and show the usual prompt.
 */
export async function createCredential(
  options: RegistrationOptionsJSON,
  extras: AbortSignal | { signal?: AbortSignal; mediation?: CredentialMediationRequirement } = {},
): Promise<RegistrationResponseJSON> {
  assertSupported();
  // The second parameter used to be a bare AbortSignal.
  const normalized = extras instanceof AbortSignal ? { signal: extras } : (extras ?? {});
  const controller = beginCeremony(normalized.signal);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: toCreationOptions(options),
      signal: controller.signal,
      ...(normalized.mediation ? { mediation: normalized.mediation } : {}),
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw translateWebAuthnError(error, 'create');
  } finally {
    endCeremony(controller);
  }

  if (!credential) {
    throw new PasskeyError('cancelled', 'no credential was created');
  }
  return serializeRegistration(credential);
}

/** Run only the WebAuthn assertion ceremony, given options from any server. */
export async function getAssertion(
  options: AuthenticationOptionsJSON,
  extras: { signal?: AbortSignal; mediation?: CredentialMediationRequirement } = {},
): Promise<AuthenticationResponseJSON> {
  assertSupported();
  const controller = beginCeremony(extras.signal);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: toRequestOptions(options),
      signal: controller.signal,
      ...(extras.mediation ? { mediation: extras.mediation } : {}),
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw translateWebAuthnError(error, 'get');
  } finally {
    endCeremony(controller);
  }

  if (!credential) {
    throw new PasskeyError('cancelled', 'no assertion was produced');
  }
  return serializeAuthentication(credential);
}

/**
 * Feature detection.
 *
 * Use these to decide how prominently to offer passkeys, never whether to offer
 * them at all: a negative answer here describes this browser and this machine,
 * not the visitor's options.
 */

import { PasskeyError } from '../shared/errors.js';

/** Does this browser support WebAuthn at all? */
export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator?.credentials?.create === 'function'
  );
}

/**
 * Is there a built-in authenticator: Touch ID, Face ID, Windows Hello, an
 * Android screen lock?
 *
 * A `false` does not mean passkeys are unavailable. It means there is no sensor
 * built into this machine; the visitor may still have a phone or a security
 * key.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isSupported()) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Can this browser show passkeys inside the username field's autofill dropdown
 * (conditional mediation)?
 */
export async function isAutofillAvailable(): Promise<boolean> {
  if (!isSupported()) {
    return false;
  }
  const api = window.PublicKeyCredential as unknown as {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  if (typeof api.isConditionalMediationAvailable !== 'function') {
    return false;
  }
  try {
    return await api.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

/** Throw a useful error rather than letting `navigator.credentials` be undefined. */
export function assertSupported(): void {
  if (!isSupported()) {
    throw new PasskeyError(
      'unsupported',
      typeof window === 'undefined'
        ? 'passkify/client only runs in a browser: call it from a client component or an event handler'
        : 'this browser does not support passkeys',
    );
  }
}

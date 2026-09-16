/**
 * WebAuthn Level 3 signal methods.
 *
 * These are the fix for the passkey that will not die: a credential the user
 * deleted on your site still appears in their operating system's account
 * picker, forever, and choosing it fails with an error nobody can act on. The
 * platform has no way to know it is gone unless the page tells it.
 *
 * Three methods, and passkify calls all of them for you:
 *
 *   signalAllAcceptedCredentials — this account's credentials are exactly these
 *   signalCurrentUserDetails     — and it is called this
 *   signalUnknownCredential      — that one you just offered does not exist
 *
 * Every one is feature-detected and every failure is swallowed. A browser that
 * has never heard of them must behave exactly as it did before, and a signal
 * that fails must never break the page it was called from — it is housekeeping,
 * not a ceremony.
 */

import { fromBase64Url } from '../shared/base64url.js';
import { resolveConfig } from './config.js';
import { request } from './transport.js';
import type { ClientConfig } from './types.js';

interface SignalPayload {
  rpId: string;
  userId: string;
  name: string;
  displayName: string;
  allAcceptedCredentialIds: string[];
}

type SignalCapableCredential = {
  signalAllAcceptedCredentials?: (options: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
  signalCurrentUserDetails?: (options: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
  signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>;
};

function signalApi(): SignalCapableCredential | null {
  if (typeof window === 'undefined') return null;
  const api = window.PublicKeyCredential as unknown as SignalCapableCredential | undefined;
  return api ?? null;
}

/** Which signal methods this browser implements. */
export function getSignalSupport(): {
  allAcceptedCredentials: boolean;
  currentUserDetails: boolean;
  unknownCredential: boolean;
} {
  const api = signalApi();
  return {
    allAcceptedCredentials: typeof api?.signalAllAcceptedCredentials === 'function',
    currentUserDetails: typeof api?.signalCurrentUserDetails === 'function',
    unknownCredential: typeof api?.signalUnknownCredential === 'function',
  };
}

export interface SyncResult {
  /** False when the browser implements none of the signal methods. */
  supported: boolean;
  /** True when the credential list was successfully handed over. */
  allAcceptedCredentials: boolean;
  /** True when the account name and display name were handed over. */
  currentUserDetails: boolean;
}

/**
 * Tell the platform what this account's passkeys actually are.
 *
 * Call it after a login, and on any page where the user manages their
 * passkeys — passkify's own `deletePasskey` and `renamePasskey` call it for
 * you, since those are the two moments the platform's view goes stale.
 *
 * Requires a session: the server answers from the signed-in account.
 */
export async function syncPasskeys(input: { config?: ClientConfig } = {}): Promise<SyncResult> {
  const support = getSignalSupport();
  const result: SyncResult = {
    supported: support.allAcceptedCredentials || support.currentUserDetails,
    allAcceptedCredentials: false,
    currentUserDetails: false,
  };
  if (!result.supported) return result;

  const config = resolveConfig(input.config);
  let payload: SignalPayload | undefined;
  try {
    payload = await request<SignalPayload | undefined>(config, '/signals', undefined, 'GET');
  } catch {
    // Not signed in, or the route is not mounted. Neither is worth an
    // exception: nothing the caller does next depends on it.
    return result;
  }

  // 204 means the account has no credentials. Signalling an empty list here
  // would tell the platform to delete every passkey the user has for this site,
  // so the server withholds the payload rather than sending an empty one.
  if (!payload?.allAcceptedCredentialIds) return result;

  const api = signalApi();

  if (support.allAcceptedCredentials) {
    try {
      await api?.signalAllAcceptedCredentials?.({
        rpId: payload.rpId,
        userId: payload.userId,
        allAcceptedCredentialIds: payload.allAcceptedCredentialIds,
      });
      result.allAcceptedCredentials = true;
    } catch {
      // Housekeeping. Never break the page.
    }
  }

  if (support.currentUserDetails) {
    try {
      await api?.signalCurrentUserDetails?.({
        rpId: payload.rpId,
        userId: payload.userId,
        name: payload.name,
        displayName: payload.displayName,
      });
      result.currentUserDetails = true;
    } catch {
      // As above.
    }
  }

  return result;
}

/**
 * Tell the platform a credential it offered does not exist here.
 *
 * Called automatically when a login is refused with `unknown_credential`, which
 * is exactly the moment a stale entry in the picker reveals itself. Needs no
 * session and no server round trip — the credential id is the one the browser
 * just handed us.
 */
export async function signalUnknownCredential(
  rpId: string,
  credentialId: string,
): Promise<boolean> {
  const api = signalApi();
  if (typeof api?.signalUnknownCredential !== 'function') return false;

  try {
    // Guard against a credential id that is not valid base64url; the platform
    // would reject it and we would rather not raise from a cleanup path.
    fromBase64Url(credentialId);
    await api.signalUnknownCredential({ rpId, credentialId });
    return true;
  } catch {
    return false;
  }
}

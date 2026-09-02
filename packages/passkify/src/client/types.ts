/** Shapes the browser half exchanges with your server. */

import type { PasskeyErrorCode } from '../shared/errors.js';

/** The account, as returned by your server after a successful ceremony. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
}

export interface PasskeyClientResult {
  verified: true;
  user: AuthenticatedUser;
  credentialId: string;
  /** Registration only: whether the account was created by this ceremony. */
  isNewUser?: boolean;
}

export interface ClientConfig {
  /** Where you mounted the server routes. Default `/passkey`. */
  baseUrl?: string;
  /** Swap in your own fetch (for auth headers, a different base, tests). */
  fetch?: typeof fetch;
  /** Extra headers on every request. A CSRF token, typically. */
  headers?: Record<string, string>;
  /** Passed to every request. Set to `'include'` for cross-origin cookie auth. */
  credentials?: RequestCredentials;
}

/** A config with `baseUrl` guaranteed present. */
export type ResolvedClientConfig = ClientConfig & { baseUrl: string };

export type { PasskeyErrorCode };

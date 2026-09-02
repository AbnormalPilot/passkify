/**
 * Every error this library throws is a `PasskeyError` carrying a stable
 * machine-readable `code`, so applications can branch on the reason without
 * string-matching messages.
 */

export type PasskeyErrorCode =
  // --- Browser / user-facing (thrown by passkify/client) ---
  /** This browser or context has no WebAuthn support at all. */
  | 'unsupported'
  /** The user dismissed the prompt, or it timed out. Not an error to log loudly. */
  | 'cancelled'
  /** The authenticator already holds a credential for this account. */
  | 'already_registered'
  /** The page is not on a secure origin, or `rpId` does not match the page. */
  | 'insecure_context'
  /** The authenticator refused: no matching credential, or policy mismatch. */
  | 'not_allowed'
  /** A ceremony is already in flight; browsers allow only one at a time. */
  | 'ceremony_in_progress'
  /** Talking to your own server failed (network, non-2xx, bad JSON). */
  | 'server_error'

  // --- Verification (thrown by passkify/server) ---
  /** The response was not valid JSON of the expected shape. */
  | 'malformed_response'
  /** No pending challenge, or it expired / was already used. */
  | 'challenge_not_found'
  /** The signed challenge is not the one we issued. */
  | 'challenge_mismatch'
  /** `clientData.origin` is not in the allow-list. */
  | 'origin_mismatch'
  /** `clientData.type` is not the expected ceremony type. */
  | 'type_mismatch'
  /** The authenticator signed for a different Relying Party ID. */
  | 'rpid_mismatch'
  /** The user-present flag was not set. */
  | 'user_not_present'
  /** User verification was required but the flag was not set. */
  | 'user_not_verified'
  /** The signature did not verify against the stored public key. */
  | 'bad_signature'
  /** The signature counter went backwards — a possible cloned authenticator. */
  | 'counter_regression'
  /** The credential is not registered, or not for this user. */
  | 'unknown_credential'
  /** This credential ID is already registered. */
  | 'credential_exists'
  /**
   * Refusing to remove an account's only passkey, which would lock the user
   * out. A conflict with the account's current state, not a fault.
   */
  | 'last_credential'
  /** The public key algorithm is not one we offered or can verify. */
  | 'unsupported_algorithm'
  /** The attestation statement is malformed or failed to verify. */
  | 'attestation_failed'
  /** Well-formed input we simply do not implement (e.g. an exotic attestation format). */
  | 'unsupported_feature'
  /** Bad CBOR, truncated authenticator data, etc. */
  | 'parse_error'
  /** The library was configured incorrectly (wrong origin, missing store, ...). */
  | 'configuration_error'
  /** The user record could not be found or created. */
  | 'unknown_user';

export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;
  /** Suggested HTTP status when this surfaces from a route handler. */
  readonly status: number;
  override readonly cause?: unknown;

  constructor(
    code: PasskeyErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    // Keep `instanceof` working when the package is compiled down to ES5 by a
    // consumer's bundler.
    Object.setPrototypeOf(this, PasskeyError.prototype);
  }

  /** True when the user simply walked away — usually worth ignoring in UI. */
  get isUserCancellation(): boolean {
    return this.code === 'cancelled';
  }

  toJSON(): { error: PasskeyErrorCode; message: string } {
    return { error: this.code, message: this.message };
  }
}

function defaultStatus(code: PasskeyErrorCode): number {
  switch (code) {
    case 'configuration_error':
    case 'unsupported_feature':
      return 500;
    case 'unknown_user':
    case 'unknown_credential':
      return 404;
    case 'credential_exists':
    case 'last_credential':
      return 409;
    case 'malformed_response':
    case 'parse_error':
      return 400;
    default:
      return 401;
  }
}

/** Narrowing helper, exported for convenience. */
export function isPasskeyError(value: unknown): value is PasskeyError {
  return value instanceof PasskeyError;
}

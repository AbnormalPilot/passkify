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
  /**
   * The request body exceeded the adapter's cap before it could be parsed.
   *
   * The rest is drained and discarded rather than buffered: holding an
   * unbounded body from an unauthenticated caller in memory is the cheapest
   * denial of service there is.
   */
  | 'payload_too_large'
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
  /**
   * What to send over the wire, when that should differ from `message`.
   *
   * `message` is written for the developer reading a stack trace, and several
   * of them are specific enough to be worth withholding: telling an
   * unauthenticated caller that the origin allow-list is misconfigured, or what
   * the stored signature counter is, hands them information they had no way to
   * obtain. Where such a message exists, this is the sanitised twin the HTTP
   * adapters actually render.
   */
  readonly publicMessage?: string;
  /**
   * Structured context for your logs. Never serialised into an HTTP response.
   */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: PasskeyErrorCode,
    message: string,
    options: {
      status?: number;
      cause?: unknown;
      publicMessage?: string;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    if (options.publicMessage !== undefined) {
      this.publicMessage = options.publicMessage;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
    // Keep `instanceof` working when the package is compiled down to ES5 by a
    // consumer's bundler.
    Object.setPrototypeOf(this, PasskeyError.prototype);
  }

  /** True when the user simply walked away — usually worth ignoring in UI. */
  get isUserCancellation(): boolean {
    return this.code === 'cancelled';
  }

  /**
   * The body an HTTP adapter sends. Uses `publicMessage` when one is set.
   *
   * Pass `{ verbose: true }` in development to get the developer-facing message
   * instead — the adapters expose this as an option.
   */
  toJSON(options: { verbose?: boolean } = {}): { error: PasskeyErrorCode; message: string } {
    return {
      error: this.code,
      message: options.verbose ? this.message : (this.publicMessage ?? this.message),
    };
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
    case 'payload_too_large':
      return 413;
    // Not 401: 401 invites a retry with better credentials, and the meaning
    // here is the opposite — this authenticator may be a clone, so stop.
    case 'counter_regression':
      return 403;
    default:
      return 401;
  }
}

/** Narrowing helper, exported for convenience. */
export function isPasskeyError(value: unknown): value is PasskeyError {
  return value instanceof PasskeyError;
}

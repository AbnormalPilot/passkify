/**
 * Turning a `DOMException` into something you can branch on.
 *
 * The browser is deliberately vague here: a precise reason would let a page
 * probe which credentials a visitor holds, so `NotAllowedError` covers
 * "cancelled", "timed out" and "no matching credential" alike. The mapping
 * below is the best reading available, and the messages are written for the
 * developer reading a console rather than for the visitor.
 */

import { PasskeyError } from '../shared/errors.js';

export function translateWebAuthnError(error: unknown, ceremony: 'create' | 'get'): PasskeyError {
  if (error instanceof PasskeyError) {
    return error;
  }

  const name = (error as { name?: string } | undefined)?.name;

  switch (name) {
    case 'NotAllowedError':
      return new PasskeyError(
        'cancelled',
        ceremony === 'create'
          ? 'the passkey prompt was dismissed or timed out'
          : 'the sign-in prompt was dismissed, timed out, or no matching passkey was available',
        { cause: error },
      );

    case 'AbortError':
      return new PasskeyError('cancelled', 'the passkey request was aborted', { cause: error });

    case 'InvalidStateError':
      return new PasskeyError(
        'already_registered',
        'this device already holds a passkey for this account, so try signing in instead',
        { cause: error },
      );

    case 'SecurityError':
      return new PasskeyError(
        'insecure_context',
        "the page must be served over HTTPS (or localhost), and the server's rpID must be " +
          "this page's domain or a parent of it",
        { cause: error },
      );

    case 'NotSupportedError':
      return new PasskeyError(
        'unsupported',
        'no available authenticator supports the requested algorithms',
        { cause: error },
      );

    case 'ConstraintError':
      return new PasskeyError(
        'not_allowed',
        'no authenticator could satisfy the request: user verification or a discoverable ' +
          'credential was required and none was available',
        { cause: error },
      );

    case 'UnknownError':
      return new PasskeyError('not_allowed', 'the authenticator failed for an unspecified reason', {
        cause: error,
      });

    default:
      return new PasskeyError(
        'not_allowed',
        (error as Error | undefined)?.message ?? 'the passkey request failed',
        { cause: error },
      );
  }
}

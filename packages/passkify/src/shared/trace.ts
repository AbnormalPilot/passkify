/**
 * Ties the check registry to the code that performs the checks.
 *
 * A registry that merely *describes* the verifier drifts, quietly, the first
 * time someone adds a check and forgets the table. So the verifiers do not
 * describe themselves — they index into the registry, and this module makes
 * that mechanical:
 *
 *   trace.assert('auth.origin_allowed',
 *     originAllowed(clientData.origin, config.origins),
 *     () => new PasskeyError('origin_mismatch', '…'));
 *
 * An unknown id throws immediately, in development and in tests, so a check
 * without a registry entry cannot be merged. `test/checks.test.ts` closes the
 * other direction by running real ceremonies and asserting every registry entry
 * was visited.
 *
 * The recorded trace is also the thing the documentation playground renders:
 * the steps light up in the order the verifier actually ran them, which is a
 * far better explanation than a diagram someone drew once.
 */

import { getCheck, type Ceremony } from './checks.js';
import { PasskeyError } from './errors.js';

export interface CheckEvent {
  ceremony: Ceremony;
  /** A `VERIFICATION_CHECKS` id. */
  id: string;
  /** Position in the registry for this ceremony, 1-based. */
  index: number;
  ok: boolean;
  /** Present when the check failed. */
  code?: string;
}

export type CheckObserver = (event: CheckEvent) => void;

export interface Trace {
  /**
   * Record a check, and throw if it did not pass.
   *
   * The error is built lazily so that composing its message costs nothing on
   * the overwhelmingly common path where the check passes.
   */
  assert(id: string, ok: boolean, error: () => PasskeyError): void;
  /** Record a check that has already been decided elsewhere. */
  record(id: string, ok: boolean, code?: string): void;
  /** Everything recorded so far, in order. */
  readonly events: readonly CheckEvent[];
}

/**
 * A trace for one ceremony. `observer` is the `hooks.onCheck` callback, and is
 * usually absent — when it is, this costs one array push per check.
 */
export function createTrace(ceremony: Ceremony, observer?: CheckObserver): Trace {
  const events: CheckEvent[] = [];

  const emit = (id: string, ok: boolean, code?: string): void => {
    const check = getCheck(id);
    if (!check) {
      // A programming error in passkify, not a problem with the request, so it
      // is loud rather than silent.
      throw new PasskeyError(
        'configuration_error',
        `internal: check "${id}" is not in the registry. Add it to src/shared/checks.ts.`,
      );
    }
    if (check.ceremony !== ceremony) {
      throw new PasskeyError(
        'configuration_error',
        `internal: check "${id}" belongs to the ${check.ceremony} ceremony, not ${ceremony}.`,
      );
    }

    const event: CheckEvent = code
      ? { ceremony, id, index: check.index, ok, code }
      : { ceremony, id, index: check.index, ok };
    events.push(event);
    observer?.(event);
  };

  return {
    events,
    record: emit,
    assert(id, ok, error) {
      if (ok) {
        emit(id, true);
        return;
      }
      const failure = error();
      emit(id, false, failure.code);
      throw failure;
    },
  };
}

/**
 * Parsing and validation of `clientDataJSON` — the browser's signed statement
 * about which ceremony ran, on which origin, with which challenge.
 */

import { PasskeyError } from '../../shared/errors.js';
import { bytesToUtf8, fromBase64Url, bytesEqual, toBase64Url } from '../../shared/base64url.js';
import type { ClientData } from '../../shared/types.js';

export function parseClientData(bytes: Uint8Array): ClientData {
  let text: string;
  try {
    text = bytesToUtf8(bytes);
  } catch (cause) {
    throw new PasskeyError('parse_error', 'clientDataJSON is not valid UTF-8', { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new PasskeyError('parse_error', 'clientDataJSON is not valid JSON', { cause });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PasskeyError('parse_error', 'clientDataJSON is not a JSON object');
  }

  const data = parsed as Record<string, unknown>;
  if (typeof data.type !== 'string') {
    throw new PasskeyError('parse_error', 'clientDataJSON is missing "type"');
  }
  if (typeof data.challenge !== 'string') {
    throw new PasskeyError('parse_error', 'clientDataJSON is missing "challenge"');
  }
  if (typeof data.origin !== 'string') {
    throw new PasskeyError('parse_error', 'clientDataJSON is missing "origin"');
  }

  return {
    type: data.type,
    challenge: data.challenge,
    origin: data.origin,
    crossOrigin: typeof data.crossOrigin === 'boolean' ? data.crossOrigin : undefined,
    topOrigin: typeof data.topOrigin === 'string' ? data.topOrigin : undefined,
    tokenBinding: data.tokenBinding as ClientData['tokenBinding'],
  };
}

/**
 * Compare the challenge the browser signed against the one we issued.
 *
 * Both sides are re-decoded from base64url before comparing, so a padded vs.
 * unpadded encoding of the same bytes still matches, and the comparison itself
 * is constant-time.
 */
export function challengeMatches(signed: string, expected: string): boolean {
  if (signed === expected) {
    return true;
  }
  try {
    return bytesEqual(fromBase64Url(signed), fromBase64Url(expected));
  } catch {
    return false;
  }
}

/**
 * Decide whether an origin is acceptable.
 *
 * Exact string match by default. An entry may also be a `RegExp` or a
 * predicate for setups with per-tenant subdomains — but note that a too-loose
 * pattern here is the single easiest way to hand an attacker your users'
 * credentials, so the docs push hard toward exact strings.
 */
export type OriginMatcher = string | RegExp | ((origin: string) => boolean);

export function originAllowed(origin: string, allowed: readonly OriginMatcher[]): boolean {
  for (const matcher of allowed) {
    if (typeof matcher === 'string') {
      if (matcher === origin) {
        return true;
      }
    } else if (matcher instanceof RegExp) {
      // Reset in case the caller passed a /g regex, whose lastIndex is sticky.
      matcher.lastIndex = 0;
      if (matcher.test(origin)) {
        return true;
      }
    } else if (matcher(origin)) {
      return true;
    }
  }
  return false;
}

/** Re-encode a challenge to the canonical unpadded base64url form. */
export function normalizeChallenge(challenge: Uint8Array | string): string {
  return typeof challenge === 'string' ? challenge : toBase64Url(challenge);
}

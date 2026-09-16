/**
 * `clientDataJSON` parsing, challenge comparison and origin matching.
 *
 * This is the browser's signed statement about which ceremony ran, where, and
 * against which challenge — so almost every branch in it is a refusal, and a
 * refusal that never runs in a test is a refusal nobody has checked.
 *
 * Origin matching gets the most attention here. It is the phishing defence: a
 * matcher that says yes to the wrong host hands an attacker a working login,
 * and nothing downstream will notice.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  parseClientData,
  challengeMatches,
  originAllowed,
  normalizeChallenge,
} from '#internal/server/crypto/client-data.js';
import { toBase64Url } from '#internal/shared/base64url.js';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const wellFormed = {
  type: 'webauthn.get',
  challenge: 'Zm9vYmFy',
  origin: 'https://example.com',
};

function refuses(bytes: Uint8Array, match: RegExp) {
  assert.throws(
    () => parseClientData(bytes),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'parse_error');
      assert.match(error.message, match);
      return true;
    },
  );
}

// ------------------------------------------------------------- parsing

test('a well-formed clientDataJSON parses to its three required fields', () => {
  const data = parseClientData(encode(wellFormed));
  assert.equal(data.type, 'webauthn.get');
  assert.equal(data.challenge, 'Zm9vYmFy');
  assert.equal(data.origin, 'https://example.com');
  assert.equal(data.crossOrigin, undefined);
  assert.equal(data.topOrigin, undefined);
});

test('the optional fields are carried through only when they have the right type', () => {
  const withOptionals = parseClientData(
    encode({ ...wellFormed, crossOrigin: true, topOrigin: 'https://top.example' }),
  );
  assert.equal(withOptionals.crossOrigin, true);
  assert.equal(withOptionals.topOrigin, 'https://top.example');

  // A string "true" is not a boolean, and a number is not an origin. Neither
  // is coerced — a caller checking `crossOrigin === true` must not be fooled
  // by a truthy string the browser never sent.
  const wrongTypes = parseClientData(encode({ ...wellFormed, crossOrigin: 'true', topOrigin: 42 }));
  assert.equal(wrongTypes.crossOrigin, undefined);
  assert.equal(wrongTypes.topOrigin, undefined);
});

test('invalid UTF-8 is refused before it reaches the JSON parser', () => {
  // A lone continuation byte: not a valid sequence in any encoding.
  refuses(new Uint8Array([0xff, 0xfe, 0xfd]), /not valid UTF-8/);
});

test('text that is not JSON is refused', () => {
  refuses(new TextEncoder().encode('{"type":'), /not valid JSON/);
});

test('JSON that is not an object is refused, including null and arrays', () => {
  for (const value of [null, [wellFormed], 'a string', 7, true]) {
    refuses(encode(value), /not a JSON object/);
  }
});

test('each required field is named when it is missing', () => {
  refuses(encode({ challenge: 'a', origin: 'b' }), /missing "type"/);
  refuses(encode({ type: 'a', origin: 'b' }), /missing "challenge"/);
  refuses(encode({ type: 'a', challenge: 'b' }), /missing "origin"/);
});

test('a required field of the wrong type is missing, not coerced', () => {
  refuses(encode({ ...wellFormed, type: 1 }), /missing "type"/);
  refuses(encode({ ...wellFormed, challenge: null }), /missing "challenge"/);
  refuses(encode({ ...wellFormed, origin: ['https://example.com'] }), /missing "origin"/);
});

// ---------------------------------------------------------- challenges

test('a challenge matches itself, and matches across padding differences', () => {
  assert.equal(challengeMatches('Zm9vYmFy', 'Zm9vYmFy'), true);
  // Same bytes, padded encoding: a browser that pads must not be rejected.
  assert.equal(challengeMatches('Zm9vYmE=', 'Zm9vYmE'), true);
});

test('a different challenge does not match, and neither does garbage', () => {
  assert.equal(challengeMatches('Zm9vYmFy', 'YmFyZm9v'), false);
  assert.equal(challengeMatches('', 'Zm9vYmFy'), false);
  // A prefix is not a match: truncating the signed challenge must not pass.
  assert.equal(challengeMatches('Zm9v', 'Zm9vYmFy'), false);
});

// ------------------------------------------------------------- origins

test('an exact string origin matches only itself', () => {
  const allowed = ['https://example.com'];
  assert.equal(originAllowed('https://example.com', allowed), true);
  assert.equal(originAllowed('https://example.com.evil.test', allowed), false);
  assert.equal(originAllowed('http://example.com', allowed), false);
  assert.equal(originAllowed('https://EXAMPLE.com', allowed), false);
});

test('an empty allow-list permits nothing', () => {
  assert.equal(originAllowed('https://example.com', []), false);
});

test('a RegExp matcher is honoured, and a sticky one does not skip', () => {
  const tenant = /^https:\/\/[a-z0-9-]+\.example\.com$/;
  assert.equal(originAllowed('https://acme.example.com', [tenant]), true);
  assert.equal(originAllowed('https://evil.test', [tenant]), false);

  // A /g regex carries lastIndex between calls. Without the reset in
  // originAllowed the second identical check returns false, so the same
  // request succeeds or fails depending on what was asked before it.
  const global = /^https:\/\/acme\.example\.com$/g;
  assert.equal(originAllowed('https://acme.example.com', [global]), true);
  assert.equal(originAllowed('https://acme.example.com', [global]), true);
});

test('a predicate matcher is called and its answer is used', () => {
  const seen: string[] = [];
  const matcher = (origin: string) => {
    seen.push(origin);
    return origin.endsWith('.internal');
  };
  assert.equal(originAllowed('https://box.internal', [matcher]), true);
  assert.equal(originAllowed('https://example.com', [matcher]), false);
  assert.deepEqual(seen, ['https://box.internal', 'https://example.com']);
});

test('the first matching entry wins and the rest are not consulted', () => {
  let called = false;
  const result = originAllowed('https://example.com', [
    'https://example.com',
    () => {
      called = true;
      return false;
    },
  ]);
  assert.equal(result, true);
  assert.equal(called, false);
});

test('mixed matcher kinds are all considered', () => {
  const allowed = ['https://one.test', /^https:\/\/two\./, (o: string) => o === 'https://three'];
  for (const origin of ['https://one.test', 'https://two.test', 'https://three']) {
    assert.equal(originAllowed(origin, allowed), true, origin);
  }
  assert.equal(originAllowed('https://four.test', allowed), false);
});

// ---------------------------------------------------------- normalising

test('a challenge normalises to unpadded base64url, and a string passes through', () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0xbe]);
  assert.equal(normalizeChallenge(bytes), toBase64Url(bytes));
  // base64url, so the alphabet is - and _ rather than + and /.
  assert.doesNotMatch(normalizeChallenge(bytes), /[+/=]/);
  assert.equal(normalizeChallenge('already-a-string'), 'already-a-string');
});

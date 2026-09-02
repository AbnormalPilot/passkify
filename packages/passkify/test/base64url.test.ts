import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { toBase64Url, fromBase64Url } from '../dist/esm/shared/base64url.js';

test('base64url encoding matches Node for every short length', () => {
  for (let length = 0; length <= 64; length++) {
    const bytes = randomBytes(length);
    assert.equal(
      toBase64Url(new Uint8Array(bytes)),
      bytes.toString('base64url'),
      `length ${length}`,
    );
  }
});

test('decoding round-trips and matches Node', () => {
  for (let length = 0; length <= 64; length++) {
    const bytes = randomBytes(length);
    const encoded = bytes.toString('base64url');
    assert.deepEqual(Buffer.from(fromBase64Url(encoded)), bytes, `length ${length}`);
  }
});

test('padding is optional and standard base64 is accepted', () => {
  // "hi there" -> aGkgdGhlcmU (11 chars, needs one '=' when padded)
  assert.deepEqual(Buffer.from(fromBase64Url('aGkgdGhlcmU=')).toString(), 'hi there');
  assert.deepEqual(Buffer.from(fromBase64Url('aGkgdGhlcmU')).toString(), 'hi there');
  // The two alphabets differ only in the last two characters.
  assert.deepEqual(fromBase64Url('++//'), fromBase64Url('--__'));
});

test('bytes with the high bit set survive the round trip', () => {
  const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xfe, 0x01]);
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
});

test('invalid input is rejected rather than silently truncated', () => {
  assert.throws(() => fromBase64Url('a'), TypeError, 'a lone character is not a valid length');
  assert.throws(() => fromBase64Url('ab*d'), TypeError, 'characters outside the alphabet');
  assert.throws(() => fromBase64Url('ab cd'), TypeError, 'whitespace is not stripped');
});

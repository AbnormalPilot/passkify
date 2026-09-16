/**
 * The converter every ECDSA login flows through. A lenient parser here is a
 * signature-malleability bug, so most of this file is things that must be
 * rejected.
 */

import { generateKeyPairSync, sign as nodeSign, webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { CURVES, derToP1363, p1363ToDer } from '#internal/server/crypto/ecdsa-der.js';
import type { CurveName } from '#internal/server/crypto/ecdsa-der.js';

const CURVE_TO_NODE: Record<CurveName, string> = {
  'P-256': 'prime256v1',
  'P-384': 'secp384r1',
  'P-521': 'secp521r1',
};
const CURVE_TO_HASH: Record<CurveName, string> = {
  'P-256': 'sha256',
  'P-384': 'sha384',
  'P-521': 'sha512',
};
const ALL_CURVES = Object.keys(CURVES) as CurveName[];

function rejects(bytes: Uint8Array, curve: CurveName = 'P-256') {
  assert.throws(
    () => derToP1363(bytes, curve),
    (error: { code?: string }) => error.code === 'bad_signature',
  );
}

test('a real signature from every curve converts to the right width', () => {
  for (const curve of ALL_CURVES) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: CURVE_TO_NODE[curve] });
    const der = new Uint8Array(nodeSign(CURVE_TO_HASH[curve], Buffer.from('payload'), privateKey));
    const raw = derToP1363(der, curve);
    assert.equal(raw.length, CURVES[curve].size * 2);
  }
});

test('converted signatures verify under WebCrypto, which only accepts P1363', async () => {
  // The whole reason this file exists: subtle.verify rejects DER outright.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const data = Buffer.from('the payload that was signed');
  const der = new Uint8Array(nodeSign('sha256', data, privateKey));

  const key = await webcrypto.subtle.importKey(
    'jwk',
    publicKey.export({ format: 'jwk' }) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const algorithm = { name: 'ECDSA', hash: 'SHA-256' } as const;
  assert.equal(await webcrypto.subtle.verify(algorithm, key, der, data), false);
  assert.equal(await webcrypto.subtle.verify(algorithm, key, derToP1363(der, 'P-256'), data), true);
});

test('a thousand real signatures all round-trip', () => {
  // Catches the leading-zero cases that only appear once in ~256 signatures.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (let i = 0; i < 1000; i++) {
    const der = new Uint8Array(nodeSign('sha256', Buffer.from(`message ${i}`), privateKey));
    const raw = derToP1363(der, 'P-256');
    assert.equal(raw.length, 64);
    // Re-encoding must reproduce the original bytes exactly, or one of the two
    // directions is non-minimal.
    assert.deepEqual(p1363ToDer(raw, 'P-256'), der);
  }
});

test('a redundant leading zero is rejected', () => {
  // 0x02 0x02 0x00 0x01 encodes 1 with a pad byte it does not need.
  rejects(new Uint8Array([0x30, 0x08, 0x02, 0x02, 0x00, 0x01, 0x02, 0x02, 0x00, 0x01]));
});

test('a negative INTEGER is rejected', () => {
  // Top bit set with no 0x00 pad: negative, and r is never negative.
  rejects(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01]));
});

test('a zero INTEGER is rejected', () => {
  rejects(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]));
});

test('trailing bytes after the sequence are rejected', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = new Uint8Array(nodeSign('sha256', Buffer.from('x'), privateKey));
  const padded = new Uint8Array(der.length + 1);
  padded.set(der);
  padded[der.length] = 0x00;
  rejects(padded);
});

test('a long-form length is rejected even when it decodes to the same value', () => {
  // 0x81 0x06 is the long form of 6 — legal BER, illegal DER, and a second
  // encoding of a signature that already has one.
  rejects(new Uint8Array([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
});

test('a declared length that disagrees with the buffer is rejected', () => {
  rejects(new Uint8Array([0x30, 0x20, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
});

test('r or s at or above the curve order is rejected', () => {
  const { order, size } = CURVES['P-256'];
  const atOrder = new Uint8Array(size * 2);
  let value = order;
  for (let i = size - 1; i >= 0; i--) {
    atOrder[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  atOrder.set(atOrder.subarray(0, size), size);
  // p1363ToDer does not range-check, so this builds a structurally valid DER
  // signature carrying an out-of-range r and s.
  rejects(p1363ToDer(atOrder, 'P-256'));
});

test('a signature for the wrong curve is rejected by width', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const der = new Uint8Array(nodeSign('sha384', Buffer.from('x'), privateKey));
  // P-384 values do not fit P-256 coordinates.
  rejects(der, 'P-256');
});

test('an empty or truncated signature is rejected rather than throwing a TypeError', () => {
  for (const bytes of [
    new Uint8Array(0),
    new Uint8Array([0x30]),
    new Uint8Array([0x30, 0x06]),
    new Uint8Array([0x30, 0x06, 0x02]),
    new Uint8Array([0x30, 0x06, 0x02, 0x01]),
    new Uint8Array([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]),
  ]) {
    rejects(bytes);
  }
});

test('fuzzing with mutated real signatures never escapes a PasskeyError', () => {
  // Every rejection must be the typed error, never a TypeError or a RangeError
  // escaping from an index that was not checked.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base = new Uint8Array(nodeSign('sha256', Buffer.from('seed'), privateKey));

  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const mutated = Uint8Array.from(base);
    // Deterministic mutation so a failure is reproducible from the index.
    const position = (i * 7) % mutated.length;
    mutated[position] = (mutated[position] + 1 + (i % 251)) & 0xff;

    try {
      derToP1363(mutated, 'P-256');
      accepted += 1;
    } catch (error) {
      assert.equal(
        (error as { code?: string }).code,
        'bad_signature',
        `mutation ${i} at byte ${position} threw ${(error as Error).name}: ${(error as Error).message}`,
      );
    }
  }
  // Mutating a value byte still yields a well-formed signature, so some are
  // accepted. Structural mutations must not be.
  assert.ok(accepted < 3000, 'every mutation was accepted, the parser is not checking structure');
});

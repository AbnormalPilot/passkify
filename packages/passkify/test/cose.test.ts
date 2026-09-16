/**
 * COSE_Key parsing.
 *
 * The credential's public key is stored as the exact CBOR the authenticator
 * produced and re-parsed on every login, so this runs on the hot path of every
 * authentication — and it runs on bytes that came from outside. The mismatches
 * matter as much as the happy path: an algorithm that disagrees with its key
 * type, or a curve that disagrees with its algorithm, is a key nobody should
 * be importing.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  parseCOSEPublicKey,
  canVerifyAlgorithm,
  isSupportedAlgorithm,
  algorithmName,
  digestForAlgorithm,
} from '#internal/server/crypto/cose.js';
import { COSEAlgorithm } from '#internal/shared/types.js';
import { encodeCBOR, type Encodable } from '#internal/testing/index.js';

const KTY = { OKP: 1, EC2: 2, RSA: 3 } as const;
const CRV = { P256: 1, P384: 2, P521: 3, Ed25519: 6 } as const;

const key = (entries: [number, Encodable][]) => encodeCBOR(new Map<number, Encodable>(entries));

const unBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * A genuine point on the named curve.
 *
 * Filler bytes are not a public key: WebCrypto validates the point at import,
 * which is the check that makes storing raw COSE worthwhile, so the happy-path
 * fixtures have to be real.
 */
async function point(namedCurve: 'P-256' | 'P-384') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { x: unBase64Url(jwk.x as string), y: unBase64Url(jwk.y as string) };
}

const P256 = await point('P-256');

interface EcOverrides {
  kty?: Encodable;
  alg?: Encodable;
  crv?: Encodable;
  x?: Encodable;
  y?: Encodable;
}

const ec = (over: EcOverrides = {}) =>
  key([
    [1, over.kty ?? KTY.EC2],
    [3, over.alg ?? COSEAlgorithm.ES256],
    [-1, over.crv ?? CRV.P256],
    [-2, over.x ?? P256.x],
    [-3, over.y ?? P256.y],
  ]);

async function refuses(bytes: Uint8Array, code: string, match: RegExp) {
  await assert.rejects(parseCOSEPublicKey(bytes), (error: Error & { code?: string }) => {
    assert.equal(error.code, code);
    assert.match(error.message, match);
    return true;
  });
}

// ----------------------------------------------------------------- happy

test('an EC2 P-256 key parses and reports its algorithm and curve', async () => {
  const parsed = await parseCOSEPublicKey(ec());
  assert.equal(parsed.alg, COSEAlgorithm.ES256);
  assert.equal(parsed.algName, 'ES256');
  assert.equal(parsed.curve, 'P-256');
  assert.equal(parsed.key.type, 'public');
  // The key is imported for verification only — it must never be usable to sign.
  assert.deepEqual(parsed.key.usages, ['verify']);
  assert.equal(parsed.key.extractable, false);
});

test('a coordinate with its leading zero stripped is padded back, not rejected', async () => {
  // Authenticators do strip leading zeros, and the coordinate is still the
  // same number. Refusing it would lock out real credentials, so this only
  // applies when the real x happens to start with one.
  const stripped = P256.x[0] === 0 ? P256.x.subarray(1) : P256.x;
  const parsed = await parseCOSEPublicKey(ec({ x: stripped }));
  assert.equal(parsed.curve, 'P-256');
});

// ------------------------------------------------------------- structure

test('a key missing kty or alg is refused', async () => {
  await refuses(key([[3, COSEAlgorithm.ES256]]), 'parse_error', /key type \(kty\)/);
  await refuses(key([[1, KTY.EC2]]), 'parse_error', /algorithm \(alg\)/);
});

test('an unknown algorithm is refused as unsupported', async () => {
  await refuses(ec({ alg: -65535 }), 'unsupported_algorithm', /-65535 is not supported/);
  await refuses(ec({ alg: 12345 }), 'unsupported_algorithm', /12345 is not supported/);
});

test('an algorithm that disagrees with the key type is refused', async () => {
  // RS256 is an RSA algorithm; presenting it on an EC2 key is incoherent.
  await refuses(ec({ alg: COSEAlgorithm.RS256 }), 'parse_error', /does not go with key type 2/);
});

test('an unsupported key type is refused', async () => {
  await refuses(
    key([
      [1, 7],
      [3, COSEAlgorithm.ES256],
    ]),
    'parse_error',
    /does not go with key type 7/,
  );
});

// ---------------------------------------------------------------- curves

test('a curve that disagrees with the algorithm is refused', async () => {
  // ES256 is defined over P-256 only. P-384 here is either a broken
  // authenticator or someone hoping the curve is not checked.
  await refuses(ec({ crv: CRV.P384 }), 'parse_error', /requires curve 1, got 2/);
});

test('a curve the algorithm does not name is refused before any lookup', async () => {
  const p384 = await point('P-384');
  await refuses(
    key([
      [1, KTY.EC2],
      [3, COSEAlgorithm.ES384],
      [-1, 99],
      [-2, p384.x],
      [-3, p384.y],
    ]),
    'parse_error',
    /requires curve 2, got 99/,
  );
});

test('an ES384 key over P-384 parses', async () => {
  const p384 = await point('P-384');
  const parsed = await parseCOSEPublicKey(
    key([
      [1, KTY.EC2],
      [3, COSEAlgorithm.ES384],
      [-1, CRV.P384],
      [-2, p384.x],
      [-3, p384.y],
    ]),
  );
  assert.equal(parsed.curve, 'P-384');
  assert.equal(parsed.algName, 'ES384');
});

test('an EC2 key missing a coordinate is refused', async () => {
  await refuses(
    key([
      [1, KTY.EC2],
      [3, COSEAlgorithm.ES256],
      [-1, CRV.P256],
      [-3, new Uint8Array(32).fill(3)],
    ]),
    'parse_error',
    /x coordinate/,
  );
});

test('a coordinate that is too long for its curve is refused', async () => {
  await refuses(ec({ x: new Uint8Array(40).fill(2) }), 'parse_error', /x/);
});

test('a point that is not on the curve is rejected at import', async () => {
  // Right key type, right algorithm, right lengths — and not a point on P-256.
  // WebCrypto does that validation, which is the reason the credential record
  // keeps raw COSE and re-imports it rather than storing a converted key once.
  await refuses(
    ec({ x: new Uint8Array(32).fill(2), y: new Uint8Array(32).fill(3) }),
    'parse_error',
    /rejected as invalid/,
  );
});

// ------------------------------------------------------------------- RSA

test('an RSA modulus below 2048 bits is refused', async () => {
  await refuses(
    key([
      [1, KTY.RSA],
      [3, COSEAlgorithm.RS256],
      [-1, new Uint8Array(128).fill(0xff)],
      [-2, new Uint8Array([0x01, 0x00, 0x01])],
    ]),
    'parse_error',
    /refusing anything below 2048/,
  );
});

// --------------------------------------------------------------- helpers

test('the algorithm helpers agree about what is supported', async () => {
  assert.equal(isSupportedAlgorithm(COSEAlgorithm.ES256), true);
  assert.equal(isSupportedAlgorithm(-65535), false);

  assert.equal(algorithmName(COSEAlgorithm.ES256), 'ES256');
  assert.equal(algorithmName(-65535), undefined);

  assert.equal(digestForAlgorithm(COSEAlgorithm.ES256), 'SHA-256');
  assert.equal(digestForAlgorithm(COSEAlgorithm.ES512), 'SHA-512');
  assert.throws(() => digestForAlgorithm(-65535), /-65535 is not supported/);

  assert.equal(await canVerifyAlgorithm(COSEAlgorithm.ES256), true);
  // RS1 was removed deliberately: it is RSA with SHA-1.
  assert.equal(await canVerifyAlgorithm(-65535), false);
});

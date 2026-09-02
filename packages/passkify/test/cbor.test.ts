import test from 'node:test';
import assert from 'node:assert/strict';

import { decode, decodeFirst } from '../dist/esm/server/crypto/cbor.js';
import { hex, encodeCBOR } from './helpers/cbor-encode.ts';

/**
 * Vectors lifted from RFC 8949 Appendix A. These are the authority — checking
 * the decoder against them, rather than against our own encoder, is the point.
 */
const RFC_VECTORS: Array<[string, unknown]> = [
  ['00', 0],
  ['01', 1],
  ['0a', 10],
  ['17', 23],
  ['1818', 24],
  ['1819', 25],
  ['1864', 100],
  ['1903e8', 1000],
  ['1a000f4240', 1000000],
  ['20', -1],
  ['29', -10],
  ['3863', -100],
  ['3903e7', -1000],
  ['f4', false],
  ['f5', true],
  ['f6', null],
  ['f7', undefined],
  ['60', ''],
  ['6161', 'a'],
  ['6449455446', 'IETF'],
  ['62225c', '"\\'],
  ['62c3bc', 'ü'],
  ['63e6b0b4', '水'],
  ['80', []],
  ['83010203', [1, 2, 3]],
  ['8301820203820405', [1, [2, 3], [4, 5]]],
  ['98190102030405060708090a0b0c0d0e0f101112131415161718181819',
    Array.from({ length: 25 }, (_, i) => i + 1)],
];

test('decodes the RFC 8949 Appendix A vectors', () => {
  for (const [encoded, expected] of RFC_VECTORS) {
    assert.deepEqual(decode(hex(encoded)), expected, `vector ${encoded}`);
  }
});

test('decodes RFC 8949 byte strings and maps', () => {
  assert.deepEqual(decode(hex('40')), new Uint8Array([]));
  assert.deepEqual(decode(hex('4401020304')), new Uint8Array([1, 2, 3, 4]));

  assert.deepEqual(decode(hex('a0')), new Map());
  assert.deepEqual(decode(hex('a201020304')), new Map([[1, 2], [3, 4]]));
  assert.deepEqual(
    decode(hex('a26161016162820203')),
    new Map<string, unknown>([['a', 1], ['b', [2, 3]]]),
  );
});

test('decodes half, single and double precision floats', () => {
  assert.equal(decode(hex('f90000')), 0);
  assert.equal(decode(hex('f93c00')), 1);
  assert.equal(decode(hex('f97e00')) as number, Number.NaN);
  assert.equal(decode(hex('f97c00')), Number.POSITIVE_INFINITY);
  assert.equal(decode(hex('fa47c35000')), 100000);
  assert.equal(decode(hex('fb3ff199999999999a')), 1.1);
});

test('decodes indefinite-length items, which some authenticators still emit', () => {
  assert.deepEqual(decode(hex('9fff')), []);
  assert.deepEqual(decode(hex('9f018202039f0405ffff')), [1, [2, 3], [4, 5]]);
  assert.deepEqual(decode(hex('7f657374726561646d696e67ff')), 'streaming');
  assert.deepEqual(decode(hex('5f42010243030405ff')), new Uint8Array([1, 2, 3, 4, 5]));
});

test('integers beyond 2^53 surface as bigint instead of losing precision', () => {
  assert.equal(decode(hex('1bffffffffffffffff')), 18446744073709551615n);
  assert.equal(decode(hex('3bffffffffffffffff')), -18446744073709551616n);
  // Still a plain number while that is lossless.
  assert.equal(decode(hex('1b0000000000000064')), 100);
});

test('trailing bytes are rejected by decode but reported by decodeFirst', () => {
  assert.throws(() => decode(hex('0000')), /trailing/);
  const { value, bytesRead } = decodeFirst(hex('00ffffff'));
  assert.equal(value, 0);
  assert.equal(bytesRead, 1);
});

test('truncated input is rejected instead of returning a partial value', () => {
  assert.throws(() => decode(hex('19')), /unexpected end/);
  assert.throws(() => decode(hex('43aabb')), /exceeds/, 'byte string shorter than declared');
  // The item-count guard catches this one before the reader runs off the end.
  assert.throws(() => decode(hex('8301')), /cannot fit/, 'array shorter than declared');
  // array(2) whose second item is a uint16 head with no payload behind it.
  assert.throws(() => decode(hex('820119')), /unexpected end/, 'array item truncated');
});

test('a lying length header cannot cause a huge allocation', () => {
  // "array of 4 billion items" in three bytes.
  assert.throws(() => decode(hex('9affffffff')), /cannot fit/);
  assert.throws(() => decode(hex('baffffffff')), /cannot fit/);
  assert.throws(() => decode(hex('5affffffff')), /exceeds/);
});

test('duplicate map keys are rejected as a parser-differential risk', () => {
  // {1: 2, 1: 3}
  assert.throws(() => decode(hex('a201020103')), /duplicate/);
});

test('non-integer, non-string map keys are rejected', () => {
  // {[1]: 2}
  assert.throws(() => decode(hex('a18101 02'.replace(/ /g, ''))), /map keys/);
});

test('deeply nested input is rejected rather than blowing the stack', () => {
  // 64 nested single-element arrays.
  const nested = new Uint8Array(Array.from({ length: 64 }, () => 0x81).concat([0x00]));
  assert.throws(() => decode(nested), /nesting/);
});

test('malformed UTF-8 in a text string is rejected', () => {
  // Major type 3, length 2, then an invalid continuation sequence.
  assert.throws(() => decode(hex('62c328')), /UTF-8/);
});

test('reserved additional-information values are rejected', () => {
  assert.throws(() => decode(hex('1c')), /reserved/);
  assert.throws(() => decode(hex('1e')), /reserved/);
});

test('agrees with the independent test encoder on round trips', () => {
  const value = new Map<string | number, never>([
    ['fmt', 'packed' as never],
    ['authData', new Uint8Array([1, 2, 3]) as never],
    [-7, [1, 2, 3] as never],
  ]);
  assert.deepEqual(decode(encodeCBOR(value as never)), value);
});

/**
 * The authenticator data parser.
 *
 * These bytes arrive from an attacker-controlled channel and every later check
 * reads its fields out of them, so the parser's job is mostly to refuse. The
 * tests are shaped accordingly: one well-formed case per feature, then each way
 * the same structure can be malformed.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parseAuthenticatorData } from '#internal/server/crypto/authenticator-data.js';
import { encodeCBOR, type Encodable } from '#internal/testing/index.js';

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;
const ED = 0x80;

const RP_ID_HASH = new Uint8Array(32).fill(1);

const cose = encodeCBOR(
  new Map<number, Encodable>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(32).fill(2)],
    [-3, new Uint8Array(32).fill(3)],
  ]),
);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The fixed 37-byte header: rpIdHash, flags, sign count. */
function header(flags: number, signCount = 0): Uint8Array {
  const out = new Uint8Array(37);
  out.set(RP_ID_HASH, 0);
  out[32] = flags;
  out[33] = (signCount >>> 24) & 0xff;
  out[34] = (signCount >>> 16) & 0xff;
  out[35] = (signCount >>> 8) & 0xff;
  out[36] = signCount & 0xff;
  return out;
}

/** Attested credential data: aaguid, credential ID with its length, COSE key. */
function attested(credentialId: Uint8Array, declaredLength = credentialId.length): Uint8Array {
  const prefix = new Uint8Array(18);
  prefix.set(new Uint8Array(16).fill(4), 0);
  prefix[16] = (declaredLength >> 8) & 0xff;
  prefix[17] = declaredLength & 0xff;
  return concat(prefix, credentialId, cose);
}

function refuses(bytes: Uint8Array, match: RegExp) {
  assert.throws(
    () => parseAuthenticatorData(bytes),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'parse_error');
      assert.match(error.message, match);
      return true;
    },
  );
}

// ------------------------------------------------------------------ header

test('the 37-byte header parses into its hash, flags and counter', () => {
  const parsed = parseAuthenticatorData(header(UP | UV, 42));
  assert.deepEqual(parsed.rpIdHash, RP_ID_HASH);
  assert.equal(parsed.rawFlags, UP | UV);
  assert.equal(parsed.signCount, 42);
  assert.equal(parsed.flags.userPresent, true);
  assert.equal(parsed.flags.userVerified, true);
  assert.equal(parsed.flags.attestedCredentialData, false);
  assert.equal(parsed.attestedCredentialData, undefined);
  assert.equal(parsed.extensions, undefined);
});

test('the sign count is big-endian and unsigned', () => {
  // The top bit set is where a signed read would wrap to a negative number and
  // make every later counter comparison nonsense.
  assert.equal(parseAuthenticatorData(header(UP, 0xffffffff)).signCount, 4294967295);
  assert.equal(parseAuthenticatorData(header(UP, 0x01020304)).signCount, 16909060);
});

test('every flag is decoded independently', () => {
  const parsed = parseAuthenticatorData(header(UP | UV | BE | BS)).flags;
  assert.deepEqual(parsed, {
    userPresent: true,
    userVerified: true,
    backupEligible: true,
    backedUp: true,
    attestedCredentialData: false,
    extensionData: false,
  });

  const none = parseAuthenticatorData(header(0)).flags;
  assert.equal(Object.values(none).some(Boolean), false);
});

test('anything shorter than the header is refused', () => {
  refuses(new Uint8Array(36), /expected at least 37 bytes, got 36/);
  refuses(new Uint8Array(0), /expected at least 37 bytes, got 0/);
});

test('a credential backed up without being eligible is refused', () => {
  // BS without BE is invalid per the spec, and it is the shape a tampered
  // response takes when someone flips the flag to claim a synced credential.
  refuses(header(UP | BS), /backup-state flag is set without the backup-eligible flag/);
  // The legitimate combination still parses.
  assert.equal(parseAuthenticatorData(header(UP | BE | BS)).flags.backedUp, true);
});

// ----------------------------------------------- attested credential data

test('attested credential data parses when the AT flag is set', () => {
  const credentialId = new Uint8Array(20).fill(5);
  const parsed = parseAuthenticatorData(concat(header(UP | AT), attested(credentialId)));

  assert.ok(parsed.attestedCredentialData);
  assert.deepEqual(parsed.attestedCredentialData.aaguid, new Uint8Array(16).fill(4));
  assert.deepEqual(parsed.attestedCredentialData.credentialId, credentialId);
  assert.deepEqual(parsed.attestedCredentialData.credentialPublicKey, cose);
});

test('truncated attested credential data is refused', () => {
  // AT set, but not even the aaguid and length field follow.
  refuses(concat(header(UP | AT), new Uint8Array(10)), /truncated attested credential data/);
});

test('a credential ID length outside the permitted range is refused', () => {
  const zero = concat(header(UP | AT), attested(new Uint8Array(0), 0));
  refuses(zero, /credential ID length 0 is out of range/);

  const tooLong = concat(header(UP | AT), attested(new Uint8Array(4), 1024));
  refuses(tooLong, /credential ID length 1024 is out of range/);
});

test('a credential ID shorter than its declared length is refused', () => {
  // Declares 1000 bytes and supplies ten. A parser that trusted the length
  // field would read a kilobyte from wherever the buffer happens to sit.
  const prefix = new Uint8Array(18);
  prefix.set(new Uint8Array(16).fill(4), 0);
  prefix[16] = (1000 >> 8) & 0xff;
  prefix[17] = 1000 & 0xff;
  refuses(concat(header(UP | AT), prefix, new Uint8Array(10).fill(6)), /truncated credential ID/);
});

// -------------------------------------------------------------- extensions

test('extension data parses when the ED flag is set', () => {
  const extensions = encodeCBOR(new Map<string, Encodable>([['credProtect', 2]]));
  const parsed = parseAuthenticatorData(concat(header(UP | ED), extensions));
  assert.equal(parsed.extensions?.get('credProtect'), 2);
});

test('extension data that is not a CBOR map is refused', () => {
  refuses(concat(header(UP | ED), encodeCBOR([1, 2, 3])), /extension data is not a CBOR map/);
});

test('attested credential data and extensions parse together', () => {
  const credentialId = new Uint8Array(16).fill(8);
  const extensions = encodeCBOR(new Map<string, Encodable>([['credProtect', 3]]));
  const parsed = parseAuthenticatorData(
    concat(header(UP | AT | ED), attested(credentialId), extensions),
  );
  assert.deepEqual(parsed.attestedCredentialData?.credentialId, credentialId);
  assert.equal(parsed.extensions?.get('credProtect'), 3);
});

// ---------------------------------------------------------------- trailing

test('trailing bytes are refused rather than ignored', () => {
  refuses(concat(header(UP), new Uint8Array(3)), /3 unexpected trailing byte\(s\)/);
  // Including after a structure that parsed perfectly well on its own.
  refuses(
    concat(header(UP | AT), attested(new Uint8Array(16).fill(5)), new Uint8Array(1)),
    /1 unexpected trailing byte\(s\)/,
  );
});

test('the exact bytes parsed are carried through for the signature base', () => {
  const bytes = concat(header(UP | AT), attested(new Uint8Array(16).fill(5)));
  assert.deepEqual(parseAuthenticatorData(bytes).bytes, bytes);
});

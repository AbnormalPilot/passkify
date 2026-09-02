/**
 * COSE_Key (RFC 8152) parsing and signature verification.
 *
 * Authenticators hand us public keys as COSE maps. Rather than hand-assemble
 * SPKI DER, we translate COSE into a JWK and let Node's `crypto` import it —
 * that keeps the curve/point validation inside OpenSSL where it belongs.
 */

import { createPublicKey, verify as nodeVerify, constants, type KeyObject } from 'node:crypto';
import { PasskeyError } from '../../shared/errors.js';
import { COSEAlgorithm } from '../../shared/types.js';
import { toBase64Url } from '../../shared/base64url.js';
import { decodeMap, type CBORMap, type CBORValue } from './cbor.js';

/** COSE_Key common parameters. */
const COSEKeyLabel = { kty: 1, alg: 3 } as const;

/** Key-type-specific parameters. Note that RSA reuses -1/-2 for n/e. */
const COSEKeyTypeLabel = { crv: -1, x: -2, y: -3, n: -1, e: -2 } as const;

const COSEKeyType = { OKP: 1, EC2: 2, RSA: 3 } as const;

const COSECurve = { P256: 1, P384: 2, P521: 3, Ed25519: 6 } as const;

interface ECParams {
  jwkCurve: 'P-256' | 'P-384' | 'P-521';
  /** Byte length of one coordinate. */
  coordinateSize: number;
}

const EC_CURVES: Record<number, ECParams> = {
  [COSECurve.P256]: { jwkCurve: 'P-256', coordinateSize: 32 },
  [COSECurve.P384]: { jwkCurve: 'P-384', coordinateSize: 48 },
  [COSECurve.P521]: { jwkCurve: 'P-521', coordinateSize: 66 },
};

interface AlgorithmSpec {
  name: string;
  /** Node digest name, or `null` for Ed25519 which hashes internally. */
  hash: string | null;
  keyType: number;
  /** For EC algorithms, the one curve the spec pins them to. */
  curve?: number;
  rsaPadding?: number;
}

const ALGORITHMS: Record<number, AlgorithmSpec> = {
  [COSEAlgorithm.ES256]: {
    name: 'ES256',
    hash: 'sha256',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P256,
  },
  [COSEAlgorithm.ES384]: {
    name: 'ES384',
    hash: 'sha384',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P384,
  },
  [COSEAlgorithm.ES512]: {
    name: 'ES512',
    hash: 'sha512',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P521,
  },
  [COSEAlgorithm.EdDSA]: { name: 'EdDSA', hash: null, keyType: COSEKeyType.OKP },
  [COSEAlgorithm.RS256]: { name: 'RS256', hash: 'sha256', keyType: COSEKeyType.RSA },
  [COSEAlgorithm.RS384]: { name: 'RS384', hash: 'sha384', keyType: COSEKeyType.RSA },
  [COSEAlgorithm.RS512]: { name: 'RS512', hash: 'sha512', keyType: COSEKeyType.RSA },
  [COSEAlgorithm.RS1]: { name: 'RS1', hash: 'sha1', keyType: COSEKeyType.RSA },
  [COSEAlgorithm.PS256]: {
    name: 'PS256',
    hash: 'sha256',
    keyType: COSEKeyType.RSA,
    rsaPadding: constants.RSA_PKCS1_PSS_PADDING,
  },
  [COSEAlgorithm.PS384]: {
    name: 'PS384',
    hash: 'sha384',
    keyType: COSEKeyType.RSA,
    rsaPadding: constants.RSA_PKCS1_PSS_PADDING,
  },
  [COSEAlgorithm.PS512]: {
    name: 'PS512',
    hash: 'sha512',
    keyType: COSEKeyType.RSA,
    rsaPadding: constants.RSA_PKCS1_PSS_PADDING,
  },
};

export interface ParsedCOSEKey {
  /** COSE algorithm identifier, e.g. -7 for ES256. */
  alg: number;
  /** Human-readable algorithm name, e.g. `"ES256"`. */
  algName: string;
  /** Imported and validated public key, ready for `verifySignature`. */
  key: KeyObject;
}

function fail(message: string, cause?: unknown): never {
  throw new PasskeyError('parse_error', `COSE key: ${message}`, { cause });
}

function requireInt(map: CBORMap, label: number, what: string): number {
  const value = map.get(label);
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`missing or non-integer ${what}`);
  }
  return value;
}

function requireBytes(map: CBORMap, label: number, what: string): Uint8Array {
  const value: CBORValue | undefined = map.get(label);
  if (!(value instanceof Uint8Array) || value.length === 0) {
    fail(`missing or empty ${what}`);
  }
  return value;
}

/**
 * Left-pad a coordinate to the curve's fixed width.
 *
 * A few authenticators trim leading zero bytes; JWK requires the full width, so
 * pad rather than reject. Anything longer than the curve is genuinely invalid.
 */
function padCoordinate(value: Uint8Array, size: number, what: string): Uint8Array {
  if (value.length === size) {
    return value;
  }
  if (value.length > size) {
    fail(`${what} is ${value.length} bytes, longer than the ${size}-byte curve`);
  }
  const padded = new Uint8Array(size);
  padded.set(value, size - value.length);
  return padded;
}

/** JWK big-endian integers must not carry leading zero bytes. */
function stripLeadingZeros(value: Uint8Array, what: string): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) {
    start++;
  }
  const trimmed = value.subarray(start);
  if (trimmed.length === 0) {
    fail(`${what} is zero`);
  }
  return trimmed;
}

/** Parse a COSE_Key into a validated Node public key. */
export function parseCOSEPublicKey(coseBytes: Uint8Array): ParsedCOSEKey {
  const map = decodeMap(coseBytes);

  const kty = requireInt(map, COSEKeyLabel.kty, 'key type (kty)');
  const alg = requireInt(map, COSEKeyLabel.alg, 'algorithm (alg)');

  const spec = ALGORITHMS[alg];
  if (!spec) {
    throw new PasskeyError(
      'unsupported_algorithm',
      `COSE algorithm ${alg} is not supported by passkify`,
    );
  }
  if (spec.keyType !== kty) {
    fail(`algorithm ${spec.name} does not go with key type ${kty}`);
  }

  let jwk: Record<string, string>;

  if (kty === COSEKeyType.EC2) {
    const crv = requireInt(map, COSEKeyTypeLabel.crv, 'curve (crv)');
    if (spec.curve !== undefined && crv !== spec.curve) {
      fail(`algorithm ${spec.name} requires curve ${spec.curve}, got ${crv}`);
    }
    const curve = EC_CURVES[crv];
    if (!curve) {
      throw new PasskeyError('unsupported_algorithm', `COSE curve ${crv} is not supported`);
    }
    const x = padCoordinate(requireBytes(map, COSEKeyTypeLabel.x, 'x coordinate'), curve.coordinateSize, 'x');
    const y = padCoordinate(requireBytes(map, COSEKeyTypeLabel.y, 'y coordinate'), curve.coordinateSize, 'y');
    jwk = { kty: 'EC', crv: curve.jwkCurve, x: toBase64Url(x), y: toBase64Url(y) };
  } else if (kty === COSEKeyType.OKP) {
    const crv = requireInt(map, COSEKeyTypeLabel.crv, 'curve (crv)');
    if (crv !== COSECurve.Ed25519) {
      throw new PasskeyError(
        'unsupported_algorithm',
        `EdDSA curve ${crv} is not supported (only Ed25519)`,
      );
    }
    const x = requireBytes(map, COSEKeyTypeLabel.x, 'x coordinate');
    if (x.length !== 32) {
      fail(`Ed25519 public key must be 32 bytes, got ${x.length}`);
    }
    jwk = { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(x) };
  } else if (kty === COSEKeyType.RSA) {
    const n = stripLeadingZeros(requireBytes(map, COSEKeyTypeLabel.n, 'modulus (n)'), 'modulus');
    const e = stripLeadingZeros(requireBytes(map, COSEKeyTypeLabel.e, 'exponent (e)'), 'exponent');
    if (n.length < 256) {
      fail(`RSA modulus is ${n.length * 8} bits; refusing anything below 2048`);
    }
    jwk = { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) };
  } else {
    throw new PasskeyError('unsupported_algorithm', `COSE key type ${kty} is not supported`);
  }

  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as never, format: 'jwk' });
  } catch (cause) {
    fail('the public key was rejected as invalid', cause);
  }

  return { alg, algName: spec.name, key };
}

/**
 * Verify a WebAuthn signature.
 *
 * Returns a boolean rather than throwing: "did not verify" is an expected
 * outcome, not an exceptional one. Genuine problems (an unusable key) still
 * throw.
 */
export function verifySignature(
  parsed: ParsedCOSEKey,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  const spec = ALGORITHMS[parsed.alg];
  if (!spec) {
    throw new PasskeyError('unsupported_algorithm', `COSE algorithm ${parsed.alg} is not supported`);
  }

  try {
    if (spec.rsaPadding !== undefined) {
      return nodeVerify(
        spec.hash,
        data,
        {
          key: parsed.key,
          padding: spec.rsaPadding,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      );
    }
    return nodeVerify(spec.hash, data, parsed.key, signature);
  } catch {
    // OpenSSL throws on structurally invalid signatures (e.g. malformed ECDSA
    // DER). That is a failed verification, not a server fault.
    return false;
  }
}

/** Look up the printable name of a COSE algorithm, if we know it. */
export function algorithmName(alg: number): string | undefined {
  return ALGORITHMS[alg]?.name;
}

/**
 * The Node digest name a COSE algorithm signs with, or `null` for Ed25519
 * (which hashes internally and takes `null` as its algorithm in `crypto.verify`).
 * Throws for algorithms passkify cannot verify.
 */
export function digestForAlgorithm(alg: number): string | null {
  const spec = ALGORITHMS[alg];
  if (!spec) {
    throw new PasskeyError('unsupported_algorithm', `COSE algorithm ${alg} is not supported`);
  }
  return spec.hash;
}

/** The RSA-PSS padding options for a COSE algorithm, if it needs any. */
export function rsaPssOptionsFor(
  alg: number,
): { padding: number; saltLength: number } | undefined {
  const spec = ALGORITHMS[alg];
  if (!spec || spec.rsaPadding === undefined) {
    return undefined;
  }
  return { padding: spec.rsaPadding, saltLength: constants.RSA_PSS_SALTLEN_DIGEST };
}

/** True when passkify can verify signatures for this COSE algorithm. */
export function isSupportedAlgorithm(alg: number): boolean {
  return alg in ALGORITHMS;
}

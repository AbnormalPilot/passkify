/**
 * COSE_Key (RFC 8152) parsing and signature verification, over WebCrypto.
 *
 * Authenticators hand us public keys as COSE maps. Rather than hand-assemble
 * SPKI DER, we translate COSE into a JWK and let `subtle.importKey` take it —
 * which keeps curve and point validation inside the platform's crypto
 * implementation, where it belongs.
 *
 * Two things changed when this moved off `node:crypto`, and both matter:
 *
 * Importing and verifying are now asynchronous. That is what makes the package
 * run on Cloudflare Workers, Deno and Bun, where `node:crypto` is absent or
 * partial, and it is why the ceremony verifiers are async all the way down.
 *
 * ECDSA signatures have to be converted. Authenticators emit ASN.1 DER;
 * `subtle.verify` accepts only fixed-width `r ‖ s`. Node's legacy `verify`
 * silently accepted both, which is why no conversion existed before. See
 * `ecdsa-der.ts` — it is the strictest parser in this package for a reason.
 */

import { crypto } from './provider.js';
import { PasskeyError } from '../../shared/errors.js';
import { COSEAlgorithm } from '../../shared/types.js';
import { toBase64Url } from '../../shared/base64url.js';
import { decodeMap, type CBORMap, type CBORValue } from './cbor.js';
import { derToP1363, type CurveName } from './ecdsa-der.js';

/** COSE_Key common parameters. */
const COSEKeyLabel = { kty: 1, alg: 3 } as const;

/** Key-type-specific parameters. Note that RSA reuses -1/-2 for n/e. */
const COSEKeyTypeLabel = { crv: -1, x: -2, y: -3, n: -1, e: -2 } as const;

const COSEKeyType = { OKP: 1, EC2: 2, RSA: 3 } as const;

const COSECurve = { P256: 1, P384: 2, P521: 3, Ed25519: 6 } as const;

interface ECParams {
  jwkCurve: CurveName;
  /** Byte length of one coordinate. */
  coordinateSize: number;
}

const EC_CURVES: Record<number, ECParams> = {
  [COSECurve.P256]: { jwkCurve: 'P-256', coordinateSize: 32 },
  [COSECurve.P384]: { jwkCurve: 'P-384', coordinateSize: 48 },
  [COSECurve.P521]: { jwkCurve: 'P-521', coordinateSize: 66 },
};

type HashName = 'SHA-256' | 'SHA-384' | 'SHA-512';

interface AlgorithmSpec {
  name: string;
  keyType: number;
  /** For EC algorithms, the one curve the specification pins them to. */
  curve?: number;
  /** Absent for Ed25519, which hashes internally. */
  hash?: HashName;
  /** WebCrypto algorithm family. */
  family: 'ECDSA' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'Ed25519';
}

/**
 * Every algorithm passkify can verify.
 *
 * RS1 (COSE -65535, RSA with SHA-1) is deliberately absent. It was reachable
 * here before 1.0 for anyone who put it in `supportedAlgorithms`, and SHA-1
 * signature verification has no place in an authentication library. Asking for
 * it now fails at configuration time rather than at login.
 */
const ALGORITHMS: Record<number, AlgorithmSpec> = {
  [COSEAlgorithm.ES256]: {
    name: 'ES256',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P256,
    hash: 'SHA-256',
    family: 'ECDSA',
  },
  [COSEAlgorithm.ES384]: {
    name: 'ES384',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P384,
    hash: 'SHA-384',
    family: 'ECDSA',
  },
  [COSEAlgorithm.ES512]: {
    name: 'ES512',
    keyType: COSEKeyType.EC2,
    curve: COSECurve.P521,
    hash: 'SHA-512',
    family: 'ECDSA',
  },
  [COSEAlgorithm.EdDSA]: { name: 'EdDSA', keyType: COSEKeyType.OKP, family: 'Ed25519' },
  [COSEAlgorithm.RS256]: {
    name: 'RS256',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-256',
    family: 'RSASSA-PKCS1-v1_5',
  },
  [COSEAlgorithm.RS384]: {
    name: 'RS384',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-384',
    family: 'RSASSA-PKCS1-v1_5',
  },
  [COSEAlgorithm.RS512]: {
    name: 'RS512',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-512',
    family: 'RSASSA-PKCS1-v1_5',
  },
  [COSEAlgorithm.PS256]: {
    name: 'PS256',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-256',
    family: 'RSA-PSS',
  },
  [COSEAlgorithm.PS384]: {
    name: 'PS384',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-384',
    family: 'RSA-PSS',
  },
  [COSEAlgorithm.PS512]: {
    name: 'PS512',
    keyType: COSEKeyType.RSA,
    hash: 'SHA-512',
    family: 'RSA-PSS',
  },
};

/** Digest output size in bytes, which RSA-PSS needs as its salt length. */
const HASH_SIZE: Record<HashName, number> = { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };

export interface ParsedCOSEKey {
  /** COSE algorithm identifier, e.g. -7 for ES256. */
  alg: number;
  /** Human-readable algorithm name, e.g. `"ES256"`. */
  algName: string;
  /** Imported and validated public key, ready for `verifySignature`. */
  key: CryptoKey;
  /** For EC keys, the curve — `verifySignature` needs it to size the signature. */
  curve?: CurveName;
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

/**
 * Ed25519 is the one algorithm whose WebCrypto availability is uneven: some
 * older runtimes expose it only under the pre-standard `NODE-ED25519` name, and
 * a few edge runtimes lack it entirely. Probe once, on first use, and cache.
 *
 * It is not in the default `pubKeyCredParams`, so nothing reaches this unless a
 * site asked for EdDSA explicitly.
 */
let ed25519Name: 'Ed25519' | 'NODE-ED25519' | null | undefined;

async function resolveEd25519Name(): Promise<'Ed25519' | 'NODE-ED25519'> {
  if (ed25519Name === undefined) {
    ed25519Name = null;
    // A throwaway key with a known-good x coordinate: the base point.
    const probe = { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(new Uint8Array(32).fill(1)) };
    for (const candidate of ['Ed25519', 'NODE-ED25519'] as const) {
      try {
        await crypto.subtle.importKey(
          'jwk',
          probe as JsonWebKey,
          { name: candidate, namedCurve: candidate } as unknown as AlgorithmIdentifier,
          false,
          ['verify'],
        );
        ed25519Name = candidate;
        break;
      } catch {
        // Try the next name.
      }
    }
  }

  if (!ed25519Name) {
    throw new PasskeyError(
      'unsupported_algorithm',
      'this runtime cannot verify Ed25519 signatures. Remove -8 (EdDSA) from ' +
        '`supportedAlgorithms`, or run on a runtime whose WebCrypto implements it.',
    );
  }
  return ed25519Name;
}

/** True when this runtime can actually verify the given COSE algorithm. */
export async function canVerifyAlgorithm(alg: number): Promise<boolean> {
  const spec = ALGORITHMS[alg];
  if (!spec) return false;
  if (spec.family !== 'Ed25519') return true;
  try {
    await resolveEd25519Name();
    return true;
  } catch {
    return false;
  }
}

/** Parse a COSE_Key into a validated, imported public key. */
export async function parseCOSEPublicKey(coseBytes: Uint8Array): Promise<ParsedCOSEKey> {
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
  let importParams: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  let curve: CurveName | undefined;

  if (kty === COSEKeyType.EC2) {
    const crv = requireInt(map, COSEKeyTypeLabel.crv, 'curve (crv)');
    if (spec.curve !== undefined && crv !== spec.curve) {
      fail(`algorithm ${spec.name} requires curve ${spec.curve}, got ${crv}`);
    }
    const params = EC_CURVES[crv];
    if (!params) {
      throw new PasskeyError('unsupported_algorithm', `COSE curve ${crv} is not supported`);
    }
    const x = padCoordinate(
      requireBytes(map, COSEKeyTypeLabel.x, 'x coordinate'),
      params.coordinateSize,
      'x',
    );
    const y = padCoordinate(
      requireBytes(map, COSEKeyTypeLabel.y, 'y coordinate'),
      params.coordinateSize,
      'y',
    );
    curve = params.jwkCurve;
    jwk = { kty: 'EC', crv: params.jwkCurve, x: toBase64Url(x), y: toBase64Url(y) };
    importParams = { name: 'ECDSA', namedCurve: params.jwkCurve };
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
    const name = await resolveEd25519Name();
    importParams = { name, namedCurve: name } as unknown as AlgorithmIdentifier;
  } else if (kty === COSEKeyType.RSA) {
    const n = stripLeadingZeros(requireBytes(map, COSEKeyTypeLabel.n, 'modulus (n)'), 'modulus');
    const e = stripLeadingZeros(requireBytes(map, COSEKeyTypeLabel.e, 'exponent (e)'), 'exponent');
    if (n.length < 256) {
      fail(`RSA modulus is ${n.length * 8} bits; refusing anything below 2048`);
    }
    jwk = { kty: 'RSA', n: toBase64Url(n), e: toBase64Url(e) };
    // WebCrypto binds the hash to the key at import, so the key is imported per
    // algorithm rather than cached across them. A credential has exactly one
    // algorithm, so this costs nothing.
    importParams = { name: spec.family, hash: spec.hash as HashName };
  } else {
    throw new PasskeyError('unsupported_algorithm', `COSE key type ${kty} is not supported`);
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, importParams, false, ['verify']);
  } catch (cause) {
    fail('the public key was rejected as invalid', cause);
  }

  return { alg, algName: spec.name, key, ...(curve ? { curve } : {}) };
}

/**
 * Verify a WebAuthn signature.
 *
 * Returns a boolean rather than throwing: "did not verify" is an expected
 * outcome, not an exceptional one. Genuine problems (an unusable key) throw.
 */
export async function verifySignature(
  parsed: ParsedCOSEKey,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const spec = ALGORITHMS[parsed.alg];
  if (!spec) {
    throw new PasskeyError(
      'unsupported_algorithm',
      `COSE algorithm ${parsed.alg} is not supported`,
    );
  }

  let params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  let bytes = signature;

  switch (spec.family) {
    case 'ECDSA': {
      params = { name: 'ECDSA', hash: spec.hash as HashName };
      // Throws for a malformed signature — which is a failed verification, so
      // it is caught below rather than surfacing as a server fault.
      bytes = derToP1363(signature, parsed.curve ?? 'P-256');
      break;
    }
    case 'RSA-PSS':
      params = { name: 'RSA-PSS', saltLength: HASH_SIZE[spec.hash as HashName] };
      break;
    case 'Ed25519':
      params = { name: await resolveEd25519Name() };
      break;
    default:
      params = { name: 'RSASSA-PKCS1-v1_5' };
      break;
  }

  try {
    return await crypto.subtle.verify(
      params,
      parsed.key,
      bytes as unknown as BufferSource,
      data as unknown as BufferSource,
    );
  } catch {
    // A structurally invalid signature is a failed verification, not a fault.
    return false;
  }
}

/** Look up the printable name of a COSE algorithm, if we know it. */
export function algorithmName(alg: number): string | undefined {
  return ALGORITHMS[alg]?.name;
}

/** The digest a COSE algorithm signs with, or `undefined` for Ed25519. */
export function digestForAlgorithm(alg: number): HashName | undefined {
  const spec = ALGORITHMS[alg];
  if (!spec) {
    throw new PasskeyError('unsupported_algorithm', `COSE algorithm ${alg} is not supported`);
  }
  return spec.hash;
}

/** True when passkify knows how to verify signatures for this COSE algorithm. */
export function isSupportedAlgorithm(alg: number): boolean {
  return alg in ALGORITHMS;
}

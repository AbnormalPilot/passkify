/**
 * Attestation statement verification.
 *
 * A word on what this does and does not give you.
 *
 * Attestation answers "what kind of authenticator made this key?" It is
 * *optional* and, for consumer passkeys, usually absent by design: Apple,
 * Google and 1Password all return `fmt: "none"` with an all-zero AAGUID because
 * a per-model identifier is a tracking vector. So passkify verifies whatever
 * statement arrives — a bad one is a real signal — but never *requires* one,
 * and never fails a registration merely because attestation was absent.
 *
 * Deciding that a certificate chain belongs to a genuine YubiKey additionally
 * needs the FIDO Metadata Service, which is a live, signed, regularly-rotated
 * blob. passkify does not ship one. What it reports instead is honest:
 * `trusted` is true only if you supplied root certificates and the chain
 * actually validated against them. Enterprises that need real attestation
 * should pass `rootCertificates`; everyone else can ignore this file.
 */

import { X509Certificate, createHash, verify as nodeVerify, type KeyObject } from 'node:crypto';
import { PasskeyError } from '../../shared/errors.js';
import { concatBytes, bytesEqual, fromBase64Url } from '../../shared/base64url.js';
import { COSEAlgorithm } from '../../shared/types.js';
import { decodeMap, type CBORMap, type CBORValue } from './cbor.js';
import {
  parseCOSEPublicKey,
  verifySignature,
  digestForAlgorithm,
  rsaPssOptionsFor,
} from './cose.js';
import type { ParsedAuthenticatorData } from './authenticator-data.js';

/** How the authenticator vouched for the new key. */
export type AttestationType =
  /** No attestation was provided. Normal, and expected, for passkeys. */
  | 'none'
  /** The new credential key signed for itself. Proves nothing about hardware. */
  | 'self'
  /** A batch/manufacturer certificate signed the statement. */
  | 'basic'
  /** An attestation CA signed the statement. */
  | 'attca';

export interface AttestationResult {
  /** The `fmt` string from the attestation object. */
  format: string;
  type: AttestationType;
  /**
   * True only when a certificate chain validated against roots you supplied.
   * Without `rootCertificates` this is always false — see the note above.
   */
  trusted: boolean;
  /** The certificate chain as presented, if any. */
  certificateChain?: X509Certificate[];
  /** Human-readable subject of the leaf certificate, when present. */
  attestationCertificateSubject?: string;
}

export interface VerifyAttestationInput {
  format: string;
  statement: CBORMap;
  authenticatorData: ParsedAuthenticatorData;
  clientDataHash: Uint8Array;
  credentialPublicKey: Uint8Array;
  credentialId: Uint8Array;
  aaguid: Uint8Array;
  /** PEM or DER roots to validate a chain against. Empty means "cannot trust". */
  rootCertificates?: readonly (string | Uint8Array)[];
}

function fail(message: string, cause?: unknown): never {
  throw new PasskeyError('attestation_failed', message, { cause });
}

function getBytes(statement: CBORMap, key: string): Uint8Array {
  const value: CBORValue | undefined = statement.get(key);
  if (!(value instanceof Uint8Array)) {
    fail(`attestation statement is missing the "${key}" byte string`);
  }
  return value;
}

function getChain(statement: CBORMap): X509Certificate[] | undefined {
  const x5c = statement.get('x5c');
  if (x5c === undefined) {
    return undefined;
  }
  if (!Array.isArray(x5c) || x5c.length === 0) {
    fail('attestation statement has an empty or malformed "x5c"');
  }
  return x5c.map((entry, index) => {
    if (!(entry instanceof Uint8Array)) {
      fail(`x5c[${index}] is not a DER byte string`);
    }
    try {
      return new X509Certificate(entry);
    } catch (cause) {
      return fail(`x5c[${index}] is not a parseable X.509 certificate`, cause);
    }
  });
}

/** Reject certificates that are expired or not yet valid. */
function assertCertificateWindow(certificate: X509Certificate, label: string): void {
  const now = Date.now();
  const from = Date.parse(certificate.validFrom);
  const to = Date.parse(certificate.validTo);
  if (Number.isFinite(from) && now < from) {
    fail(`${label} is not valid until ${certificate.validFrom}`);
  }
  if (Number.isFinite(to) && now > to) {
    fail(`${label} expired on ${certificate.validTo}`);
  }
}

/** Verify a signature made by a certificate's public key, given a COSE alg. */
function verifyWithCertificate(
  certificate: X509Certificate,
  alg: number,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  const digest = digestForAlgorithm(alg);
  const pssOptions = rsaPssOptionsFor(alg);
  try {
    const key = certificate.publicKey as KeyObject;
    return nodeVerify(digest, data, pssOptions ? { key, ...pssOptions } : key, signature);
  } catch {
    return false;
  }
}

/**
 * Walk the presented chain and check it terminates at one of the supplied roots.
 * Returns false (rather than throwing) when no roots were supplied.
 */
function chainIsTrusted(
  chain: X509Certificate[],
  roots: readonly (string | Uint8Array)[] | undefined,
): boolean {
  if (!roots || roots.length === 0) {
    return false;
  }

  let rootCertificates: X509Certificate[];
  try {
    rootCertificates = roots.map((root) =>
      new X509Certificate(typeof root === 'string' ? root : Buffer.from(root)),
    );
  } catch (cause) {
    throw new PasskeyError('configuration_error', 'a supplied root certificate is unparseable', {
      cause,
    });
  }

  for (let i = 0; i < chain.length; i++) {
    const certificate = chain[i];
    assertCertificateWindow(certificate, `x5c[${i}]`);
    const issuer = chain[i + 1];
    if (issuer) {
      if (!certificate.checkIssued(issuer) || !certificate.verify(issuer.publicKey)) {
        fail(`x5c[${i}] was not issued by x5c[${i + 1}]`);
      }
    }
  }

  const top = chain[chain.length - 1];
  return rootCertificates.some(
    (root) =>
      bytesEqual(new Uint8Array(top.raw), new Uint8Array(root.raw)) ||
      (top.checkIssued(root) && top.verify(root.publicKey)),
  );
}

/** Rebuild the uncompressed EC point (0x04 || x || y) from a COSE key. */
function uncompressedECPoint(coseBytes: Uint8Array): Uint8Array {
  const map = decodeMap(coseBytes);
  const x = map.get(-2);
  const y = map.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    fail('fido-u2f requires an EC2 credential public key');
  }
  const pad = (value: Uint8Array): Uint8Array => {
    if (value.length === 32) return value;
    if (value.length > 32) fail('fido-u2f coordinates must be 32 bytes');
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  return concatBytes(new Uint8Array([0x04]), pad(x), pad(y));
}

/**
 * Verify the attestation statement attached to a registration.
 *
 * Throws `PasskeyError('attestation_failed')` if a statement is present but
 * internally inconsistent; returns a descriptive result otherwise.
 */
export function verifyAttestation(input: VerifyAttestationInput): AttestationResult {
  const { format, statement, authenticatorData, clientDataHash } = input;
  const signatureBase = concatBytes(authenticatorData.bytes, clientDataHash);

  switch (format) {
    case 'none': {
      if (statement.size > 0) {
        fail('attestation format is "none" but the statement is not empty');
      }
      return { format, type: 'none', trusted: false };
    }

    case 'packed': {
      const alg = statement.get('alg');
      if (typeof alg !== 'number') {
        fail('packed attestation is missing "alg"');
      }
      const signature = getBytes(statement, 'sig');
      const chain = getChain(statement);

      if (!chain) {
        // Self attestation: the freshly-minted credential key signs the
        // statement. It proves the response is internally consistent and
        // nothing more.
        const credentialKey = parseCOSEPublicKey(input.credentialPublicKey);
        if (credentialKey.alg !== alg) {
          fail('packed self-attestation alg does not match the credential public key');
        }
        if (!verifySignature(credentialKey, signatureBase, signature)) {
          fail('packed self-attestation signature did not verify');
        }
        return { format, type: 'self', trusted: false };
      }

      const leaf = chain[0];
      assertCertificateWindow(leaf, 'attestation certificate');
      if (leaf.ca) {
        fail('the attestation certificate is a CA certificate; it must not be');
      }
      if (!verifyWithCertificate(leaf, alg, signatureBase, signature)) {
        fail('packed attestation signature did not verify against the certificate');
      }

      return {
        format,
        type: 'basic',
        trusted: chainIsTrusted(chain, input.rootCertificates),
        certificateChain: chain,
        attestationCertificateSubject: leaf.subject,
      };
    }

    case 'fido-u2f': {
      const signature = getBytes(statement, 'sig');
      const chain = getChain(statement);
      if (!chain || chain.length !== 1) {
        fail('fido-u2f attestation requires exactly one certificate in x5c');
      }
      const leaf = chain[0];
      assertCertificateWindow(leaf, 'attestation certificate');

      // U2F predates authenticator data: the signed blob is assembled by hand.
      const verificationData = concatBytes(
        new Uint8Array([0x00]),
        authenticatorData.rpIdHash,
        clientDataHash,
        input.credentialId,
        uncompressedECPoint(input.credentialPublicKey),
      );

      if (!verifyWithCertificate(leaf, COSEAlgorithm.ES256, verificationData, signature)) {
        fail('fido-u2f attestation signature did not verify');
      }

      return {
        format,
        type: 'basic',
        trusted: chainIsTrusted(chain, input.rootCertificates),
        certificateChain: chain,
        attestationCertificateSubject: leaf.subject,
      };
    }

    case 'apple': {
      // Apple's anonymous attestation: the nonce in the leaf certificate must
      // equal SHA-256(authData || clientDataHash), and the certificate's public
      // key must be the credential's public key.
      const chain = getChain(statement);
      if (!chain || chain.length === 0) {
        fail('apple attestation requires an x5c chain');
      }
      const leaf = chain[0];
      assertCertificateWindow(leaf, 'attestation certificate');

      const expectedNonce = createHash('sha256').update(signatureBase).digest();
      // OID 1.2.840.113635.100.8.2, whose value is a SEQUENCE wrapping the
      // 32-byte nonce. Locate it by scanning the DER for the nonce itself.
      const raw = new Uint8Array(leaf.raw);
      if (indexOfBytes(raw, new Uint8Array(expectedNonce)) === -1) {
        fail('apple attestation nonce does not match the authenticator response');
      }

      const credentialKey = parseCOSEPublicKey(input.credentialPublicKey);
      const certificateJwk = (leaf.publicKey as KeyObject).export({ format: 'jwk' }) as {
        x?: string;
        y?: string;
      };
      const credentialJwk = credentialKey.key.export({ format: 'jwk' }) as {
        x?: string;
        y?: string;
      };
      if (
        !certificateJwk.x ||
        !credentialJwk.x ||
        !bytesEqual(fromBase64Url(certificateJwk.x), fromBase64Url(credentialJwk.x)) ||
        !certificateJwk.y ||
        !credentialJwk.y ||
        !bytesEqual(fromBase64Url(certificateJwk.y), fromBase64Url(credentialJwk.y))
      ) {
        fail('apple attestation certificate key does not match the credential public key');
      }

      return {
        format,
        type: 'attca',
        trusted: chainIsTrusted(chain, input.rootCertificates),
        certificateChain: chain,
        attestationCertificateSubject: leaf.subject,
      };
    }

    default:
      throw new PasskeyError(
        'unsupported_feature',
        `attestation format "${format}" is not implemented by passkify. ` +
          `Register with attestation: "none" (the default) unless you have a specific reason not to.`,
      );
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

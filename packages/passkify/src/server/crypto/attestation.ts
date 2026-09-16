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

import { crypto } from './provider.js';
import { PasskeyError } from '../../shared/errors.js';
import { concatBytes, bytesEqual } from '../../shared/base64url.js';
import { COSEAlgorithm } from '../../shared/types.js';
import type { AttestationConveyancePreferenceName } from '../../shared/types.js';
import { decodeMap, type CBORMap, type CBORValue } from './cbor.js';
import { parseCOSEPublicKey, verifySignature, digestForAlgorithm } from './cose.js';
import { Certificate, chainIsTrusted as verifyChain, OID } from './x509.js';
import { sha256 } from './digest.js';
import { derToP1363 } from './ecdsa-der.js';
import { readElement, readChildren, TAG } from './asn1.js';
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
  certificateChain?: Certificate[];
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
  /**
   * What the site asked for in `attestation`. When it is `'none'` — the default
   * — a format passkify cannot verify is *reported* rather than rejected: the
   * site never wanted a statement, and some authenticators (TPM-backed Windows
   * Hello, most visibly) send one regardless. Failing those registrations would
   * lock out real users over a statement nobody asked for.
   */
  requested?: AttestationConveyancePreferenceName;
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

function getChain(statement: CBORMap): Certificate[] | undefined {
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
      return Certificate.parse(entry);
    } catch (cause) {
      return fail(`x5c[${index}] is not a parseable X.509 certificate`, cause);
    }
  });
}

/** Reject certificates that are expired or not yet valid. */
function assertCertificateWindow(certificate: Certificate, label: string): void {
  const now = new Date();
  if (now < certificate.notBefore) {
    fail(`${label} is not valid until ${certificate.notBefore.toISOString()}`);
  }
  if (now > certificate.notAfter) {
    fail(`${label} expired on ${certificate.notAfter.toISOString()}`);
  }
}

/** Verify a signature made by a certificate's public key, given a COSE alg. */
async function verifyWithCertificate(
  certificate: Certificate,
  alg: number,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const hash = digestForAlgorithm(alg) ?? 'SHA-256';
  try {
    const key = await certificate.importPublicKey(hash);
    const isEC = certificate.publicKey.algorithm === 'EC';
    const params: AlgorithmIdentifier | EcdsaParams = isEC
      ? { name: 'ECDSA', hash }
      : { name: 'RSASSA-PKCS1-v1_5' };
    const bytes = isEC ? derToP1363(signature, certificate.publicKey.curve ?? 'P-256') : signature;
    return await crypto.subtle.verify(
      params,
      key,
      bytes as unknown as BufferSource,
      data as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}

/**
 * Walk the presented chain and check it terminates at one of the supplied roots.
 * Returns false (rather than throwing) when no roots were supplied — a chain
 * that validates against nothing proves nothing, and saying so is honest.
 */
async function chainIsTrusted(
  chain: Certificate[],
  roots: readonly (string | Uint8Array)[] | undefined,
): Promise<boolean> {
  if (!roots || roots.length === 0) {
    return false;
  }

  let rootCertificates: Certificate[];
  try {
    rootCertificates = roots.map((root) => Certificate.from(root));
  } catch (cause) {
    throw new PasskeyError('configuration_error', 'a supplied root certificate is unparseable', {
      cause,
    });
  }

  for (let i = 0; i < chain.length; i++) {
    assertCertificateWindow(chain[i], `x5c[${i}]`);
  }

  return verifyChain(chain, rootCertificates);
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
export async function verifyAttestation(input: VerifyAttestationInput): Promise<AttestationResult> {
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
        const credentialKey = await parseCOSEPublicKey(input.credentialPublicKey);
        if (credentialKey.alg !== alg) {
          fail('packed self-attestation alg does not match the credential public key');
        }
        if (!(await verifySignature(credentialKey, signatureBase, signature))) {
          fail('packed self-attestation signature did not verify');
        }
        return { format, type: 'self', trusted: false };
      }

      const leaf = chain[0];
      assertCertificateWindow(leaf, 'attestation certificate');
      if (leaf.basicConstraints.ca) {
        fail('the attestation certificate is a CA certificate; it must not be');
      }
      if (!(await verifyWithCertificate(leaf, alg, signatureBase, signature))) {
        fail('packed attestation signature did not verify against the certificate');
      }

      return {
        format,
        type: 'basic',
        trusted: await chainIsTrusted(chain, input.rootCertificates),
        certificateChain: chain,
        attestationCertificateSubject: leaf.subject,
      };
    }

    case 'fido-u2f': {
      const signature = getBytes(statement, 'sig');
      const chain = getChain(statement);
      if (chain?.length !== 1) {
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

      if (!(await verifyWithCertificate(leaf, COSEAlgorithm.ES256, verificationData, signature))) {
        fail('fido-u2f attestation signature did not verify');
      }

      return {
        format,
        type: 'basic',
        trusted: await chainIsTrusted(chain, input.rootCertificates),
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

      // OID 1.2.840.113635.100.8.2 carries a SEQUENCE wrapping a [1] tagged
      // OCTET STRING that holds SHA-256(authData ‖ clientDataHash). Earlier
      // versions scanned the whole certificate for those bytes; parsing the
      // extension is a materially stronger check, because a nonce appearing
      // anywhere in the DER is not the same as the authenticator asserting it.
      const expectedNonce = await sha256(signatureBase);
      const nonceExtension = leaf.extension(OID.APPLE_ANONYMOUS_ATTESTATION);
      if (!nonceExtension) {
        fail('apple attestation certificate has no nonce extension');
      }
      const nonceSequence = readElement(nonceExtension.value);
      const [tagged] = readChildren(nonceSequence);
      if (!tagged) fail('apple attestation nonce extension is empty');
      const nonceOctets = readElement(tagged.content);
      if (nonceOctets.tag !== TAG.OCTET_STRING) {
        fail('apple attestation nonce is not an OCTET STRING');
      }
      if (!bytesEqual(nonceOctets.content, expectedNonce)) {
        fail('apple attestation nonce does not match the authenticator response');
      }

      // The leaf's public key must be the credential's public key.
      const credentialPoint = uncompressedECPoint(input.credentialPublicKey);
      if (leaf.publicKey.algorithm !== 'EC') {
        fail('apple attestation certificate does not carry an EC public key');
      }
      // The SPKI ends with the uncompressed point, so comparing the tail is
      // equivalent to comparing x and y without re-exporting either key.
      const spki = leaf.publicKey.spki;
      const tail = spki.subarray(spki.length - credentialPoint.length);
      if (!bytesEqual(tail, credentialPoint)) {
        fail('apple attestation certificate key does not match the credential public key');
      }

      return {
        format,
        type: 'attca',
        trusted: await chainIsTrusted(chain, input.rootCertificates),
        certificateChain: chain,
        attestationCertificateSubject: leaf.subject,
      };
    }

    default: {
      // The site did not ask for attestation, so an unverifiable statement is
      // not a reason to refuse the credential. Report it honestly instead:
      // `format` carries what actually arrived, and `trusted` stays false.
      if ((input.requested ?? 'none') === 'none') {
        return { format, type: 'none', trusted: false };
      }
      throw new PasskeyError(
        'unsupported_feature',
        `attestation format "${format}" is not implemented by passkify. ` +
          `Register with attestation: "none" (the default) unless you have a specific reason not to.`,
      );
    }
  }
}

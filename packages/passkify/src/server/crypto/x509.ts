/**
 * X.509 certificates, parsed and verified without `node:crypto`.
 *
 * What this does: parse the fields attestation actually needs, verify one
 * certificate's signature against its issuer's public key, and walk a chain up
 * to a supplied root.
 *
 * What this deliberately does not do, on **any** runtime: full RFC 5280 path
 * validation. There are no name constraints, no policy mapping, and no CRL or
 * OCSP. That is worth stating plainly rather than implying otherwise, and it is
 * not a regression — `node:crypto`'s `X509Certificate.verify()` checks one
 * signature and is likewise not a path validator. In the FIDO ecosystem
 * authenticator revocation lives in Metadata Service status reports, not in
 * CRLs, which is what `passkify/mds` is for.
 */

import { crypto } from './provider.js';
import { PasskeyError } from '../../shared/errors.js';
import { fromBase64Url, toBase64Url, bytesEqual } from '../../shared/base64url.js';
import {
  TAG,
  readBitString,
  readChildren,
  readElement,
  readInteger,
  readOID,
  readTagged,
  readTime,
  type Element,
} from './asn1.js';
import { derToP1363, type CurveName } from './ecdsa-der.js';

/** Signature algorithm OIDs, mapped to what WebCrypto needs to check them. */
const SIGNATURE_ALGORITHMS: Record<
  string,
  { name: string; family: 'RSASSA-PKCS1-v1_5' | 'ECDSA' | 'Ed25519'; hash?: string }
> = {
  '1.2.840.113549.1.1.11': { name: 'sha256WithRSA', family: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  '1.2.840.113549.1.1.12': { name: 'sha384WithRSA', family: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
  '1.2.840.113549.1.1.13': { name: 'sha512WithRSA', family: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  '1.2.840.10045.4.3.2': { name: 'ecdsaWithSHA256', family: 'ECDSA', hash: 'SHA-256' },
  '1.2.840.10045.4.3.3': { name: 'ecdsaWithSHA384', family: 'ECDSA', hash: 'SHA-384' },
  '1.2.840.10045.4.3.4': { name: 'ecdsaWithSHA512', family: 'ECDSA', hash: 'SHA-512' },
  '1.3.101.112': { name: 'Ed25519', family: 'Ed25519' },
};

/** Public key algorithm OIDs found in a SubjectPublicKeyInfo. */
const KEY_ALGORITHMS = {
  RSA: '1.2.840.113549.1.1.1',
  EC: '1.2.840.10045.2.1',
  ED25519: '1.3.101.112',
} as const;

const EC_CURVE_OIDS: Record<string, CurveName> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
};

/** Attribute OIDs worth naming when rendering a distinguished name. */
const NAME_ATTRIBUTES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
};

export const OID = {
  BASIC_CONSTRAINTS: '2.5.29.19',
  KEY_USAGE: '2.5.29.15',
  EXTENDED_KEY_USAGE: '2.5.29.37',
  SUBJECT_ALT_NAME: '2.5.29.17',
  /** FIDO: the AAGUID, as asserted by a packed attestation certificate. */
  FIDO_AAGUID: '1.3.6.1.4.1.45724.1.1.4',
  /** Apple: SHA-256 of authenticatorData ‖ clientDataHash. */
  APPLE_ANONYMOUS_ATTESTATION: '1.2.840.113635.100.8.2',
  /** Android: the Keymaster/KeyMint attestation description. */
  ANDROID_KEY_ATTESTATION: '1.3.6.1.4.1.11129.2.1.17',
  /** TPM: the EK certificate's manufacturer/model/version SAN. */
  TCG_KP_AIK_CERTIFICATE: '2.23.133.8.3',
} as const;

function fail(message: string, cause?: unknown): never {
  throw new PasskeyError('parse_error', `certificate: ${message}`, { cause });
}

export interface CertificateExtension {
  oid: string;
  critical: boolean;
  /** The DER inside the extension's OCTET STRING wrapper. */
  value: Uint8Array;
}

export interface PublicKeyInfo {
  algorithm: 'RSA' | 'EC' | 'Ed25519';
  curve?: CurveName;
  /** The whole SubjectPublicKeyInfo, ready for `importKey('spki', …)`. */
  spki: Uint8Array;
}

interface CertificateFields {
  der: Uint8Array;
  tbs: Uint8Array;
  serialNumber: bigint;
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  issuer: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  version: number;
  publicKey: PublicKeyInfo;
  extensions: readonly CertificateExtension[];
  signatureAlgorithmOid: string;
  signature: Uint8Array;
}

export class Certificate {
  /** The DER as presented. */
  readonly der: Uint8Array;
  /** The signed portion — what a signature over this certificate covers. */
  readonly tbs: Uint8Array;
  readonly serialNumber: bigint;
  readonly issuerDer: Uint8Array;
  readonly subjectDer: Uint8Array;
  readonly issuer: string;
  readonly subject: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly version: number;
  readonly publicKey: PublicKeyInfo;
  readonly extensions: readonly CertificateExtension[];
  readonly signatureAlgorithmOid: string;
  readonly signature: Uint8Array;

  private constructor(fields: CertificateFields) {
    this.der = fields.der;
    this.tbs = fields.tbs;
    this.serialNumber = fields.serialNumber;
    this.issuerDer = fields.issuerDer;
    this.subjectDer = fields.subjectDer;
    this.issuer = fields.issuer;
    this.subject = fields.subject;
    this.notBefore = fields.notBefore;
    this.notAfter = fields.notAfter;
    this.version = fields.version;
    this.publicKey = fields.publicKey;
    this.extensions = fields.extensions;
    this.signatureAlgorithmOid = fields.signatureAlgorithmOid;
    this.signature = fields.signature;
  }

  static parse(der: Uint8Array): Certificate {
    const certificate = readTagged(der, TAG.SEQUENCE);
    const [tbsElement, signatureAlgorithmElement, signatureElement] = readChildren(certificate);
    if (!tbsElement || !signatureAlgorithmElement || !signatureElement) {
      fail('a Certificate needs tbsCertificate, signatureAlgorithm and signatureValue');
    }

    const tbsChildren = readChildren(tbsElement);
    let index = 0;

    // [0] EXPLICIT Version, optional and defaulting to v1.
    let version = 1;
    if (tbsChildren[0]?.tag === 0xa0) {
      const inner = readElement(tbsChildren[0].content);
      version = Number(readInteger(inner)) + 1;
      index = 1;
    }

    const serialNumber = readInteger(tbsChildren[index++]);
    index++; // inner signature algorithm, which must equal the outer one
    const issuerElement = tbsChildren[index++];
    const validityElement = tbsChildren[index++];
    const subjectElement = tbsChildren[index++];
    const spkiElement = tbsChildren[index++];

    if (!issuerElement || !validityElement || !subjectElement || !spkiElement) {
      fail('tbsCertificate is missing a required field');
    }

    const [notBeforeElement, notAfterElement] = readChildren(validityElement);
    if (!notBeforeElement || !notAfterElement) fail('validity needs notBefore and notAfter');

    // Extensions live in [3] EXPLICIT, after the optional unique identifiers.
    const extensions: CertificateExtension[] = [];
    for (const child of tbsChildren.slice(index)) {
      if (child.tag !== 0xa3) continue;
      const sequence = readElement(child.content);
      for (const extension of readChildren(sequence)) {
        const parts = readChildren(extension);
        const oid = readOID(parts[0]);
        const critical = parts.length === 3 ? parts[1].content[0] !== 0 : false;
        const value = parts[parts.length - 1];
        if (value.tag !== TAG.OCTET_STRING)
          fail(`extension ${oid} is not wrapped in an OCTET STRING`);
        extensions.push({ oid, critical, value: value.content });
      }
    }

    const outerAlgorithm = readOID(readChildren(signatureAlgorithmElement)[0]);

    return new Certificate({
      der,
      tbs: tbsElement.raw,
      serialNumber,
      issuerDer: issuerElement.raw,
      subjectDer: subjectElement.raw,
      issuer: renderName(issuerElement),
      subject: renderName(subjectElement),
      notBefore: readTime(notBeforeElement),
      notAfter: readTime(notAfterElement),
      version,
      publicKey: readPublicKeyInfo(spkiElement),
      extensions,
      signatureAlgorithmOid: outerAlgorithm,
      signature: readBitString(signatureElement),
    });
  }

  /** Accepts PEM (with or without headers) or raw DER. */
  static from(input: string | Uint8Array): Certificate {
    if (typeof input !== 'string') return Certificate.parse(input);
    const body = input
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
    if (body.length === 0) fail('empty PEM input');
    return Certificate.parse(fromBase64Url(body));
  }

  extension(oid: string): CertificateExtension | undefined {
    return this.extensions.find((extension) => extension.oid === oid);
  }

  /** True when the certificate is valid at `at`, which defaults to now. */
  isValidAt(at: Date = new Date()): boolean {
    return at >= this.notBefore && at <= this.notAfter;
  }

  /** The basicConstraints CA flag, and the path length if one is present. */
  get basicConstraints(): { ca: boolean; pathLength?: number } {
    const extension = this.extension(OID.BASIC_CONSTRAINTS);
    if (!extension) return { ca: false };
    const sequence = readElement(extension.value);
    const children = readChildren(sequence);
    const ca = children[0]?.tag === TAG.BOOLEAN ? children[0].content[0] !== 0 : false;
    const pathElement = children.find((child) => child.tag === TAG.INTEGER);
    return pathElement ? { ca, pathLength: Number(readInteger(pathElement)) } : { ca };
  }

  /** True when `issuer` names this certificate's issuer. Byte comparison of the DER. */
  isIssuedBy(issuer: Certificate): boolean {
    return bytesEqual(this.issuerDer, issuer.subjectDer);
  }

  /** Import this certificate's public key for signature verification. */
  async importPublicKey(hash?: string): Promise<CryptoKey> {
    const { algorithm, curve, spki } = this.publicKey;
    const params: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams =
      algorithm === 'EC'
        ? { name: 'ECDSA', namedCurve: curve ?? 'P-256' }
        : algorithm === 'Ed25519'
          ? ({ name: 'Ed25519' } as AlgorithmIdentifier)
          : { name: 'RSASSA-PKCS1-v1_5', hash: hash ?? 'SHA-256' };

    try {
      return await crypto.subtle.importKey('spki', spki as unknown as BufferSource, params, false, [
        'verify',
      ]);
    } catch (cause) {
      fail(`the public key of "${this.subject}" could not be imported`, cause);
    }
  }

  /**
   * Verify this certificate's signature against `issuer`'s public key.
   *
   * Returns false rather than throwing: an invalid signature is an expected
   * outcome when walking a chain.
   */
  async verifySignatureBy(issuer: Certificate): Promise<boolean> {
    const spec = SIGNATURE_ALGORITHMS[this.signatureAlgorithmOid];
    if (!spec) {
      throw new PasskeyError(
        'unsupported_feature',
        `certificate signature algorithm ${this.signatureAlgorithmOid} is not supported`,
      );
    }

    try {
      const key = await issuer.importPublicKey(spec.hash);
      let signature = this.signature;
      let params: AlgorithmIdentifier | EcdsaParams;

      if (spec.family === 'ECDSA') {
        params = { name: 'ECDSA', hash: spec.hash as string };
        signature = derToP1363(this.signature, issuer.publicKey.curve ?? 'P-256');
      } else if (spec.family === 'Ed25519') {
        params = { name: 'Ed25519' };
      } else {
        params = { name: 'RSASSA-PKCS1-v1_5' };
      }

      return await crypto.subtle.verify(
        params,
        key,
        signature as unknown as BufferSource,
        this.tbs as unknown as BufferSource,
      );
    } catch {
      return false;
    }
  }

  toString(): string {
    return this.subject;
  }
}

function renderName(element: Element): string {
  const parts: string[] = [];
  for (const rdn of readChildren(element)) {
    for (const attribute of readChildren(rdn)) {
      const [oidElement, valueElement] = readChildren(attribute);
      if (!oidElement || !valueElement) continue;
      const oid = readOID(oidElement);
      const label = NAME_ATTRIBUTES[oid] ?? oid;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(valueElement.content);
      } catch {
        text = toBase64Url(valueElement.content);
      }
      parts.push(`${label}=${text}`);
    }
  }
  return parts.join(', ');
}

function readPublicKeyInfo(element: Element): PublicKeyInfo {
  const [algorithmElement] = readChildren(element);
  const algorithmParts = readChildren(algorithmElement);
  const oid = readOID(algorithmParts[0]);

  if (oid === KEY_ALGORITHMS.EC) {
    const curveOid = algorithmParts[1] ? readOID(algorithmParts[1]) : undefined;
    const curve = curveOid ? EC_CURVE_OIDS[curveOid] : undefined;
    if (!curve) {
      throw new PasskeyError(
        'unsupported_feature',
        `certificate uses EC curve ${curveOid ?? 'unknown'}, which is not supported`,
      );
    }
    return { algorithm: 'EC', curve, spki: element.raw };
  }
  if (oid === KEY_ALGORITHMS.RSA) return { algorithm: 'RSA', spki: element.raw };
  if (oid === KEY_ALGORITHMS.ED25519) return { algorithm: 'Ed25519', spki: element.raw };

  throw new PasskeyError(
    'unsupported_feature',
    `certificate public key algorithm ${oid} is not supported`,
  );
}

/**
 * Walk `chain` (leaf first) and decide whether it terminates at one of `roots`.
 *
 * Without roots this is always false, and honestly so: a chain that validates
 * against nothing proves nothing. See the note at the top of the file for what
 * this checks and what it does not.
 */
export async function chainIsTrusted(
  chain: readonly Certificate[],
  roots: readonly Certificate[],
  at: Date = new Date(),
): Promise<boolean> {
  if (chain.length === 0 || roots.length === 0) return false;

  for (const certificate of chain) {
    if (!certificate.isValidAt(at)) return false;
  }

  // Each link must be signed by the next one along.
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i];
    const parent = chain[i + 1];
    if (!child.isIssuedBy(parent)) return false;
    if (!parent.basicConstraints.ca) return false;
    if (!(await child.verifySignatureBy(parent))) return false;
  }

  const top = chain[chain.length - 1];

  for (const root of roots) {
    // The chain may already include the root, or stop just below it.
    if (bytesEqual(top.der, root.der)) return true;
    if (!root.isValidAt(at)) continue;
    if (top.isIssuedBy(root) && (await top.verifySignatureBy(root))) return true;
  }

  return false;
}

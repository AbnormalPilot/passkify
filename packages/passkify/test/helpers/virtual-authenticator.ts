/**
 * A software authenticator for tests.
 *
 * It assembles authenticator data byte by byte from the WebAuthn spec's field
 * layout and signs with real keys from `node:crypto`, so it exercises the
 * verifier the same way a Touch ID sensor or a YubiKey would — including the
 * ways it can be made to misbehave, which is most of what the tests check.
 */

import { createHash, createSign, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { encodeCBOR, type Encodable } from './cbor-encode.ts';

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url');

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const FLAG = {
  UP: 0x01,
  UV: 0x04,
  BE: 0x08,
  BS: 0x10,
  AT: 0x40,
  ED: 0x80,
} as const;

export type SupportedAlgorithm = 'ES256' | 'RS256' | 'EdDSA';

export interface AuthenticatorOptions {
  rpId: string;
  algorithm?: SupportedAlgorithm;
  aaguid?: Uint8Array;
  /** Emulate a syncing passkey (BE+BS) versus a hardware key. */
  backupEligible?: boolean;
  backedUp?: boolean;
}

export interface CreateOptions {
  challenge: string;
  origin: string;
  userVerified?: boolean;
  signCount?: number;
  /** Corrupt the response in a specific way, to check the verifier notices. */
  tamper?: {
    rpId?: string;
    flags?: (flags: number) => number;
    clientDataType?: string;
    challenge?: string;
    origin?: string;
    crossOrigin?: boolean;
  };
  /** `'none'` (default) or `'packed'` self-attestation. */
  attestation?: 'none' | 'packed';
}

export interface AssertOptions {
  challenge: string;
  origin: string;
  userVerified?: boolean;
  signCount?: number;
  userHandle?: string | null;
  tamper?: {
    rpId?: string;
    flags?: (flags: number) => number;
    clientDataType?: string;
    signature?: Uint8Array;
    origin?: string;
    crossOrigin?: boolean;
  };
}

export class VirtualAuthenticator {
  readonly rpId: string;
  readonly algorithm: SupportedAlgorithm;
  readonly aaguid: Uint8Array;
  readonly credentialId: Uint8Array;

  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly backupEligible: boolean;
  private readonly backedUp: boolean;
  private counter = 0;

  constructor(options: AuthenticatorOptions) {
    this.rpId = options.rpId;
    this.algorithm = options.algorithm ?? 'ES256';
    this.aaguid = options.aaguid ?? new Uint8Array(16);
    this.backupEligible = options.backupEligible ?? true;
    this.backedUp = options.backedUp ?? true;
    this.credentialId = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));

    const pair =
      this.algorithm === 'ES256'
        ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
        : this.algorithm === 'RS256'
          ? generateKeyPairSync('rsa', { modulusLength: 2048 })
          : generateKeyPairSync('ed25519');

    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  /** The credential's COSE_Key, as the authenticator would emit it. */
  coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: 'jwk' }) as Record<string, string>;
    const fromB64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64url'));

    if (this.algorithm === 'ES256') {
      return encodeCBOR(
        new Map<string | number, Encodable>([
          [1, 2], // kty: EC2
          [3, -7], // alg: ES256
          [-1, 1], // crv: P-256
          [-2, fromB64(jwk.x)],
          [-3, fromB64(jwk.y)],
        ]),
      );
    }
    if (this.algorithm === 'RS256') {
      return encodeCBOR(
        new Map<string | number, Encodable>([
          [1, 3], // kty: RSA
          [3, -257], // alg: RS256
          [-1, fromB64(jwk.n)],
          [-2, fromB64(jwk.e)],
        ]),
      );
    }
    return encodeCBOR(
      new Map<string | number, Encodable>([
        [1, 1], // kty: OKP
        [3, -8], // alg: EdDSA
        [-1, 6], // crv: Ed25519
        [-2, fromB64(jwk.x)],
      ]),
    );
  }

  private clientDataJSON(
    type: string,
    challenge: string,
    origin: string,
    crossOrigin = false,
  ): Uint8Array {
    return utf8(JSON.stringify({ type, challenge, origin, crossOrigin }));
  }

  private buildAuthData(options: {
    rpId: string;
    flags: number;
    signCount: number;
    attested?: boolean;
  }): Uint8Array {
    const rpIdHash = new Uint8Array(createHash('sha256').update(options.rpId).digest());
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, options.signCount, false);

    const base = concat(rpIdHash, new Uint8Array([options.flags]), counter);
    if (!options.attested) {
      return base;
    }

    const idLength = new Uint8Array(2);
    new DataView(idLength.buffer).setUint16(0, this.credentialId.length, false);
    return concat(base, this.aaguid, idLength, this.credentialId, this.coseKey());
  }

  private sign(data: Uint8Array): Uint8Array {
    if (this.algorithm === 'EdDSA') {
      return new Uint8Array(nodeSign(null, data, this.privateKey));
    }
    const signer = createSign('sha256');
    signer.update(data);
    return new Uint8Array(signer.sign(this.privateKey));
  }

  /** Produce a registration response, as `navigator.credentials.create()` would. */
  create(options: CreateOptions) {
    const tamper = options.tamper ?? {};
    let flags: number = FLAG.UP | FLAG.AT;
    if (options.userVerified ?? true) flags |= FLAG.UV;
    if (this.backupEligible) flags |= FLAG.BE;
    if (this.backedUp) flags |= FLAG.BS;
    if (tamper.flags) flags = tamper.flags(flags);

    this.counter = options.signCount ?? 0;

    const authData = this.buildAuthData({
      rpId: tamper.rpId ?? this.rpId,
      flags,
      signCount: this.counter,
      attested: true,
    });

    const clientDataJSON = this.clientDataJSON(
      tamper.clientDataType ?? 'webauthn.create',
      tamper.challenge ?? options.challenge,
      tamper.origin ?? options.origin,
      tamper.crossOrigin ?? false,
    );

    let attestationObject: Uint8Array;
    if (options.attestation === 'packed') {
      const clientDataHash = new Uint8Array(
        createHash('sha256').update(clientDataJSON).digest(),
      );
      const signature = this.sign(concat(authData, clientDataHash));
      attestationObject = encodeCBOR(
        new Map<string | number, Encodable>([
          ['fmt', 'packed'],
          [
            'attStmt',
            new Map<string | number, Encodable>([
              ['alg', this.algorithm === 'ES256' ? -7 : this.algorithm === 'RS256' ? -257 : -8],
              ['sig', signature],
            ]),
          ],
          ['authData', authData],
        ]),
      );
    } else {
      attestationObject = encodeCBOR(
        new Map<string | number, Encodable>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
    }

    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal' as const, 'hybrid' as const],
      },
    };
  }

  /** Produce an authentication response, as `navigator.credentials.get()` would. */
  assert(options: AssertOptions) {
    const tamper = options.tamper ?? {};
    let flags: number = FLAG.UP;
    if (options.userVerified ?? true) flags |= FLAG.UV;
    if (this.backupEligible) flags |= FLAG.BE;
    if (this.backedUp) flags |= FLAG.BS;
    if (tamper.flags) flags = tamper.flags(flags);

    const signCount = options.signCount ?? ++this.counter;

    const authData = this.buildAuthData({
      rpId: tamper.rpId ?? this.rpId,
      flags,
      signCount,
    });

    const clientDataJSON = this.clientDataJSON(
      tamper.clientDataType ?? 'webauthn.get',
      options.challenge,
      tamper.origin ?? options.origin,
      tamper.crossOrigin ?? false,
    );

    const clientDataHash = new Uint8Array(createHash('sha256').update(clientDataJSON).digest());
    const signature = tamper.signature ?? this.sign(concat(authData, clientDataHash));

    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle:
          options.userHandle === null
            ? null
            : options.userHandle
              ? b64url(utf8(options.userHandle))
              : null,
      },
    };
  }
}

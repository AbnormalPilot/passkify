/**
 * Parser for the `authenticatorData` byte string
 * (https://w3c.github.io/webauthn/#sctn-authenticator-data).
 *
 * Layout:
 *   32  rpIdHash
 *    1  flags
 *    4  signCount (big-endian)
 *   -- if the AT flag is set (attested credential data) --
 *   16  aaguid
 *    2  credentialIdLength (big-endian)
 *    L  credentialId
 *    ?  credentialPublicKey  (CBOR, self-delimiting)
 *   -- if the ED flag is set --
 *    ?  extensions (CBOR map)
 */

import { PasskeyError } from '../../shared/errors.js';
import { decodeFirst, type CBORMap } from './cbor.js';

export interface AuthenticatorDataFlags {
  /** User Present — someone physically touched the authenticator. */
  userPresent: boolean;
  /** User Verified — a PIN/biometric was checked, not just presence. */
  userVerified: boolean;
  /** Backup Eligible — this credential may sync between devices. */
  backupEligible: boolean;
  /** Backup State — this credential is currently backed up / synced. */
  backedUp: boolean;
  /** Attested credential data is present (set during registration). */
  attestedCredentialData: boolean;
  /** Extension data is present. */
  extensionData: boolean;
}

export interface AttestedCredentialData {
  /** Authenticator model identifier; all-zero for most privacy-preserving passkeys. */
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  /** The raw COSE_Key bytes — this is what gets stored and re-parsed at login. */
  credentialPublicKey: Uint8Array;
}

export interface ParsedAuthenticatorData {
  /** SHA-256 of the Relying Party ID the authenticator signed for. */
  rpIdHash: Uint8Array;
  flags: AuthenticatorDataFlags;
  rawFlags: number;
  signCount: number;
  attestedCredentialData?: AttestedCredentialData;
  extensions?: CBORMap;
  /** The exact bytes that were parsed — needed when building the signature base. */
  bytes: Uint8Array;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

/** Maximum credential ID length permitted by the WebAuthn spec. */
const MAX_CREDENTIAL_ID_LENGTH = 1023;

function fail(message: string): never {
  throw new PasskeyError('parse_error', `authenticator data: ${message}`);
}

export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  if (bytes.length < 37) {
    fail(`expected at least 37 bytes, got ${bytes.length}`);
  }

  const rpIdHash = bytes.subarray(0, 32);
  const rawFlags = bytes[32];
  const signCount =
    ((bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36]) >>> 0;

  const flags: AuthenticatorDataFlags = {
    userPresent: (rawFlags & FLAG_UP) !== 0,
    userVerified: (rawFlags & FLAG_UV) !== 0,
    backupEligible: (rawFlags & FLAG_BE) !== 0,
    backedUp: (rawFlags & FLAG_BS) !== 0,
    attestedCredentialData: (rawFlags & FLAG_AT) !== 0,
    extensionData: (rawFlags & FLAG_ED) !== 0,
  };

  // A credential cannot be backed up unless it is eligible for backup. The spec
  // calls this combination invalid, and it is cheap to catch here.
  if (flags.backedUp && !flags.backupEligible) {
    fail('the backup-state flag is set without the backup-eligible flag');
  }

  let offset = 37;
  let attestedCredentialData: AttestedCredentialData | undefined;

  if (flags.attestedCredentialData) {
    if (bytes.length < offset + 18) {
      fail('truncated attested credential data');
    }
    const aaguid = bytes.subarray(offset, offset + 16);
    offset += 16;

    const credentialIdLength = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    if (credentialIdLength === 0 || credentialIdLength > MAX_CREDENTIAL_ID_LENGTH) {
      fail(`credential ID length ${credentialIdLength} is out of range`);
    }
    if (bytes.length < offset + credentialIdLength) {
      fail('truncated credential ID');
    }
    const credentialId = bytes.subarray(offset, offset + credentialIdLength);
    offset += credentialIdLength;

    // The COSE key is self-delimiting; parsing it tells us where it ends, which
    // is the only way to find the start of any extension data that follows.
    const { bytesRead } = decodeFirst(bytes.subarray(offset));
    const credentialPublicKey = bytes.subarray(offset, offset + bytesRead);
    offset += bytesRead;

    attestedCredentialData = {
      aaguid: new Uint8Array(aaguid),
      credentialId: new Uint8Array(credentialId),
      credentialPublicKey: new Uint8Array(credentialPublicKey),
    };
  }

  let extensions: CBORMap | undefined;
  if (flags.extensionData) {
    const { value, bytesRead } = decodeFirst(bytes.subarray(offset));
    if (!(value instanceof Map)) {
      fail('extension data is not a CBOR map');
    }
    extensions = value;
    offset += bytesRead;
  }

  if (offset !== bytes.length) {
    fail(`${bytes.length - offset} unexpected trailing byte(s)`);
  }

  return {
    rpIdHash: new Uint8Array(rpIdHash),
    flags,
    rawFlags,
    signCount,
    attestedCredentialData,
    extensions,
    bytes,
  };
}

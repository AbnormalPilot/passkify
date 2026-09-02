/**
 * Wire types shared by the browser client and the Node server.
 *
 * Everything here is plain JSON: `ArrayBuffer` fields from the WebAuthn spec
 * are represented as base64url strings so options and responses can travel
 * over `fetch` untouched. The client converts them at the last moment, right
 * before calling `navigator.credentials`.
 */

/** A base64url-encoded byte string. */
export type Base64URLString = string;

export type AuthenticatorTransportName =
  | 'usb'
  | 'nfc'
  | 'ble'
  | 'smart-card'
  | 'hybrid'
  | 'internal'
  | 'cable';

export type UserVerificationRequirementName = 'required' | 'preferred' | 'discouraged';

export type ResidentKeyRequirementName = 'required' | 'preferred' | 'discouraged';

export type AttachmentName = 'platform' | 'cross-platform';

export type AttestationConveyancePreferenceName =
  | 'none'
  | 'indirect'
  | 'direct'
  | 'enterprise';

export interface PublicKeyCredentialDescriptorJSON {
  id: Base64URLString;
  type: 'public-key';
  transports?: AuthenticatorTransportName[];
}

export interface AuthenticatorSelectionJSON {
  authenticatorAttachment?: AttachmentName;
  residentKey?: ResidentKeyRequirementName;
  requireResidentKey?: boolean;
  userVerification?: UserVerificationRequirementName;
}

/** What the server hands the browser to start a registration. */
export interface RegistrationOptionsJSON {
  rp: { id: string; name: string };
  user: { id: Base64URLString; name: string; displayName: string };
  challenge: Base64URLString;
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionJSON;
  attestation?: AttestationConveyancePreferenceName;
  extensions?: Record<string, unknown>;
  hints?: string[];
}

/** What the server hands the browser to start a login. */
export interface AuthenticationOptionsJSON {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirementName;
  extensions?: Record<string, unknown>;
  hints?: string[];
}

/** The browser's answer to a registration ceremony, JSON-ready. */
export interface RegistrationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  type: 'public-key';
  authenticatorAttachment?: AttachmentName | null;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: Base64URLString;
    attestationObject: Base64URLString;
    transports?: AuthenticatorTransportName[];
    publicKeyAlgorithm?: number;
    publicKey?: Base64URLString;
    authenticatorData?: Base64URLString;
  };
}

/** The browser's answer to a login ceremony, JSON-ready. */
export interface AuthenticationResponseJSON {
  id: Base64URLString;
  rawId: Base64URLString;
  type: 'public-key';
  authenticatorAttachment?: AttachmentName | null;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString | null;
  };
}

/** Parsed `clientDataJSON`. */
export interface ClientData {
  type: string;
  challenge: Base64URLString;
  origin: string;
  crossOrigin?: boolean;
  topOrigin?: string;
  tokenBinding?: { status: string; id?: string };
}

/** COSE algorithm identifiers this library can verify. */
export const COSEAlgorithm = {
  EdDSA: -8,
  ES256: -7,
  ES384: -35,
  ES512: -36,
  PS256: -37,
  PS384: -38,
  PS512: -39,
  RS256: -257,
  RS384: -258,
  RS512: -259,
  RS1: -65535,
} as const;

export type COSEAlgorithmIdentifier = (typeof COSEAlgorithm)[keyof typeof COSEAlgorithm];

/**
 * Algorithms offered to authenticators by default, best first.
 *
 * ES256 covers essentially every passkey provider in existence; RS256 is there
 * for older Windows Hello / TPM-backed keys. Both are mandatory-to-implement
 * in the WebAuthn spec, so this list is deliberately short — a shorter list
 * means fewer code paths that must be right.
 */
export const DEFAULT_PUB_KEY_CRED_PARAMS: Array<{ type: 'public-key'; alg: number }> = [
  { type: 'public-key', alg: COSEAlgorithm.ES256 },
  { type: 'public-key', alg: COSEAlgorithm.RS256 },
];

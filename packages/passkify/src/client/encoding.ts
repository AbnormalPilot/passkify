/**
 * JSON to WebAuthn and back.
 *
 * Every `ArrayBuffer` in the WebAuthn API has to become a base64url string to
 * survive `JSON.stringify`, and decode again on the way in. Getting one field
 * wrong produces a `NotAllowedError` that points nowhere near the mistake, so
 * this is the single place it happens.
 *
 * Newer browsers do the conversion themselves via
 * `PublicKeyCredential.parseCreationOptionsFromJSON` and `credential.toJSON()`.
 * Those paths are preferred where available: they keep up with spec additions
 * this file has not been taught about. The manual conversion below is the
 * fallback.
 */

import { toBase64Url, fromBase64Url } from '../shared/base64url.js';
import type {
  RegistrationOptionsJSON,
  AuthenticationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialDescriptorJSON,
} from '../shared/types.js';

function toBuffer(value: string): ArrayBuffer {
  const bytes = fromBase64Url(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toDescriptors(
  list: PublicKeyCredentialDescriptorJSON[] | undefined,
): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((descriptor) => ({
    id: toBuffer(descriptor.id),
    type: 'public-key' as const,
    ...(descriptor.transports
      ? { transports: descriptor.transports as AuthenticatorTransport[] }
      : {}),
  }));
}

export function toCreationOptions(
  options: RegistrationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  const native = window.PublicKeyCredential as unknown as {
    parseCreationOptionsFromJSON?: (o: unknown) => PublicKeyCredentialCreationOptions;
  };
  if (typeof native.parseCreationOptionsFromJSON === 'function') {
    try {
      return native.parseCreationOptionsFromJSON(options);
    } catch {
      // Fall through to the manual path.
    }
  }

  return {
    rp: options.rp,
    user: {
      id: toBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    challenge: toBuffer(options.challenge),
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    excludeCredentials: toDescriptors(options.excludeCredentials),
    authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria,
    attestation: options.attestation as AttestationConveyancePreference,
    extensions: options.extensions as AuthenticationExtensionsClientInputs,
  };
}

export function toRequestOptions(
  options: AuthenticationOptionsJSON,
): PublicKeyCredentialRequestOptions {
  const native = window.PublicKeyCredential as unknown as {
    parseRequestOptionsFromJSON?: (o: unknown) => PublicKeyCredentialRequestOptions;
  };
  if (typeof native.parseRequestOptionsFromJSON === 'function') {
    try {
      return native.parseRequestOptionsFromJSON(options);
    } catch {
      // Fall through.
    }
  }

  return {
    challenge: toBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials: toDescriptors(options.allowCredentials),
    userVerification: options.userVerification as UserVerificationRequirement,
    extensions: options.extensions as AuthenticationExtensionsClientInputs,
  };
}

export function serializeRegistration(credential: PublicKeyCredential): RegistrationResponseJSON {
  const native = credential as unknown as { toJSON?: () => RegistrationResponseJSON };
  if (typeof native.toJSON === 'function') {
    return native.toJSON();
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    authenticatorAttachment:
      (credential.authenticatorAttachment as 'platform' | 'cross-platform' | null) ?? null,
    clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      attestationObject: toBase64Url(new Uint8Array(response.attestationObject)),
      ...(typeof response.getTransports === 'function'
        ? {
            transports:
              response.getTransports() as RegistrationResponseJSON['response']['transports'],
          }
        : {}),
    },
  };
}

export function serializeAuthentication(
  credential: PublicKeyCredential,
): AuthenticationResponseJSON {
  const native = credential as unknown as { toJSON?: () => AuthenticationResponseJSON };
  if (typeof native.toJSON === 'function') {
    return native.toJSON();
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    authenticatorAttachment:
      (credential.authenticatorAttachment as 'platform' | 'cross-platform' | null) ?? null,
    clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle ? toBase64Url(new Uint8Array(response.userHandle)) : null,
    },
  };
}

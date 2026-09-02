/**
 * The registration ceremony: issuing options, then verifying what comes back.
 *
 * The verification steps below follow §7.1 of the WebAuthn spec in order.
 * Steps the spec marks optional, or that only apply to features passkify does
 * not expose, are noted where they are skipped rather than silently omitted.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PasskeyError } from '../shared/errors.js';
import { toBase64Url, fromBase64Url, utf8ToBytes, bytesEqual } from '../shared/base64url.js';
import type {
  RegistrationOptionsJSON,
  RegistrationResponseJSON,
  UserVerificationRequirementName,
  AuthenticatorTransportName,
} from '../shared/types.js';
import type { ResolvedConfig } from './config.js';
import type { PasskeyCredential, PasskeyUser } from './store.js';
import { decodeMap } from './crypto/cbor.js';
import { parseAuthenticatorData } from './crypto/authenticator-data.js';
import { parseClientData, originAllowed, challengeMatches } from './crypto/client-data.js';
import { parseCOSEPublicKey, algorithmName } from './crypto/cose.js';
import { verifyAttestation, type AttestationResult } from './crypto/attestation.js';

/** WebAuthn caps the user handle at 64 bytes. */
const MAX_USER_HANDLE_BYTES = 64;

export interface StartRegistrationInput {
  /**
   * The username for a **new** account.
   *
   * If the username already exists this throws `credential_exists`. Adding a
   * second passkey to an existing account must go through `userId` instead,
   * from an authenticated session — otherwise anyone who knows a username
   * could attach their own passkey to it and take the account over.
   */
  username?: string;

  /** Shown in the OS passkey picker. Defaults to `username`. */
  displayName?: string;

  /**
   * An existing account's ID, taken from the caller's **authenticated session**.
   * Use this to let a signed-in user add another device.
   */
  userId?: string;

  /** Override the configured user verification requirement for this ceremony. */
  userVerification?: UserVerificationRequirementName;
}

export interface StartRegistrationResult {
  options: RegistrationOptionsJSON;
  /** The user handle these options were issued for. */
  userId: string;
  /** True when a fresh account will be created if the ceremony completes. */
  isNewUser: boolean;
}

export async function createRegistrationOptions(
  config: ResolvedConfig,
  input: StartRegistrationInput,
): Promise<StartRegistrationResult> {
  let user: PasskeyUser | null = null;
  let isNewUser = false;

  if (input.userId) {
    user = await config.store.getUserById(input.userId);
    if (!user) {
      throw new PasskeyError('unknown_user', `no account with id "${input.userId}"`);
    }
  } else {
    const username = input.username?.trim();
    if (!username) {
      throw new PasskeyError(
        'malformed_response',
        'a username is required to register a new account',
      );
    }
    const existing = await config.store.getUserByUsername(username);
    if (existing) {
      throw new PasskeyError(
        'credential_exists',
        `"${username}" already has an account. To add another passkey to it, sign in first ` +
          `and start registration with { userId } from the session.`,
      );
    }
    // The account is not created yet — an abandoned prompt should not leave a
    // half-registered user behind. The handle is minted now because the
    // authenticator is about to store it.
    isNewUser = true;
    user = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || username,
    };
  }

  const userHandle = utf8ToBytes(user.id);
  if (userHandle.length > MAX_USER_HANDLE_BYTES) {
    throw new PasskeyError(
      'configuration_error',
      `user id "${user.id}" is ${userHandle.length} bytes; WebAuthn allows at most ` +
        `${MAX_USER_HANDLE_BYTES}. Use a UUID or another short opaque identifier.`,
    );
  }

  // Tell the authenticator which credentials it already holds for this account,
  // so it can refuse to create a duplicate instead of silently making a second.
  const existingCredentials = isNewUser
    ? []
    : await config.store.listCredentialsByUserId(user.id);

  const challenge = toBase64Url(randomBytes(config.challengeSize));
  const userVerification = input.userVerification ?? config.userVerification;

  await config.store.saveChallenge({
    challenge,
    kind: 'registration',
    userId: user.id,
    expiresAt: new Date(Date.now() + config.challengeTimeout),
    context: {
      username: user.username,
      displayName: user.displayName,
      isNewUser,
      userVerification,
    },
  });

  const options: RegistrationOptionsJSON = {
    rp: { id: config.rpID, name: config.rpName },
    user: {
      id: toBase64Url(userHandle),
      name: user.username,
      displayName: user.displayName,
    },
    challenge,
    pubKeyCredParams: config.supportedAlgorithms.map((alg) => ({
      type: 'public-key' as const,
      alg,
    })),
    timeout: config.timeout,
    excludeCredentials: existingCredentials.map((credential) => ({
      id: credential.id,
      type: 'public-key' as const,
      ...(credential.transports?.length ? { transports: credential.transports } : {}),
    })),
    authenticatorSelection: {
      residentKey: config.residentKey,
      // The deprecated boolean is still what older authenticators read.
      requireResidentKey: config.residentKey === 'required',
      userVerification,
      ...(config.authenticatorAttachment
        ? { authenticatorAttachment: config.authenticatorAttachment }
        : {}),
    },
    attestation: config.attestation,
  };

  return { options, userId: user.id, isNewUser };
}

export interface VerifyRegistrationResult {
  verified: true;
  user: PasskeyUser;
  credential: PasskeyCredential;
  isNewUser: boolean;
  attestation: AttestationResult;
}

export async function verifyRegistration(
  config: ResolvedConfig,
  response: RegistrationResponseJSON,
): Promise<VerifyRegistrationResult> {
  assertRegistrationResponseShape(response);

  const clientDataBytes = decodeField(response.response.clientDataJSON, 'clientDataJSON');
  const clientData = parseClientData(clientDataBytes);

  // Step 1: find the ceremony this response belongs to. `takeChallenge`
  // consumes it, so a replay of these exact bytes finds nothing.
  const pending = await config.store.takeChallenge(clientData.challenge);
  if (!pending) {
    throw new PasskeyError(
      'challenge_not_found',
      'no pending registration matches this response — it may have expired, already been ' +
        'used, or been issued by a different server process',
    );
  }
  if (pending.kind !== 'registration') {
    throw new PasskeyError('type_mismatch', 'that challenge was issued for a login, not a registration');
  }
  if (!challengeMatches(clientData.challenge, pending.challenge)) {
    throw new PasskeyError('challenge_mismatch', 'the signed challenge is not the one we issued');
  }

  // Step 2: the ceremony type must be the one we asked for.
  if (clientData.type !== 'webauthn.create') {
    throw new PasskeyError(
      'type_mismatch',
      `expected clientData.type "webauthn.create", got "${clientData.type}"`,
    );
  }

  // Step 3: the origin must be one we serve.
  if (!originAllowed(clientData.origin, config.origins)) {
    throw new PasskeyError(
      'origin_mismatch',
      `origin "${clientData.origin}" is not in the allowed list. Add it to the \`origin\` ` +
        `option — remember to include the scheme and port.`,
    );
  }
  // Step 4: refuse ceremonies run from inside a third-party iframe.
  if (clientData.crossOrigin === true) {
    throw new PasskeyError(
      'origin_mismatch',
      'this ceremony ran in a cross-origin frame, which passkify does not allow',
    );
  }

  // Step 5: unpack the attestation object.
  const attestationObject = decodeField(response.response.attestationObject, 'attestationObject');
  const attestationMap = decodeMap(attestationObject);
  const format = attestationMap.get('fmt');
  const statement = attestationMap.get('attStmt');
  const authDataBytes = attestationMap.get('authData');
  if (typeof format !== 'string') {
    throw new PasskeyError('parse_error', 'attestation object is missing "fmt"');
  }
  if (!(statement instanceof Map)) {
    throw new PasskeyError('parse_error', 'attestation object is missing "attStmt"');
  }
  if (!(authDataBytes instanceof Uint8Array)) {
    throw new PasskeyError('parse_error', 'attestation object is missing "authData"');
  }

  const authData = parseAuthenticatorData(authDataBytes);

  // Step 6: the authenticator must have signed for our Relying Party ID.
  const expectedRpIdHash = new Uint8Array(createHash('sha256').update(config.rpID).digest());
  if (!bytesEqual(authData.rpIdHash, expectedRpIdHash)) {
    throw new PasskeyError(
      'rpid_mismatch',
      `this credential was created for a different Relying Party ID than "${config.rpID}". ` +
        `Check that rpID matches the domain the page is served from.`,
    );
  }

  // Step 7: presence and verification flags.
  if (!authData.flags.userPresent) {
    throw new PasskeyError('user_not_present', 'the user-present flag was not set');
  }
  const requiredUserVerification =
    (pending.context?.userVerification as UserVerificationRequirementName | undefined) ??
    config.userVerification;
  if (requiredUserVerification === 'required' && !authData.flags.userVerified) {
    throw new PasskeyError(
      'user_not_verified',
      'user verification was required but the authenticator only reported presence',
    );
  }

  // Step 8: a registration must carry attested credential data.
  const attested = authData.attestedCredentialData;
  if (!authData.flags.attestedCredentialData || !attested) {
    throw new PasskeyError('parse_error', 'the response contains no attested credential data');
  }

  const credentialId = toBase64Url(attested.credentialId);
  const rawId = decodeField(response.rawId, 'rawId');
  if (!bytesEqual(attested.credentialId, rawId)) {
    throw new PasskeyError(
      'malformed_response',
      'rawId does not match the credential ID inside the authenticator data',
    );
  }

  // Step 9: we must be able to verify signatures from this key later.
  const publicKey = parseCOSEPublicKey(attested.credentialPublicKey);
  if (!config.supportedAlgorithms.includes(publicKey.alg)) {
    throw new PasskeyError(
      'unsupported_algorithm',
      `the authenticator used ${algorithmName(publicKey.alg) ?? publicKey.alg}, which was not ` +
        `among the algorithms offered`,
    );
  }

  // Step 10: the attestation statement, if the authenticator sent one.
  const clientDataHash = new Uint8Array(createHash('sha256').update(clientDataBytes).digest());
  const attestation = verifyAttestation({
    format,
    statement,
    authenticatorData: authData,
    clientDataHash,
    credentialPublicKey: attested.credentialPublicKey,
    credentialId: attested.credentialId,
    aaguid: attested.aaguid,
    rootCertificates: config.attestationRootCertificates,
  });

  if (config.requireBackupEligible && !authData.flags.backupEligible) {
    throw new PasskeyError(
      'attestation_failed',
      'this authenticator cannot back up or sync the credential, which this site requires',
    );
  }

  // Step 11: refuse to register the same credential twice, for anyone.
  if (await config.store.getCredentialById(credentialId)) {
    throw new PasskeyError('credential_exists', 'that passkey is already registered');
  }

  // Everything checks out — now, and only now, materialise the account.
  let user: PasskeyUser | null;
  const isNewUser = pending.context?.isNewUser === true;
  if (isNewUser) {
    user = await config.store.createUser({
      id: pending.userId!,
      username: String(pending.context?.username ?? ''),
      displayName: String(pending.context?.displayName ?? pending.context?.username ?? ''),
    });
  } else {
    user = await config.store.getUserById(pending.userId!);
    if (!user) {
      throw new PasskeyError('unknown_user', 'the account this passkey was for no longer exists');
    }
  }

  const credential: PasskeyCredential = {
    id: credentialId,
    userId: user.id,
    publicKey: toBase64Url(attested.credentialPublicKey),
    algorithm: publicKey.alg,
    counter: authData.signCount,
    transports: normalizeTransports(response.response.transports),
    deviceType: authData.flags.backupEligible ? 'multiDevice' : 'singleDevice',
    backedUp: authData.flags.backedUp,
    aaguid: formatAaguid(attested.aaguid),
    createdAt: new Date(),
  };

  await config.store.createCredential(credential);
  await config.hooks.onRegistered?.({ user, credential, isNewUser });

  return { verified: true, user, credential, isNewUser, attestation };
}

const KNOWN_TRANSPORTS = new Set<string>([
  'usb',
  'nfc',
  'ble',
  'smart-card',
  'hybrid',
  'internal',
  'cable',
]);

/** Browsers occasionally invent transport names; keep only ones we know. */
function normalizeTransports(
  transports: readonly string[] | undefined,
): AuthenticatorTransportName[] | undefined {
  if (!Array.isArray(transports)) {
    return undefined;
  }
  const filtered = transports.filter((value): value is AuthenticatorTransportName =>
    KNOWN_TRANSPORTS.has(value),
  );
  return filtered.length > 0 ? filtered : undefined;
}

/** Render the 16-byte AAGUID in canonical UUID form. */
function formatAaguid(aaguid: Uint8Array): string {
  const hex = Array.from(aaguid, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function decodeField(value: unknown, name: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PasskeyError('malformed_response', `${name} is missing`);
  }
  try {
    return fromBase64Url(value);
  } catch (cause) {
    throw new PasskeyError('malformed_response', `${name} is not valid base64url`, { cause });
  }
}

function assertRegistrationResponseShape(value: unknown): asserts value is RegistrationResponseJSON {
  const response = value as RegistrationResponseJSON | undefined;
  if (
    !response ||
    typeof response !== 'object' ||
    typeof response.rawId !== 'string' ||
    response.type !== 'public-key' ||
    typeof response.response !== 'object' ||
    response.response === null
  ) {
    throw new PasskeyError(
      'malformed_response',
      'that is not a registration response. Send the object returned by passkify/client ' +
        "`register()` — or `credential.toJSON()` — as the request body.",
    );
  }
}

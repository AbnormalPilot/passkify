/**
 * The verification checks, as data.
 *
 * Both ceremony verifiers route every check through `trace.assert`, keyed by an
 * id in this table. That is what makes the table trustworthy: it is not a
 * description of the code that someone remembered to update, it is the thing
 * the code indexes into, and `test/checks.test.ts` fails if the two disagree in
 * either direction.
 *
 * Everything downstream renders from here — the security page's tables, the
 * ceremony diagrams, the live playground's step-by-step trace, the agent
 * skills, and the MCP server. None of them transcribe anything.
 *
 * `attack` is the part worth writing carefully. A check nobody can explain the
 * consequence of is a check nobody will maintain correctly.
 */

import type { PasskeyErrorCode } from './errors.js';

export type Ceremony = 'registration' | 'authentication';

export interface VerificationCheck {
  /** Stable across releases: an anchor, a trace key, and a test name. */
  id: string;
  ceremony: Ceremony;
  /** Position in the verifier, 1-based. Order is itself a security property. */
  index: number;
  /** Where the specification asks for this. */
  spec: string;
  title: string;
  /** The code thrown when it fails. */
  code: PasskeyErrorCode;
  /** One sentence, shared by the tables, the diagram and llms.txt. */
  detail: string;
  /** What an attacker gets if this check is missing. */
  attack: string;
  /** The file that performs it. */
  source: string;
}

const REGISTRATION: Omit<VerificationCheck, 'ceremony' | 'index'>[] = [
  {
    id: 'reg.response_well_formed',
    spec: 'WebAuthn §7.1 step 1',
    title: 'The response has the fields it must have',
    code: 'malformed_response',
    detail: 'clientDataJSON and attestationObject are present and decode as base64url.',
    attack:
      'Nothing directly, but every later check reads these bytes; a parser that guesses at missing fields is a parser that can be steered.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.challenge_found',
    spec: 'WebAuthn §7.1 step 8',
    title: 'The challenge is one we issued and have not yet consumed',
    code: 'challenge_not_found',
    detail:
      'takeChallenge fetches and deletes atomically, so the same response cannot be presented twice.',
    attack:
      'Replay. An attacker who captures one registration response could register it again, or an old challenge could be reused indefinitely.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.challenge_kind',
    spec: 'WebAuthn §7.1 step 8',
    title: 'The challenge was issued for a registration, not a login',
    code: 'type_mismatch',
    detail:
      'A challenge carries the ceremony it was minted for, and the two are not interchangeable.',
    attack:
      'Cross-ceremony confusion: a login challenge answered as a registration, which sidesteps the checks specific to each.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.challenge_matches',
    spec: 'WebAuthn §7.1 step 8',
    title: 'The signed challenge equals the stored one',
    code: 'challenge_mismatch',
    detail: 'Compared as bytes after decoding, so padded and unpadded base64url both match.',
    attack: 'A response signed over a challenge the server never issued.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.client_data_type',
    spec: 'WebAuthn §7.1 step 7',
    title: 'clientData.type is exactly "webauthn.create"',
    code: 'type_mismatch',
    detail: 'The authenticator signs this string, so it binds the signature to the ceremony kind.',
    attack: 'An assertion presented as a registration, or vice versa.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.origin_allowed',
    spec: 'WebAuthn §7.1 step 9',
    title: 'clientData.origin is in the allow-list',
    code: 'origin_mismatch',
    detail:
      'The origin the browser reports, compared with the configured origins including scheme and port.',
    attack:
      'This is the check that makes passkeys phishing-resistant. Without it, a look-alike site can relay a ceremony to your server.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.not_cross_origin',
    spec: 'WebAuthn §7.1 step 10',
    title: 'The ceremony did not run in a cross-origin frame',
    code: 'origin_mismatch',
    detail: 'clientData.crossOrigin must not be true.',
    attack: 'A third-party iframe silently enrolling a credential against your site.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.attestation_object_shape',
    spec: 'WebAuthn §7.1 step 12',
    title: 'The attestation object has fmt, attStmt and authData',
    code: 'parse_error',
    detail:
      'Decoded from CBOR with a hardened decoder: bounded depth, lengths checked before allocation, no trailing bytes.',
    attack:
      'Parser differentials — two decoders disagreeing about the same bytes is how one verifier can be made to check something another one signed.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.rp_id_hash',
    spec: 'WebAuthn §7.1 step 13',
    title: 'The RP ID hash matches this relying party',
    code: 'rpid_mismatch',
    detail: 'SHA-256 of the configured rpID, compared with the hash the authenticator signed.',
    attack: 'A credential created for another site being accepted here.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.user_present',
    spec: 'WebAuthn §7.1 step 14',
    title: 'The user-present flag is set',
    code: 'user_not_present',
    detail: 'Someone physically interacted with the authenticator.',
    attack: 'Silent enrolment by malware with access to a connected authenticator.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.user_verified',
    spec: 'WebAuthn §7.1 step 15',
    title: 'The user was verified, when the ceremony required it',
    code: 'user_not_verified',
    detail: 'Enforced only when this ceremony asked for userVerification: "required".',
    attack:
      'A credential registered with presence alone being treated as though a PIN or biometric had been checked.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.backup_flags_consistent',
    spec: 'WebAuthn §6.1.3',
    title: 'The backup-state flag is not set without backup-eligible',
    code: 'parse_error',
    detail:
      'A credential cannot be backed up if it was never eligible to be. Checked while parsing the flags.',
    attack:
      'Nothing directly; it is a malformed response, and accepting malformed input is how parsers get exploited.',
    source: 'server/crypto/authenticator-data.ts',
  },
  {
    id: 'reg.backup_eligible_required',
    spec: 'passkify policy',
    title: 'The credential is backup-eligible, when the site requires it',
    code: 'attestation_failed',
    detail:
      'Only when requireBackupEligible is set. Turning it on refuses every hardware security key.',
    attack: 'None — this is a site policy about credential durability, not a security boundary.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.attested_data_present',
    spec: 'WebAuthn §7.1 step 12',
    title: 'The response carries attested credential data',
    code: 'parse_error',
    detail: 'A registration without a public key in it is not a registration.',
    attack: 'Nothing to store, and nothing to verify future logins against.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.raw_id_matches',
    spec: 'WebAuthn §7.1 step 12',
    title: 'rawId equals the credential ID inside the authenticator data',
    code: 'parse_error',
    detail: 'The outer identifier and the signed one must be the same bytes.',
    attack:
      'Storing a credential under an ID the authenticator never signed, so logins look it up and find the wrong key.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.algorithm_offered',
    spec: 'WebAuthn §7.1 step 16',
    title: 'The public key uses an algorithm we offered',
    code: 'unsupported_algorithm',
    detail: 'The key is imported and validated by the platform before it is accepted.',
    attack:
      'A credential the server cannot verify later, or a weak algorithm smuggled in past the ones the site chose.',
    source: 'server/registration.ts',
  },
  {
    id: 'reg.attestation_statement',
    spec: 'WebAuthn §7.1 step 19',
    title: 'The attestation statement, if present, is internally consistent',
    code: 'attestation_failed',
    detail:
      'Verified whenever passkify has a verifier for the format. A format it cannot verify is reported, not refused, when the site did not ask for attestation.',
    attack:
      'A forged claim about which hardware made the key — which only matters if the site acts on that claim.',
    source: 'server/crypto/attestation.ts',
  },
  {
    id: 'reg.credential_unique',
    spec: 'WebAuthn §7.1 step 22',
    title: 'The credential is not already registered, to anyone',
    code: 'credential_exists',
    detail: 'Checked globally rather than per account.',
    attack: 'Binding one authenticator credential to two accounts, so a login is ambiguous.',
    source: 'server/registration.ts',
  },
];

const AUTHENTICATION: Omit<VerificationCheck, 'ceremony' | 'index'>[] = [
  {
    id: 'auth.response_well_formed',
    spec: 'WebAuthn §7.2 step 1',
    title: 'The response has the fields it must have',
    code: 'malformed_response',
    detail: 'clientDataJSON, authenticatorData and signature are present and decode as base64url.',
    attack: 'As with registration: a lenient reader is a steerable one.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.challenge_found',
    spec: 'WebAuthn §7.2 step 11',
    title: 'The challenge is one we issued and have not yet consumed',
    code: 'challenge_not_found',
    detail:
      'takeChallenge fetches and deletes atomically, so an assertion cannot be presented twice.',
    attack:
      'Replay of a captured assertion — the single most valuable thing an attacker can do with intercepted traffic.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.challenge_kind',
    spec: 'WebAuthn §7.2 step 11',
    title: 'The challenge was issued for a login, not a registration',
    code: 'type_mismatch',
    detail: 'The two ceremonies do not share a challenge pool.',
    attack:
      'Answering a registration challenge with an assertion, skipping the checks each ceremony has of its own.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.challenge_matches',
    spec: 'WebAuthn §7.2 step 11',
    title: 'The signed challenge equals the stored one',
    code: 'challenge_mismatch',
    detail: 'Compared as bytes after decoding.',
    attack: 'An assertion over a challenge the server never issued.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.client_data_type',
    spec: 'WebAuthn §7.2 step 10',
    title: 'clientData.type is exactly "webauthn.get"',
    code: 'type_mismatch',
    detail: 'Binds the signature to the ceremony kind.',
    attack: 'A registration response replayed as a login.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.origin_allowed',
    spec: 'WebAuthn §7.2 step 12',
    title: 'clientData.origin is in the allow-list',
    code: 'origin_mismatch',
    detail: 'The origin the browser reports, compared with the configured origins.',
    attack:
      'The phishing check. Without it a relay site can forward a real ceremony to your server and take the session.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.not_cross_origin',
    spec: 'WebAuthn §7.2 step 13',
    title: 'The ceremony did not run in a cross-origin frame',
    code: 'origin_mismatch',
    detail: 'clientData.crossOrigin must not be true.',
    attack: 'A third-party iframe silently signing a user in.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.credential_known',
    spec: 'WebAuthn §7.2 step 5',
    title: 'The credential ID is one we have stored',
    code: 'unknown_credential',
    detail: 'Looked up before any signature work, so an unknown ID costs nothing.',
    attack: 'Nothing to verify against.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.credential_belongs_to_account',
    spec: 'WebAuthn §7.2 step 6',
    title: 'The credential belongs to the account being signed into',
    code: 'unknown_credential',
    detail: 'Only when the ceremony was scoped to a username or user id.',
    attack: 'Signing in as one account using a credential registered to another.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.user_handle_matches',
    spec: 'WebAuthn §7.2 step 6',
    title: 'The user handle, when present, names the credential owner',
    code: 'unknown_credential',
    detail: 'Discoverable credentials return the user handle; it must decode to the stored owner.',
    attack: 'An authenticator asserting a credential on behalf of the wrong account.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.rp_id_hash',
    spec: 'WebAuthn §7.2 step 15',
    title: 'The RP ID hash matches this relying party',
    code: 'rpid_mismatch',
    detail: 'SHA-256 of the configured rpID, compared with the signed hash.',
    attack: 'An assertion made for another site being accepted here.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.user_present',
    spec: 'WebAuthn §7.2 step 16',
    title: 'The user-present flag is set',
    code: 'user_not_present',
    detail: 'Someone physically interacted with the authenticator.',
    attack: 'Silent sign-in by malware with access to a connected authenticator.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.user_verified',
    spec: 'WebAuthn §7.2 step 17',
    title: 'The user was verified, when the ceremony required it',
    code: 'user_not_verified',
    detail: 'Enforced only when this ceremony asked for userVerification: "required".',
    attack:
      'A presence-only tap satisfying a step-up that was meant to require a PIN or biometric.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.signature_verifies',
    spec: 'WebAuthn §7.2 step 20',
    title: 'The signature verifies against the stored public key',
    code: 'bad_signature',
    detail:
      'Over authenticatorData ‖ SHA-256(clientDataJSON), with ECDSA signatures converted from DER to the fixed-width form WebCrypto requires.',
    attack: 'Everything. This is the check that makes the rest of them mean anything.',
    source: 'server/authentication.ts',
  },
  {
    id: 'auth.counter_not_regressed',
    spec: 'WebAuthn §7.2 step 21',
    title: 'The signature counter has not gone backwards',
    code: 'counter_regression',
    detail:
      'Compared only when either side is non-zero, since many passkeys do not keep a counter at all.',
    attack:
      'A cloned authenticator. A counter going backwards is the one signal that two copies of a credential exist.',
    source: 'server/authentication.ts',
  },
];

/** Every check, in the order the verifiers perform them. */
export const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
  ...REGISTRATION.map((check, i) => ({
    ...check,
    ceremony: 'registration' as const,
    index: i + 1,
  })),
  ...AUTHENTICATION.map((check, i) => ({
    ...check,
    ceremony: 'authentication' as const,
    index: i + 1,
  })),
];

export const REGISTRATION_CHECKS = VERIFICATION_CHECKS.filter((c) => c.ceremony === 'registration');
export const AUTHENTICATION_CHECKS = VERIFICATION_CHECKS.filter(
  (c) => c.ceremony === 'authentication',
);

const BY_ID = new Map(VERIFICATION_CHECKS.map((check) => [check.id, check]));

export function getCheck(id: string): VerificationCheck | undefined {
  return BY_ID.get(id);
}

/** Checks for one ceremony, in order. */
export function checksFor(ceremony: Ceremony): readonly VerificationCheck[] {
  return ceremony === 'registration' ? REGISTRATION_CHECKS : AUTHENTICATION_CHECKS;
}

/**
 * The authentication ceremony: issuing options, then verifying the assertion.
 *
 * Follows §7.2 of the WebAuthn spec. The two flows it supports —
 *
 *   - **usernameless**: no `username`, empty `allowCredentials`. The browser
 *     shows every passkey for the site and the account is resolved from the
 *     user handle in the response. This is the good one.
 *   - **username-first**: the visitor types a username, `allowCredentials` is
 *     scoped to that account. Needed for authenticators that cannot store
 *     discoverable credentials.
 *
 * — differ only in whether the challenge carries a `userId`.
 */

import { sha256 } from './crypto/digest.js';
import { randomBytes } from './crypto/random.js';
import { PasskeyError } from '../shared/errors.js';
import { createTrace, type Trace, type CheckEvent } from '../shared/trace.js';
import {
  toBase64Url,
  fromBase64Url,
  bytesToUtf8,
  utf8ToBytes,
  bytesEqual,
  concatBytes,
} from '../shared/base64url.js';
import type {
  AuthenticationOptionsJSON,
  AuthenticationResponseJSON,
  UserVerificationRequirementName,
} from '../shared/types.js';
import type { ResolvedConfig } from './config.js';
import type { PasskeyCredential, PasskeyUser } from './store.js';
import { parseAuthenticatorData } from './crypto/authenticator-data.js';
import { parseClientData, originAllowed, challengeMatches } from './crypto/client-data.js';
import { parseCOSEPublicKey, verifySignature } from './crypto/cose.js';

export interface StartAuthenticationInput {
  /**
   * Restrict the prompt to one account's passkeys. Omit it — that is the
   * point of passkeys: the browser already knows which credentials exist for
   * your site, and asking for a username first only adds a screen.
   */
  username?: string;

  /** Same, by user handle, when you already know who is signing in. */
  userId?: string;

  /** Override the configured user verification requirement for this ceremony. */
  userVerification?: UserVerificationRequirementName;
}

export interface StartAuthenticationResult {
  options: AuthenticationOptionsJSON;
  /** Set only when the ceremony was scoped to one account. */
  userId?: string;
}

export async function createAuthenticationOptions(
  config: ResolvedConfig,
  input: StartAuthenticationInput = {},
): Promise<StartAuthenticationResult> {
  let user: PasskeyUser | null = null;

  if (input.userId) {
    user = await config.store.getUserById(input.userId);
  } else if (input.username?.trim()) {
    user = await config.store.getUserByUsername(input.username.trim());
  }

  // A username was supplied but matched nothing. Do NOT say so: replying
  // "no such user" turns the login form into a free account-enumeration
  // oracle. Issue a normal challenge with no allowCredentials; the ceremony
  // will simply fail at verification like any other bad attempt.
  const credentials = user ? await config.store.listCredentialsByUserId(user.id) : [];

  const challenge = toBase64Url(randomBytes(config.challengeSize));
  const userVerification = input.userVerification ?? config.userVerification;

  await config.store.saveChallenge({
    challenge,
    kind: 'authentication',
    ...(user ? { userId: user.id } : {}),
    expiresAt: new Date(Date.now() + config.challengeTimeout),
    context: { userVerification },
  });

  const options: AuthenticationOptionsJSON = {
    challenge,
    timeout: config.timeout,
    rpId: config.rpID,
    userVerification,
    ...(credentials.length > 0
      ? {
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            type: 'public-key' as const,
            ...(credential.transports?.length ? { transports: credential.transports } : {}),
          })),
        }
      : {}),
    ...(Object.keys(config.extensions).length ? { extensions: { ...config.extensions } } : {}),
    ...(config.hints.length ? { hints: [...config.hints] } : {}),
  };

  return { options, ...(user ? { userId: user.id } : {}) };
}

export interface VerifyAuthenticationResult {
  verified: true;
  user: PasskeyUser;
  credential: PasskeyCredential;
  /** The counter the authenticator reported. Zero for most passkeys. */
  signCount: number;
  /** True when the authenticator verified the human, not just their presence. */
  userVerified: boolean;
  /**
   * Every check the verifier ran, in order. Present only when the server was
   * constructed with `explain: true`.
   */
  checks?: readonly CheckEvent[];
}

export async function verifyAuthentication(
  config: ResolvedConfig,
  response: AuthenticationResponseJSON,
): Promise<VerifyAuthenticationResult> {
  const trace: Trace = createTrace('authentication', config.hooks.onCheck);

  assertAuthenticationResponseShape(response);
  trace.record('auth.response_well_formed', true);

  const clientDataBytes = decodeField(response.response.clientDataJSON, 'clientDataJSON');
  const clientData = parseClientData(clientDataBytes);

  const pending = await config.store.takeChallenge(clientData.challenge);
  trace.assert(
    'auth.challenge_found',
    pending !== null,
    () =>
      new PasskeyError(
        'challenge_not_found',
        'no pending login matches this response — it may have expired, already been used, ' +
          'or been issued by a different server process',
      ),
  );
  if (!pending) throw new PasskeyError('challenge_not_found', 'unreachable');

  trace.assert(
    'auth.challenge_kind',
    pending.kind === 'authentication',
    () =>
      new PasskeyError(
        'type_mismatch',
        'that challenge was issued for a registration, not a login',
      ),
  );
  trace.assert(
    'auth.challenge_matches',
    challengeMatches(clientData.challenge, pending.challenge),
    () => new PasskeyError('challenge_mismatch', 'the signed challenge is not the one we issued'),
  );
  trace.assert(
    'auth.client_data_type',
    clientData.type === 'webauthn.get',
    () =>
      new PasskeyError(
        'type_mismatch',
        `expected clientData.type "webauthn.get", got "${clientData.type}"`,
      ),
  );
  trace.assert(
    'auth.origin_allowed',
    originAllowed(clientData.origin, config.origins),
    () =>
      new PasskeyError(
        'origin_mismatch',
        `origin "${clientData.origin}" is not in the allowed list`,
      ),
  );
  trace.assert(
    'auth.not_cross_origin',
    clientData.crossOrigin !== true,
    () =>
      new PasskeyError(
        'origin_mismatch',
        'this ceremony ran in a cross-origin frame, which passkify does not allow',
      ),
  );

  const rawId = decodeField(response.rawId, 'rawId');
  const credentialId = toBase64Url(rawId);

  const credential = await config.store.getCredentialById(credentialId);
  trace.assert(
    'auth.credential_known',
    credential !== null,
    () => new PasskeyError('unknown_credential', 'that passkey is not registered here'),
  );
  if (!credential) throw new PasskeyError('unknown_credential', 'unreachable');

  // If the ceremony was scoped to one account, the credential must belong to it.
  trace.assert(
    'auth.credential_belongs_to_account',
    !pending.userId || credential.userId === pending.userId,
    () =>
      new PasskeyError(
        'unknown_credential',
        'that passkey does not belong to the account this login was started for',
      ),
  );

  // A discoverable credential returns the user handle. When present it must
  // agree with our record — this is what binds an assertion to an account in
  // the usernameless flow.
  const userHandle = response.response.userHandle;
  if (userHandle) {
    let decoded: string;
    try {
      decoded = bytesToUtf8(fromBase64Url(userHandle));
    } catch (cause) {
      throw new PasskeyError('malformed_response', 'userHandle is not valid base64url UTF-8', {
        cause,
      });
    }
    trace.assert(
      'auth.user_handle_matches',
      decoded === credential.userId,
      () =>
        new PasskeyError(
          'unknown_credential',
          'the user handle in the response does not match the credential owner',
        ),
    );
  } else {
    trace.record('auth.user_handle_matches', true);
  }

  const authDataBytes = decodeField(response.response.authenticatorData, 'authenticatorData');
  const authData = parseAuthenticatorData(authDataBytes);

  const expectedRpIdHash = await sha256(utf8ToBytes(config.rpID));
  trace.assert(
    'auth.rp_id_hash',
    bytesEqual(authData.rpIdHash, expectedRpIdHash),
    () =>
      new PasskeyError(
        'rpid_mismatch',
        `the assertion was signed for a different Relying Party ID than "${config.rpID}"`,
      ),
  );

  trace.assert(
    'auth.user_present',
    authData.flags.userPresent,
    () => new PasskeyError('user_not_present', 'the user-present flag was not set'),
  );
  const requiredUserVerification =
    (pending.context?.userVerification as UserVerificationRequirementName | undefined) ??
    config.userVerification;
  trace.assert(
    'auth.user_verified',
    requiredUserVerification !== 'required' || authData.flags.userVerified,
    () =>
      new PasskeyError(
        'user_not_verified',
        'user verification was required but the authenticator only reported presence',
      ),
  );

  // The heart of it: the authenticator signed authenticatorData || SHA-256(clientDataJSON).
  const clientDataHash = await sha256(clientDataBytes);
  const signatureBase = concatBytes(authData.bytes, clientDataHash);
  const signature = decodeField(response.response.signature, 'signature');

  const publicKey = await parseCOSEPublicKey(fromBase64Url(credential.publicKey));
  trace.assert(
    'auth.signature_verifies',
    await verifySignature(publicKey, signatureBase, signature),
    () => new PasskeyError('bad_signature', 'the assertion signature did not verify'),
  );

  const user = await config.store.getUserById(credential.userId);
  if (!user) {
    throw new PasskeyError('unknown_user', 'the account that owns this passkey no longer exists');
  }

  // Counter check. Most passkeys report 0 forever, in which case there is
  // nothing to compare; a counter that moves but goes backwards is the classic
  // cloned-authenticator signal.
  let counterAccepted = true;
  if (
    (authData.signCount > 0 || credential.counter > 0) &&
    authData.signCount <= credential.counter
  ) {
    const allow = await config.hooks.onCounterRegression?.({
      user,
      credential,
      storedCounter: credential.counter,
      presentedCounter: authData.signCount,
    });
    counterAccepted = allow === true;
  }
  trace.assert(
    'auth.counter_not_regressed',
    counterAccepted,
    () =>
      // The counters stay out of the public message: they are internal state,
      // and this response goes to an unauthenticated caller. They are on
      // `details` for your logs instead. 403 rather than 401, because the
      // meaning is "do not retry", not "try again with better credentials".
      new PasskeyError(
        'counter_regression',
        `the signature counter went from ${credential.counter} to ${authData.signCount}, ` +
          `which can mean this authenticator has been cloned`,
        {
          publicMessage:
            'this passkey was refused for security reasons. If this is unexpected, remove it ' +
            'and register it again.',
          details: {
            storedCounter: credential.counter,
            presentedCounter: authData.signCount,
          },
        },
      ),
  );

  await config.store.updateCredential(credential.id, {
    counter: authData.signCount,
    lastUsedAt: new Date(),
    backedUp: authData.flags.backedUp,
  });

  const updated: PasskeyCredential = {
    ...credential,
    counter: authData.signCount,
    lastUsedAt: new Date(),
    backedUp: authData.flags.backedUp,
  };

  await config.hooks.onAuthenticated?.({ user, credential: updated });

  return {
    ...(config.explain ? { checks: trace.events } : {}),
    verified: true,
    user,
    credential: updated,
    signCount: authData.signCount,
    userVerified: authData.flags.userVerified,
  };
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

function assertAuthenticationResponseShape(
  value: unknown,
): asserts value is AuthenticationResponseJSON {
  const response = value as AuthenticationResponseJSON | undefined;
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
      'that is not an authentication response. Send the object returned by passkify/client ' +
        '`login()` — or `credential.toJSON()` — as the request body.',
    );
  }
}

/**
 * Framework-agnostic route logic.
 *
 * Both HTTP adapters normalise their request into `{ method, path, body }`,
 * call `dispatch`, and render the outcome. Keeping the routing here means the
 * Express and fetch adapters cannot drift apart.
 *
 * Routes, relative to the mount path (default `/passkey`):
 *
 *   POST   /register/start     { username?, displayName? }   -> creation options
 *   POST   /register/finish    <registration response>       -> { verified, user }
 *   POST   /login/start        { username? }                 -> request options
 *   POST   /login/finish       <authentication response>     -> { verified, user }
 *   GET    /credentials                                      -> [ ...passkeys ]   (session required)
 *   PATCH  /credentials/:id    { nickname }                  -> { ok: true }      (session required)
 *   DELETE /credentials/:id                                  -> { ok: true }      (session required)
 */

import { PasskeyError } from '../../shared/errors.js';
import type { PasskeyServer } from '../passkey-server.js';
import { WELL_KNOWN_WEBAUTHN_PATH } from '../related-origin.js';
import type { VerifyRegistrationResult } from '../registration.js';
import type { VerifyAuthenticationResult } from '../authentication.js';

export interface NormalizedRequest {
  method: string;
  /** Path relative to the mount point, always starting with `/`. */
  path: string;
  /**
   * The absolute request path.
   *
   * `/.well-known/webauthn` is fixed by the specification and cannot be moved
   * under `basePath`, so the dispatcher has to see the real path to serve it.
   */
  pathname?: string;
  body: unknown;
  /** The authenticated account, if the adapter was given a session resolver. */
  sessionUserId: string | null;
}

export type RouteOutcome =
  | { kind: 'not-found' }
  | { kind: 'json'; status: number; body: unknown; cache?: string }
  | { kind: 'registered'; status: number; body: unknown; result: VerifyRegistrationResult }
  | { kind: 'authenticated'; status: number; body: unknown; result: VerifyAuthenticationResult };

/** Public shape of a user — never leak anything the store might have added. */
function publicUser(user: { id: string; username: string; displayName: string }) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/**
 * Accept either the ceremony response itself or `{ response: ... }`, since
 * both shapes are natural to post and telling users they picked wrong is a
 * poor use of everyone's time.
 *
 * The two are told apart by `rawId`, which sits at the top level of a real
 * ceremony response and only there — a credential also has a nested
 * `response` object, so keying off that alone unwraps the wrong layer.
 */
function unwrapCeremonyResponse(body: unknown): unknown {
  const object = asObject(body);
  if (typeof object.rawId !== 'string' && object.response && typeof object.response === 'object') {
    return object.response;
  }
  return body;
}

function requireSession(request: NormalizedRequest): string {
  if (!request.sessionUserId) {
    throw new PasskeyError('unknown_user', 'you must be signed in to manage passkeys', {
      status: 401,
    });
  }
  return request.sessionUserId;
}

export async function dispatch(
  server: PasskeyServer,
  request: NormalizedRequest,
): Promise<RouteOutcome> {
  const { method, path } = request;

  // Checked before anything else, because it is an absolute path rather than
  // one relative to the mount point, and the adapters 404 anything outside
  // their mount.
  if (method === 'GET' && request.pathname === WELL_KNOWN_WEBAUTHN_PATH) {
    const body = server.relatedOrigins();
    if (!body) return { kind: 'not-found' };
    return { kind: 'json', status: 200, body, cache: 'public, max-age=3600' };
  }

  if (method === 'POST' && path === '/register/start') {
    const body = asObject(request.body);
    // A signed-in visitor is adding a device to *their own* account. Trusting
    // a username from the body here would let them attach a passkey to
    // somebody else's account.
    const options = request.sessionUserId
      ? await server.startRegistration({ userId: request.sessionUserId })
      : await server.startRegistration({
          username: typeof body.username === 'string' ? body.username : undefined,
          displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
        });
    return { kind: 'json', status: 200, body: options.options };
  }

  if (method === 'POST' && path === '/register/finish') {
    const result = await server.finishRegistration(unwrapCeremonyResponse(request.body) as never);
    return {
      kind: 'registered',
      status: 200,
      body: {
        verified: true,
        user: publicUser(result.user),
        credentialId: result.credential.id,
        isNewUser: result.isNewUser,
      },
      result,
    };
  }

  if (method === 'POST' && path === '/login/start') {
    const body = asObject(request.body);
    const options = await server.startAuthentication({
      username: typeof body.username === 'string' ? body.username : undefined,
    });
    return { kind: 'json', status: 200, body: options.options };
  }

  if (method === 'POST' && path === '/login/finish') {
    const result = await server.finishAuthentication(unwrapCeremonyResponse(request.body) as never);
    return {
      kind: 'authenticated',
      status: 200,
      body: {
        verified: true,
        user: publicUser(result.user),
        credentialId: result.credential.id,
      },
      result,
    };
  }

  // Level 3 signal methods. One round trip covers both the credential list and
  // the account details, because the browser needs them together.
  if (method === 'GET' && path === '/signals') {
    const userId = requireSession(request);
    const payload = await server.signals(userId);
    // 204 rather than an empty list: an empty `allAcceptedCredentialIds` tells
    // the platform to delete every passkey for this user.
    if (!payload) return { kind: 'json', status: 204, body: null };
    return { kind: 'json', status: 200, body: payload };
  }

  if (method === 'GET' && path === '/credentials') {
    const userId = requireSession(request);
    return { kind: 'json', status: 200, body: await server.listCredentials(userId) };
  }

  const credentialMatch = /^\/credentials\/(.+)$/.exec(path);
  if (credentialMatch) {
    const userId = requireSession(request);
    const credentialId = decodeURIComponent(credentialMatch[1]);

    if (method === 'DELETE') {
      await server.deleteCredential(userId, credentialId);
      return { kind: 'json', status: 200, body: { ok: true } };
    }
    if (method === 'PATCH') {
      const nickname = asObject(request.body).nickname;
      if (typeof nickname !== 'string') {
        throw new PasskeyError('malformed_response', 'a "nickname" string is required');
      }
      await server.renameCredential(userId, credentialId, nickname);
      return { kind: 'json', status: 200, body: { ok: true } };
    }
  }

  return { kind: 'not-found' };
}

/** Turn any thrown value into a status and a JSON body, without leaking internals. */
export function renderError(error: unknown, verbose = false): { status: number; body: unknown } {
  if (error instanceof PasskeyError) {
    // `publicMessage`, where one exists, is the sanitised twin of a message
    // written for a developer. Several of the developer-facing ones name the
    // configuration or internal state, which an unauthenticated caller has no
    // business learning.
    return { status: error.status, body: error.toJSON({ verbose }) };
  }
  return {
    status: 500,
    body: { error: 'server_error', message: 'passkey request failed' },
  };
}

/** Strip the mount path off a URL path. Returns null when it does not match. */
export function relativePath(pathname: string, basePath: string): string | null {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (base === '') {
    return pathname || '/';
  }
  if (pathname === base) {
    return '/';
  }
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length);
  }
  return null;
}

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * A minimal signed-cookie session for the demo.
 *
 * Deliberately small so the passkey wiring stays the interesting part. A real
 * application should use iron-session, Auth.js, Lucia or its own: passkify's
 * job ends at "this is who it is", and everything after that is ordinary
 * session management.
 */

export const SESSION_COOKIE = 'passkify_demo_session';

/*
 * A generated secret is fine for a demo whose sessions are disposable: a
 * restart invalidates them, which is what the in-memory store does anyway.
 *
 * It has to be stashed on `globalThis` though. In development Next evaluates
 * route modules separately, so a module-level `randomBytes()` gives the passkey
 * route and the session route different secrets: the cookie one of them signs
 * cannot be verified by the other, and the visitor is signed out the instant
 * they sign in. Production bundling happens to hide this, which is worse.
 */
const globalForSecret = globalThis as unknown as { demoSessionSecret?: string };

const SECRET =
  process.env.DEMO_SESSION_SECRET ??
  (globalForSecret.demoSessionSecret ??= randomBytes(32).toString('hex'));

const sign = (value: string): string =>
  createHmac('sha256', SECRET).update(value).digest('base64url');

export function createSessionCookie(userId: string): string {
  const value = `${userId}.${sign(userId)}`;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
    'Max-Age=86400',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Read and verify the cookie, returning the user handle or null. */
export function readSession(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(header);
  if (!match) return null;

  const [userId, signature] = decodeURIComponent(match[1]).split('.');
  if (!userId || !signature) return null;

  const expected = Buffer.from(sign(userId));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  return userId;
}

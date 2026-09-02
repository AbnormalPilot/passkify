import { demoPasskeys } from '@/lib/demo-passkeys';
import { createSessionCookie, readSession } from '@/lib/demo-session';

/**
 * All four passkey routes plus credential management, mounted as one catch-all.
 *
 * This file is the Next.js example from the documentation, running for real.
 * `basePath` must match this file's location: app/api/passkey/[...passkey]
 * serves /api/passkey/*.
 */
const handler = demoPasskeys.handler({
  basePath: '/api/passkey',

  // Supplying this unlocks two things: a signed-in visitor can add a second
  // passkey, and the /credentials routes stop answering 401.
  getSessionUserId: (request) => readSession(request),

  // Returning a HeadersInit merges into the default JSON reply.
  onRegister: (_request, { user }) => ({ 'set-cookie': createSessionCookie(user.id) }),
  onLogin: (_request, { user }) => ({ 'set-cookie': createSessionCookie(user.id) }),
});

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };

// Ceremonies are stateful; nothing here may be cached or prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // the server half needs node:crypto

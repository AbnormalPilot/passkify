import { demoPasskeys } from '@/lib/demo-passkeys';
import { clearSessionCookie, readSession } from '@/lib/demo-session';

/** Who is signed in, and their passkeys. */
export async function GET(request: Request) {
  const userId = readSession(request);
  if (!userId) {
    return Response.json({ signedIn: false }, { headers: { 'cache-control': 'no-store' } });
  }

  const user = await demoPasskeys.store.getUserById(userId);
  if (!user) {
    // The in-memory store was reset out from under a live cookie.
    return Response.json(
      { signedIn: false },
      { headers: { 'cache-control': 'no-store', 'set-cookie': clearSessionCookie() } },
    );
  }

  return Response.json(
    {
      signedIn: true,
      user: { id: user.id, username: user.username, displayName: user.displayName },
      credentials: await demoPasskeys.listCredentials(user.id),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/** Sign out. */
export async function DELETE() {
  return Response.json(
    { signedIn: false },
    { headers: { 'cache-control': 'no-store', 'set-cookie': clearSessionCookie() } },
  );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

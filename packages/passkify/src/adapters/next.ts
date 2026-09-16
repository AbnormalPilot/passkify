/**
 * Next.js App Router.
 *
 * ```ts
 * // app/api/passkey/[...passkey]/route.ts
 * import { passkeyRoutes } from 'passkify/next';
 * import { passkeys } from '@/lib/passkeys';
 *
 * export const { GET, POST, PATCH, DELETE, runtime, dynamic } = passkeyRoutes(passkeys, {
 *   basePath: '/api/passkey',
 *   getSessionUserId: async () => (await cookies()).get('session')?.value ?? null,
 * });
 * ```
 *
 * `basePath` has to match the directory the route file lives in. Getting that
 * wrong is the most common way this fails, and the handler says so explicitly
 * rather than 404ing.
 *
 * The exported `runtime` is `'nodejs'`. Passkify runs fine on the edge, but a
 * route that builds a `PasskeyServer` usually also touches a database driver
 * that does not — set it yourself if yours does.
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

type Handler = (request: Request) => Promise<Response>;

export interface NextRouteHandlers {
  GET: Handler;
  POST: Handler;
  PATCH: Handler;
  DELETE: Handler;
  /** Re-export from your route file: challenges must never be cached. */
  dynamic: 'force-dynamic';
  runtime: 'nodejs';
}

export function passkeyRoutes(
  server: PasskeyServer,
  options: FetchAdapterOptions = {},
): NextRouteHandlers {
  const handler = server.handler(options);
  return {
    GET: handler,
    POST: handler,
    PATCH: handler,
    DELETE: handler,
    dynamic: 'force-dynamic',
    runtime: 'nodejs',
  };
}

/**
 * A route handler for `/.well-known/webauthn`, when related origins are on.
 *
 * It sits at the site root rather than under your API prefix, because the
 * specification fixes its location:
 *
 * ```ts
 * // app/.well-known/webauthn/route.ts
 * export const { GET } = wellKnownRoute(passkeys);
 * ```
 */
export function wellKnownRoute(server: PasskeyServer): { GET: Handler; dynamic: 'force-static' } {
  return {
    async GET() {
      const body = server.relatedOrigins();
      if (!body) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(body), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=3600',
        },
      });
    },
    dynamic: 'force-static',
  };
}

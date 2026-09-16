/**
 * Hono.
 *
 * ```ts
 * import { passkifyHono } from 'passkify/hono';
 *
 * app.all('/passkey/*', passkifyHono(passkeys, {
 *   getSessionUserId: (request) => getSession(request)?.userId ?? null,
 * }));
 * app.get('/.well-known/webauthn', passkifyHono(passkeys));
 * ```
 *
 * Hono's context wraps a standard `Request`, so this is a two-line bridge to
 * the same handler every other runtime uses.
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

interface HonoContextLike {
  req: { raw: Request };
}

export function passkifyHono(
  server: PasskeyServer,
  options: FetchAdapterOptions = {},
): (context: HonoContextLike) => Promise<Response> {
  const handler = server.handler(options);
  return (context) => handler(context.req.raw);
}

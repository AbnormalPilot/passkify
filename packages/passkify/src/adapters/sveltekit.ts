/**
 * SvelteKit.
 *
 * ```ts
 * // src/routes/passkey/[...path]/+server.ts
 * import { passkeyHandlers } from 'passkify/sveltekit';
 * export const { GET, POST, PATCH, DELETE } = passkeyHandlers(passkeys, {
 *   basePath: '/passkey',
 *   getSessionUserId: (request) => sessionFromCookie(request),
 * });
 * ```
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

interface RequestEventLike {
  request: Request;
}

type SvelteHandler = (event: RequestEventLike) => Promise<Response>;

export function passkeyHandlers(
  server: PasskeyServer,
  options: FetchAdapterOptions = {},
): { GET: SvelteHandler; POST: SvelteHandler; PATCH: SvelteHandler; DELETE: SvelteHandler } {
  const handler = server.handler(options);
  const bridge: SvelteHandler = (event) => handler(event.request);
  return { GET: bridge, POST: bridge, PATCH: bridge, DELETE: bridge };
}

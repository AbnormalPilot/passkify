/**
 * Remix and React Router 7.
 *
 * ```ts
 * // app/routes/passkey.$.tsx
 * import { passkeyLoader, passkeyAction } from 'passkify/remix';
 * export const loader = passkeyLoader(passkeys, { basePath: '/passkey' });
 * export const action = passkeyAction(passkeys, { basePath: '/passkey' });
 * ```
 *
 * Two exports rather than one because Remix splits reads from writes: `GET`
 * reaches the loader, everything else reaches the action.
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

interface DataFunctionArgs {
  request: Request;
}

export function passkeyLoader(
  server: PasskeyServer,
  options: FetchAdapterOptions = {},
): (args: DataFunctionArgs) => Promise<Response> {
  const handler = server.handler(options);
  return ({ request }) => handler(request);
}

export const passkeyAction = passkeyLoader;

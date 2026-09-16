/**
 * Cloudflare Workers.
 *
 * ```ts
 * import { passkeyWorker } from 'passkify/cloudflare';
 *
 * export default {
 *   fetch: passkeyWorker((env) => buildPasskeyServer(env), { basePath: '/passkey' }),
 * };
 * ```
 *
 * The server is built per request from `env`, because Workers hands bindings
 * (D1, KV, secrets) to `fetch` rather than to module scope. Construction is
 * cheap — it is config validation and nothing else.
 *
 * This works at all because passkify's verification path is pure WebCrypto:
 * there is no `node:crypto` on the ceremony path, so nothing here needs
 * `nodejs_compat`.
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

type WorkerFetch<Env> = (request: Request, env: Env, ctx?: unknown) => Promise<Response> | Response;

export function passkeyWorker<Env>(
  build: (env: Env) => PasskeyServer,
  options: FetchAdapterOptions = {},
): WorkerFetch<Env> {
  return (request, env) => build(env).handler(options)(request);
}

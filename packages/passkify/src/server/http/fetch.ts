/**
 * Web-standard adapter: `(Request) => Promise<Response>`.
 *
 * Works anywhere the fetch API does — Next.js route handlers, Hono, Bun, Deno,
 * Cloudflare Workers, Remix.
 *
 * ```ts
 * // app/api/passkey/[...passkey]/route.ts
 * const handler = passkeys.handler({ basePath: '/api/passkey' });
 * export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
 * ```
 */

import type { PasskeyServer } from '../passkey-server.js';
import type { VerifyRegistrationResult } from '../registration.js';
import type { VerifyAuthenticationResult } from '../authentication.js';
import { dispatch, renderError, relativePath, type NormalizedRequest } from './routes.js';

export interface FetchAdapterOptions {
  /** Where the routes live. Must match how you mounted the handler. Default `/passkey`. */
  basePath?: string;

  /** Resolve the signed-in account from the request (a cookie, a header, ...). */
  getSessionUserId?: (request: Request) => string | null | undefined | Promise<string | null | undefined>;

  /**
   * Called after a successful registration.
   *
   * Return a `Response` to take over the reply entirely, or a `HeadersInit`
   * (e.g. a `Set-Cookie`) to merge into the default JSON reply.
   */
  onRegister?: (
    request: Request,
    result: VerifyRegistrationResult,
  ) => void | Response | HeadersInit | Promise<void | Response | HeadersInit>;

  /** Called after a successful login. Same return contract as `onRegister`. */
  onLogin?: (
    request: Request,
    result: VerifyAuthenticationResult,
  ) => void | Response | HeadersInit | Promise<void | Response | HeadersInit>;
}

export function createFetchHandler(server: PasskeyServer, options: FetchAdapterOptions) {
  const basePath = options.basePath ?? '/passkey';

  return async function passkifyHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = relativePath(url.pathname, basePath);

    if (path === null) {
      return json(404, {
        error: 'configuration_error',
        message:
          `passkify is mounted at "${basePath}" but the request was for "${url.pathname}". ` +
          `Set basePath to match where you mounted the handler.`,
      });
    }

    try {
      const normalized: NormalizedRequest = {
        method: request.method.toUpperCase(),
        path,
        body: await readJsonBody(request),
        sessionUserId: (await options.getSessionUserId?.(request)) ?? null,
      };

      const outcome = await dispatch(server, normalized);

      if (outcome.kind === 'not-found') {
        return json(404, { error: 'not_found', message: `no passkey route at ${path}` });
      }

      let extra: HeadersInit | undefined;
      if (outcome.kind === 'registered') {
        const hook = await options.onRegister?.(request, outcome.result);
        if (hook instanceof Response) {
          return hook;
        }
        extra = hook ?? undefined;
      } else if (outcome.kind === 'authenticated') {
        const hook = await options.onLogin?.(request, outcome.result);
        if (hook instanceof Response) {
          return hook;
        }
        extra = hook ?? undefined;
      }

      return json(outcome.status, outcome.body, extra);
    } catch (error) {
      const rendered = renderError(error);
      if (rendered.status >= 500) {
        // Surface real faults in the platform's logs.
        console.error('[passkify]', error);
      }
      return json(rendered.status, rendered.body);
    }
  };
}

function json(status: number, body: unknown, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

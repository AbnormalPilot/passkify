/**
 * Express / Connect adapter.
 *
 * ```js
 * app.use(passkeys.express({
 *   getSessionUserId: (req) => req.session.userId ?? null,
 *   onLogin: (req, res, { user }) => { req.session.userId = user.id },
 * }));
 * ```
 *
 * The middleware handles the passkey routes and calls `next()` for everything
 * else, so it is safe to mount at the top of the stack. It parses its own JSON
 * body when one has not already been parsed, which means it also works on a
 * bare `node:http` server with no body-parser installed.
 */

import type { PasskeyServer } from '../passkey-server.js';
import type { VerifyRegistrationResult } from '../registration.js';
import type { VerifyAuthenticationResult } from '../authentication.js';
import { dispatch, renderError, relativePath, type NormalizedRequest } from './routes.js';

/** Minimal structural types, so passkify does not depend on @types/express. */
export interface ExpressLikeRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface ExpressLikeResponse {
  statusCode: number;
  writableEnded?: boolean;
  setHeader(name: string, value: string): unknown;
  end(chunk?: string): unknown;
}

export interface ExpressAdapterOptions {
  /** Where the routes live. Default `/passkey`. */
  basePath?: string;

  /**
   * Return the signed-in account's ID, or `null`.
   *
   * Supplying this unlocks two things: signed-in users can add another passkey,
   * and the `/credentials` management routes become available. Without it those
   * routes answer 401.
   */
  getSessionUserId?: (
    request: ExpressLikeRequest,
  ) => string | null | undefined | Promise<string | null | undefined>;

  /** Called after a successful registration. Set a session here if you log people in on signup. */
  onRegister?: (
    request: ExpressLikeRequest,
    response: ExpressLikeResponse,
    result: VerifyRegistrationResult,
  ) => void | Promise<void>;

  /** Called after a successful login. Set your session cookie here. */
  onLogin?: (
    request: ExpressLikeRequest,
    response: ExpressLikeResponse,
    result: VerifyAuthenticationResult,
  ) => void | Promise<void>;
}

/** Largest JSON body accepted, to stop a stream from eating memory. */
const MAX_BODY_BYTES = 512 * 1024;

export function createExpressMiddleware(server: PasskeyServer, options: ExpressAdapterOptions) {
  const basePath = options.basePath ?? '/passkey';

  return async function passkifyMiddleware(
    request: ExpressLikeRequest,
    response: ExpressLikeResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    const rawUrl = request.originalUrl ?? request.url ?? '/';
    const pathname = rawUrl.split('?')[0];
    const path = relativePath(pathname, basePath);
    if (path === null) {
      next();
      return;
    }

    const send = (status: number, body: unknown): void => {
      if (response.writableEnded) {
        return;
      }
      response.statusCode = status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      // These endpoints are challenge/response; a cached answer is a broken one.
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify(body));
    };

    try {
      const normalized: NormalizedRequest = {
        method: (request.method ?? 'GET').toUpperCase(),
        path,
        body: request.body !== undefined ? request.body : await readJsonBody(request),
        sessionUserId: (await options.getSessionUserId?.(request)) ?? null,
      };

      const outcome = await dispatch(server, normalized);

      if (outcome.kind === 'not-found') {
        next();
        return;
      }
      if (outcome.kind === 'registered') {
        await options.onRegister?.(request, response, outcome.result);
      } else if (outcome.kind === 'authenticated') {
        await options.onLogin?.(request, response, outcome.result);
      }
      send(outcome.status, outcome.body);
    } catch (error) {
      const rendered = renderError(error);
      // A 500 means passkify itself broke; hand it to the app's error handler
      // so it lands in their logs rather than disappearing into a JSON body.
      if (rendered.status >= 500) {
        next(error);
        return;
      }
      send(rendered.status, rendered.body);
    }
  };
}

/** Read and parse a JSON body from a raw Node request stream. */
async function readJsonBody(request: ExpressLikeRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = request as unknown as NodeJS.EventEmitter;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve());
      stream.on('error', (error: Error) => reject(error));
    });
  } catch {
    return undefined;
  }

  if (chunks.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

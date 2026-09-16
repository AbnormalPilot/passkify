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
import { PasskeyError } from '../../shared/errors.js';
import { WELL_KNOWN_WEBAUTHN_PATH } from '../related-origin.js';

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
  /**
   * Send the developer-facing error message over the wire instead of the
   * sanitised one.
   *
   * Off by default. Several messages name your configuration or internal
   * state — the origin allow-list, a signature counter — which is useful in a
   * terminal and is not something to hand an unauthenticated caller. Turn this
   * on in development only.
   */
  verbose?: boolean;

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
    const isWellKnown = pathname === WELL_KNOWN_WEBAUTHN_PATH;
    if (path === null && !isWellKnown) {
      next();
      return;
    }

    const send = (status: number, body: unknown, cache?: string): void => {
      if (response.writableEnded) {
        return;
      }
      response.statusCode = status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      // Ceremony endpoints are challenge/response; a cached answer is a broken
      // one. The related-origins file is public and static, so it opts out.
      response.setHeader('cache-control', cache ?? 'no-store');
      response.end(JSON.stringify(body));
    };

    // Served above the mount: the specification fixes its absolute path.
    if (isWellKnown) {
      const outcome = await dispatch(server, {
        method: (request.method ?? 'GET').toUpperCase(),
        path: '/',
        pathname,
        body: undefined,
        sessionUserId: null,
      });
      if (outcome.kind === 'not-found') {
        next();
        return;
      }
      send(outcome.status, outcome.body, outcome.kind === 'json' ? outcome.cache : undefined);
      return;
    }

    try {
      const normalized: NormalizedRequest = {
        method: (request.method ?? 'GET').toUpperCase(),
        path: path as string,
        pathname,
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
      const rendered = renderError(error, options.verbose ?? false);
      // A 500 means passkify itself broke; hand it to the app's error handler
      // so it lands in their logs rather than disappearing into a JSON body.
      if (rendered.status >= 500) {
        next(error);
        return;
      }
      // Note on payload_too_large: the response goes out immediately while
      // the client is still uploading, and the rest of the body is drained and
      // discarded rather than buffered. Closing the connection here instead
      // would be tidier, but it resets the client mid-write and it never gets
      // to read the 413 explaining why. Bandwidth is the cost; memory, which is
      // the part that matters, stays bounded.
      send(rendered.status, rendered.body);
    }
  };
}

/**
 * Read and parse a JSON body from a raw Node request stream.
 *
 * The cap is enforced by destroying the connection, not merely by refusing to
 * buffer: an earlier version resolved to `undefined` and left the client
 * happily uploading the rest of its megabytes into a socket nobody was reading.
 * That is a denial of service with extra steps.
 */
async function readJsonBody(request: ExpressLikeRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = request as unknown as NodeJS.EventEmitter & {
        resume?: () => void;
      };

      let overflowed = false;

      stream.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          overflowed = true;
          // Drop what was buffered and keep draining without storing anything.
          // Destroying the socket here instead would be tidier, but the client
          // is still mid-upload and would get a connection reset rather than
          // the 413 explaining what went wrong. Memory stays bounded either
          // way, which is the part that matters.
          chunks.length = 0;
          stream.resume?.();
          reject(
            new PasskeyError('payload_too_large', `request body exceeded ${MAX_BODY_BYTES} bytes`, {
              publicMessage: 'request body is too large',
            }),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve());
      stream.on('error', (error: Error) => reject(error));
    });
  } catch (error) {
    if (error instanceof PasskeyError) throw error;
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

/**
 * Fastify.
 *
 * ```ts
 * import { passkifyFastify } from 'passkify/fastify';
 * await app.register(passkifyFastify, { server: passkeys, basePath: '/passkey' });
 * ```
 *
 * The only adapter with real work in it. Fastify parses the body itself and
 * exposes a Node request rather than a standard `Request`, so the bridge has to
 * rebuild one — and the plugin is marked as skipping encapsulation by hand,
 * with the symbol `fastify-plugin` would otherwise set, so that taking a
 * dependency on it is unnecessary.
 */

import type { PasskeyServer } from '../server/passkey-server.js';
import type { FetchAdapterOptions } from '../server/http/fetch.js';

interface FastifyRequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  protocol?: string;
  hostname?: string;
}

interface FastifyReplyLike {
  status(code: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(payload: unknown): unknown;
}

interface FastifyInstanceLike {
  all(
    path: string,
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike) => unknown,
  ): unknown;
  get(
    path: string,
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike) => unknown,
  ): unknown;
}

export interface FastifyPluginOptions extends FetchAdapterOptions {
  server: PasskeyServer;
}

async function passkifyPlugin(
  app: FastifyInstanceLike,
  options: FastifyPluginOptions,
): Promise<void> {
  const { server, ...adapterOptions } = options;
  const basePath = adapterOptions.basePath ?? '/passkey';
  const handler = server.handler(adapterOptions);

  const bridge = async (request: FastifyRequestLike, reply: FastifyReplyLike) => {
    const origin = `${request.protocol ?? 'http'}://${request.hostname ?? 'localhost'}`;
    const init: RequestInit = {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
      ),
    };
    // Fastify has already parsed the body, so it is re-serialised rather than
    // read from the stream, which has been consumed.
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
      init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    }

    const response = await handler(new Request(`${origin}${request.url}`, init));
    reply.status(response.status);
    // A block body, not an expression: the arrow must not return the reply,
    // and Headers is not iterable under this TypeScript lib configuration.
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    return reply.send(await response.text());
  };

  app.all(`${basePath}/*`, bridge);
  app.all(basePath, bridge);
  if (server.publishesRelatedOrigins) {
    app.get('/.well-known/webauthn', bridge);
  }
}

// What `fastify-plugin` sets, set by hand — the plugin needs to register its
// routes on the parent scope, and that is a one-symbol contract rather than a
// reason to take a dependency.
(passkifyPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;

export { passkifyPlugin as passkifyFastify };

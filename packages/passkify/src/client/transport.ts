/**
 * Talking to your server.
 *
 * The only transport concern that matters here is turning a non-2xx reply back
 * into the `PasskeyError` the server threw, so a caller can branch on the same
 * `code` on both sides of the wire.
 */

import { PasskeyError, type PasskeyErrorCode } from '../shared/errors.js';
import type { ResolvedClientConfig } from './types.js';

export async function request<T>(
  config: ResolvedClientConfig,
  path: string,
  body: unknown,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<T> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
  const sendsBody = method !== 'GET' && method !== 'DELETE';

  let response: Response;
  try {
    response = await doFetch(url, {
      method,
      headers: sendsBody
        ? { 'content-type': 'application/json', ...config.headers }
        : { ...config.headers },
      credentials: config.credentials ?? 'same-origin',
      ...(sendsBody ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch (cause) {
    throw new PasskeyError('server_error', `could not reach ${url}`, { cause });
  }

  // 204 carries no body, and calling .json() on one throws.
  let payload: unknown;
  if (response.status === 204) {
    payload = undefined;
  } else {
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const details = payload as { error?: string; message?: string } | undefined;
    throw new PasskeyError(
      (details?.error as PasskeyErrorCode) ?? 'server_error',
      details?.message ?? `${url} responded ${response.status}`,
      { status: response.status },
    );
  }

  return payload as T;
}

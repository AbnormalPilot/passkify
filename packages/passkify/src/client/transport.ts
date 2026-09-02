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
): Promise<T> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...config.headers },
      credentials: config.credentials ?? 'same-origin',
      body: JSON.stringify(body ?? {}),
    });
  } catch (cause) {
    throw new PasskeyError('server_error', `could not reach ${url}`, { cause });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
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

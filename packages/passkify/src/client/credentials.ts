/**
 * Managing the passkeys on an account, from the browser.
 *
 * The server has had these routes since the beginning; the browser package had
 * no way to call them, so every application wrote its own `fetch` wrappers for
 * an API passkify already served. It does now.
 *
 * All three need a session — the server answers for the signed-in account and
 * ignores anything the caller says about whose passkeys these are.
 */

import { resolveConfig } from './config.js';
import { request } from './transport.js';
import { syncPasskeys } from './signals.js';
import type { ClientConfig } from './types.js';

export interface PasskeySummary {
  id: string;
  nickname?: string;
  /** `'multiDevice'` for a synced passkey, `'singleDevice'` for a hardware key. */
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: string[];
  aaguid?: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** The passkeys registered to the signed-in account. */
export async function listPasskeys(
  input: { config?: ClientConfig } = {},
): Promise<PasskeySummary[]> {
  return request<PasskeySummary[]>(resolveConfig(input.config), '/credentials', undefined, 'GET');
}

/**
 * Rename a passkey, so the account settings page can say "MacBook" rather than
 * a base64url blob.
 *
 * Also re-signals the platform, because the name shown in the operating
 * system's picker comes from the account details we last handed over.
 */
export async function renamePasskey(
  credentialId: string,
  nickname: string,
  input: { config?: ClientConfig } = {},
): Promise<void> {
  const config = resolveConfig(input.config);
  await request(config, `/credentials/${encodeURIComponent(credentialId)}`, { nickname }, 'PATCH');
  await syncPasskeys({ config: input.config });
}

/**
 * Remove a passkey.
 *
 * The server refuses to remove an account's last one — `last_credential`, 409 —
 * because doing so locks the user out of a passwordless account.
 *
 * Signals the platform afterwards, which is what stops the deleted passkey
 * lingering in the operating system's account picker. Without that call it
 * stays there indefinitely and fails when chosen.
 */
export async function deletePasskey(
  credentialId: string,
  input: { config?: ClientConfig } = {},
): Promise<void> {
  const config = resolveConfig(input.config);
  await request(config, `/credentials/${encodeURIComponent(credentialId)}`, undefined, 'DELETE');
  await syncPasskeys({ config: input.config });
}

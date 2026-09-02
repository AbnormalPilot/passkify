/**
 * Client defaults.
 *
 * Module-level state, deliberately: `configure()` is called once at startup and
 * every call site reads the same values. Threading a config object through
 * `register`, `login` and the ceremony helpers would be more principled and
 * worse to use, so a per-call `config` override exists for the rare case.
 */

import type { ClientConfig, ResolvedClientConfig } from './types.js';

let globalConfig: ResolvedClientConfig = { baseUrl: '/passkey' };

/**
 * Set defaults for every subsequent call. Optional: the defaults work if you
 * mounted the server at `/passkey` on the same origin.
 */
export function configure(config: ClientConfig): void {
  globalConfig = { ...globalConfig, ...config, baseUrl: config.baseUrl ?? globalConfig.baseUrl };
}

/** Merge per-call overrides over the configured defaults. */
export function resolveConfig(overrides?: ClientConfig): ResolvedClientConfig {
  return {
    ...globalConfig,
    ...overrides,
    baseUrl: overrides?.baseUrl ?? globalConfig.baseUrl,
  };
}

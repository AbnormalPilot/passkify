import { PasskeyServer, MemoryStore } from 'passkify';

/**
 * The live demo's passkey server.
 *
 * This is genuinely the published library doing the work, not a mock: the same
 * `PasskeyServer` a consumer would construct, verifying real assertions from a
 * real authenticator.
 *
 * It uses `MemoryStore`, which is correct here and wrong in production. The
 * demo is meant to be disposable, and a visitor should not be leaving a
 * durable account behind on a documentation site. Everything resets when the
 * process restarts.
 */

/*
 * Only the store is cached across hot reloads.
 *
 * Next re-evaluates modules on every edit, and a fresh MemoryStore per edit
 * would discard every account and in-flight challenge. The `PasskeyServer`
 * itself is different: it holds no state, so caching it would pin the demo to
 * a stale copy of the library and quietly defeat hot reload. It is rebuilt on
 * each evaluation instead, which is free.
 */
const globalForDemo = globalThis as unknown as { demoStore?: MemoryStore };

export const demoStore = (globalForDemo.demoStore ??= new MemoryStore());

/**
 * The origin the browser will actually report. In development that is
 * localhost:3000; in a deployment it must be the public URL, scheme and all,
 * or every ceremony fails `origin_mismatch`.
 */
export const DEMO_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, '') ?? 'http://localhost:3000';

export const demoPasskeys = new PasskeyServer({
  rpName: 'Passkify Demo',
  origin: DEMO_ORIGIN,
  store: demoStore,
  // The demo should work on a hardware key with no PIN as readily as on
  // Touch ID, so presence is enough here. A site protecting a real account
  // wants 'required'.
  userVerification: 'preferred',
});

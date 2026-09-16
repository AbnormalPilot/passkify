/**
 * `passkify/react` — hooks over the browser API.
 *
 * These exist because every passkey integration writes the same four pieces of
 * state (pending, error, result, and "is this browser capable") and the same
 * abort-on-unmount, and getting the last one wrong leaves a ceremony running
 * against a component that no longer exists.
 *
 * React is a peer, not a dependency: these are typed against the hooks they
 * use and resolved from your copy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  register as registerPasskey,
  login as loginPasskey,
  signInWithAutofill,
  listPasskeys,
  renamePasskey,
  deletePasskey,
  isSupported,
  isPlatformAuthenticatorAvailable,
  getCapabilities,
  PasskeyError,
  type PasskeyClientResult,
  type PasskeySummary,
  type ClientConfig,
} from '../client/index.js';

interface CeremonyState {
  pending: boolean;
  error: PasskeyError | null;
  result: PasskeyClientResult | null;
}

const IDLE: CeremonyState = { pending: false, error: null, result: null };

/** Shared machinery: one in-flight ceremony, aborted if the component goes away. */
function useCeremony<Args extends unknown[]>(
  run: (signal: AbortSignal, ...args: Args) => Promise<PasskeyClientResult | null>,
) {
  const [state, setState] = useState<CeremonyState>(IDLE);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const start = useCallback(
    async (...args: Args): Promise<PasskeyClientResult | null> => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;

      setState({ pending: true, error: null, result: null });
      try {
        const result = await run(current.signal, ...args);
        if (mounted.current) setState({ pending: false, error: null, result });
        return result;
      } catch (error) {
        const passkeyError =
          error instanceof PasskeyError
            ? error
            : new PasskeyError('server_error', 'the ceremony failed', { cause: error });
        if (mounted.current) setState({ pending: false, error: passkeyError, result: null });
        throw passkeyError;
      }
    },
    [run],
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { ...state, start, reset };
}

/**
 * Register a passkey.
 *
 * ```tsx
 * const { register, pending, error } = useRegister();
 * <button onClick={() => register({ username })} disabled={pending}>Create a passkey</button>
 * {error && !error.isUserCancellation && <p>{error.message}</p>}
 * ```
 *
 * A cancelled ceremony still lands in `error`; check `isUserCancellation`
 * before showing anything, because the user closing the prompt is not a fault.
 */
export function useRegister(config?: ClientConfig) {
  const run = useCallback(
    (signal: AbortSignal, input: { username?: string; displayName?: string } = {}) =>
      registerPasskey({ ...input, signal, config }),
    [config],
  );
  const ceremony = useCeremony(run);
  return { ...ceremony, register: ceremony.start };
}

/** Sign in with a passkey. Omit the username for usernameless sign-in. */
export function useLogin(config?: ClientConfig) {
  const run = useCallback(
    (signal: AbortSignal, input: { username?: string } = {}) =>
      loginPasskey({ ...input, signal, config }),
    [config],
  );
  const ceremony = useCeremony(run);
  return { ...ceremony, login: ceremony.start };
}

/**
 * Offer passkeys in the browser's autofill dropdown, for as long as the sign-in
 * form is on screen.
 *
 * Starts on mount and aborts on unmount, which is the part hand-written
 * versions usually miss — a conditional-mediation request outliving its form
 * blocks the next ceremony, and the failure looks like nothing happening.
 */
export function usePasskeyAutofill(
  onSuccess: (result: PasskeyClientResult) => void,
  config?: ClientConfig,
): { active: boolean } {
  const [active, setActive] = useState(false);
  const callback = useRef(onSuccess);
  callback.current = onSuccess;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const result = await signInWithAutofill({ signal: controller.signal, config });
        if (!cancelled && result) callback.current(result);
      } catch {
        // A cancelled or unsupported autofill attempt is not an error worth
        // surfacing — the user still has the ordinary sign-in button.
      } finally {
        if (!cancelled) setActive(false);
      }
    })();

    setActive(true);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [config]);

  return { active };
}

/** The signed-in account's passkeys, for a settings page. */
export function usePasskeys(config?: ClientConfig) {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<PasskeyError | null>(null);
  const [pending, setPending] = useState(true);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      setPasskeys(await listPasskeys({ config }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof PasskeyError ? caught : null);
    } finally {
      setPending(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rename = useCallback(
    async (credentialId: string, nickname: string) => {
      await renamePasskey(credentialId, nickname, { config });
      await refresh();
    },
    [config, refresh],
  );

  const remove = useCallback(
    async (credentialId: string) => {
      await deletePasskey(credentialId, { config });
      await refresh();
    },
    [config, refresh],
  );

  return { passkeys, pending, error, refresh, rename, remove };
}

/**
 * What this browser can do.
 *
 * Everything starts `false` and fills in after mount, because the checks are
 * asynchronous and because rendering different markup on the server than on the
 * client is a hydration mismatch. Use it to decide how prominently to offer
 * passkeys — never whether to offer them at all, since the answer describes
 * this device rather than the user's options.
 */
export function usePasskeySupport(): {
  supported: boolean;
  platformAuthenticator: boolean;
  capabilities: Record<string, boolean>;
  checked: boolean;
} {
  const [state, setState] = useState({
    supported: false,
    platformAuthenticator: false,
    capabilities: {} as Record<string, boolean>,
    checked: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported = isSupported();
      const [platformAuthenticator, capabilities] = supported
        ? await Promise.all([isPlatformAuthenticatorAvailable(), getCapabilities()])
        : [false, {}];
      if (!cancelled) {
        setState({ supported, platformAuthenticator, capabilities, checked: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

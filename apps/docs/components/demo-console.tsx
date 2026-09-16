'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  register,
  login,
  signInWithAutofill,
  configure,
  isSupported,
  isPlatformAuthenticatorAvailable,
  PasskeyError,
} from 'passkify/client';

// Must match `basePath` in app/api/passkey/[...passkey]/route.ts.
configure({ baseUrl: '/api/passkey' });

interface Credential {
  id: string;
  nickname?: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  transports?: string[];
  createdAt: string;
  lastUsedAt?: string;
}

interface SessionState {
  signedIn: boolean;
  user?: { id: string; username: string; displayName: string };
  credentials?: Credential[];
}

/**
 * The live demo. This is the published package doing the work: a real
 * `PasskeyServer` on the route handler, a real authenticator on this end.
 */
export function DemoConsole() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [platform, setPlatform] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/demo/session');
    const next = (await response.json()) as SessionState;
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isSupported()) {
      setSupported(false);
      setSession({ signedIn: false });
      return;
    }
    void isPlatformAuthenticatorAvailable().then(setPlatform);

    const controller = new AbortController();
    void refresh().then((next) => {
      if (next.signedIn) return;
      // Offer passkeys in the username field's own autofill dropdown. This
      // resolves only if the visitor picks one, which may be never, so it must
      // not block anything.
      signInWithAutofill({ signal: controller.signal })
        .then((result) => {
          if (result) {
            setStatus('Signed in from the autofill dropdown.');
            void refresh();
          }
        })
        .catch(() => {});
    });

    // A pending autofill request survives unmount otherwise, and blocks the
    // next ceremony.
    return () => controller.abort();
  }, [refresh]);

  /** Run a ceremony, turning a PasskeyError into readable status text. */
  const attempt = (label: string, action: () => Promise<unknown>) => async () => {
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await action();
      await refresh();
    } catch (error) {
      // Dismissing the prompt is the most common outcome after a success. It
      // is not worth an error message.
      if (error instanceof PasskeyError && error.isUserCancellation) {
        setStatus('Cancelled.');
      } else {
        setStatus(error instanceof Error ? error.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  };

  const signUp = attempt('Creating your account', async () => {
    const name = username.trim();
    if (!name) throw new PasskeyError('malformed_response', 'Choose a username first.');
    const { user } = await register({ username: name });
    setStatus(`Account created. Signed in as ${user.username}.`);
  });

  const signIn = attempt('Signing in', async () => {
    const { user } = await login();
    setStatus(`Signed in as ${user.username}.`);
  });

  const addPasskey = attempt('Registering another passkey', async () => {
    await register();
    setStatus('Passkey added to this account.');
  });

  const signOut = async () => {
    await fetch('/api/demo/session', { method: 'DELETE' });
    setStatus('Signed out.');
    await refresh();
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/passkey/credentials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = await response.json();
      setStatus(response.ok ? 'Passkey revoked.' : body.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <p className="alert-banner">
        This browser does not support passkeys, so the demo cannot run here.
      </p>
    );
  }

  /* The console is framed as application chrome rather than as a card: it is
     the real package running, and the 6px window is this system's signal for
     that. On the light section it is also the polarity flip working at
     component scale. */
  return (
    <div className="app-window self-start">
      <div className="app-window-chrome justify-between">
        <div className="flex items-center gap-[6px]">
          <span className="app-window-dot bg-[#ff5f57]" aria-hidden />
          <span className="app-window-dot bg-[#febc2e]" aria-hidden />
          <span className="app-window-dot bg-[#28c840]" aria-hidden />
          <span className="t-mono-caps ml-sm text-mute">Live demo</span>
        </div>
        <span className="t-mono-micro flex items-center gap-[6px] uppercase text-ash">
          <span
            className="size-[6px] rounded-full"
            style={{ background: session?.signedIn ? 'var(--success)' : 'var(--mute)' }}
            aria-hidden
          />
          {session?.signedIn ? 'Session open' : 'No session'}
        </span>
      </div>

      {/* ------------------------------------------------------ signed out */}
      {session && !session.signedIn && (
        <div className="p-lg">
          <label htmlFor="demo-username" className="t-mono-caps block text-mute">
            Username
          </label>
          <input
            id="demo-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username webauthn"
            placeholder="ada"
            disabled={busy}
            className="mt-2 h-11 w-full rounded-[3px] border border-hairline-soft bg-canvas px-sm font-mono text-[14px] text-ash outline-none transition-colors placeholder:text-mute focus:border-ash disabled:opacity-50"
          />

          <div className="mt-md flex flex-wrap gap-xs">
            <button
              type="button"
              onClick={signUp}
              disabled={busy || !username.trim()}
              className="btn-pill btn-primary disabled:opacity-40"
            >
              Create account
            </button>
            <button
              type="button"
              onClick={signIn}
              disabled={busy}
              className="btn-secondary-dark disabled:opacity-40"
            >
              Sign in
            </button>
          </div>

          <p className="t-body-sm mt-md text-ash">
            {platform
              ? 'Sign in needs no username: your browser will show every passkey it holds for this domain.'
              : 'No built-in sensor was detected. Your browser can still offer a phone or a security key.'}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------- signed in */}
      {session?.signedIn && session.user && (
        <div className="p-lg">
          <p className="t-body text-on-primary">
            Signed in as <strong className="font-mono font-medium">{session.user.username}</strong>
          </p>
          <p className="mt-1 font-mono text-[12px] text-mute">user handle {session.user.id}</p>

          <p className="t-mono-caps mt-lg border-b border-hairline-soft pb-2 text-mute">
            Passkeys on this account
          </p>
          <ul className="divide-y divide-hairline-soft">
            {session.credentials?.map((credential) => (
              <li
                key={credential.id}
                className="flex flex-wrap items-baseline gap-x-sm gap-y-1 py-sm"
              >
                <span className="font-mono text-[13px] text-ash">
                  {credential.id.slice(0, 14)}...
                </span>
                <span className="t-mono-micro uppercase text-mute">
                  {credential.deviceType === 'multiDevice' ? 'Synced' : 'This device only'}
                </span>
                {credential.lastUsedAt && (
                  <span className="t-meta text-mute">
                    used {new Date(credential.lastUsedAt).toLocaleTimeString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => revoke(credential.id)}
                  disabled={busy}
                  className="t-mono-micro ml-auto uppercase text-mute underline underline-offset-4 transition-colors hover:text-ash disabled:opacity-40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-lg flex flex-wrap gap-xs">
            <button
              type="button"
              onClick={addPasskey}
              disabled={busy}
              className="btn-secondary-dark disabled:opacity-40"
            >
              Add another passkey
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="btn-secondary-dark disabled:opacity-40"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Status is always present in the DOM so it never shifts the layout,
          and is announced when it changes. */}
      <p
        role="status"
        aria-live="polite"
        className="min-h-[2.75rem] border-t border-hairline-soft px-lg py-sm font-mono text-[12.5px] leading-relaxed text-mute"
      >
        {status}
      </p>
    </div>
  );
}

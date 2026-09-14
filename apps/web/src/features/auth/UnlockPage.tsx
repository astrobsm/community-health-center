import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { useAuth } from '@/lib/auth/auth-store';
import { summarise, type OutboxSummary } from '@/lib/offline/outbox';

/**
 * The lock screen.
 *
 * Shown whenever the app opens with a session already on this device. The user
 * enters only their password — which both unlocks the encrypted local store and
 * restores their session.
 *
 * Two things it does that a plain sign-in form would not:
 *
 *  - It tells the user how much unsynced work is on this device BEFORE they
 *    unlock. Those counts are plaintext precisely so they can be read while
 *    locked, and "12 records waiting" is the strongest possible argument
 *    against wiping the app or handing the phone to someone else.
 *  - It offers a way out to a different account, but makes clear that signing
 *    out with unsynced work would strand it.
 */
export function UnlockPage(): JSX.Element {
  const { lockedEmail, unlockOffline, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<OutboxSummary | null>(null);

  useEffect(() => {
    void summarise().then(setPending);
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const outcome = await unlockOffline(password);
    setBusy(false);

    if (outcome.kind === 'failed') setError(outcome.message);
  };

  const waiting = pending ? pending.pending + pending.sending : 0;

  return (
    <div className="page" style={{ maxWidth: '26rem', paddingTop: 'var(--s7)' }}>
      <form className="card stack" onSubmit={(event) => void submit(event)}>
        <h1>Unlock</h1>

        {lockedEmail && (
          <p className="muted small" style={{ margin: 0 }}>
            Signed in as <span className="strong">{lockedEmail}</span>
          </p>
        )}

        {waiting > 0 && (
          <div className="notice notice-warn">
            {waiting} record{waiting === 1 ? '' : 's'} on this device {waiting === 1 ? 'has' : 'have'} not
            reached the server yet. Unlock to sync {waiting === 1 ? 'it' : 'them'}.
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <p className="hint">
            Your password unlocks the data saved on this device. It works without a connection.
          </p>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-block small"
          onClick={() => {
            if (
              waiting === 0 ||
              window.confirm(
                `${waiting} record(s) have not been synced. Signing out as someone else will leave them on this device, unreadable until this account signs in again. Continue?`,
              )
            ) {
              void signOut();
            }
          }}
        >
          Sign in as someone else
        </button>
      </form>
    </div>
  );
}

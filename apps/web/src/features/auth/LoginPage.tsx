import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

import { useAuth, type LoginOutcome } from '@/lib/auth/auth-store';

type Stage =
  | { kind: 'credentials' }
  | { kind: 'mfa'; mfaToken: string }
  | { kind: 'enrol'; enrolmentToken: string; secret: string; otpauthUri: string; reason: string };

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login, verifyMfa, confirmEnrolment } = useAuth();

  const [stage, setStage] = useState<Stage>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = (outcome: LoginOutcome): void => {
    switch (outcome.kind) {
      case 'signed-in':
        void navigate('/');
        return;
      case 'mfa-required':
        setStage({ kind: 'mfa', mfaToken: outcome.mfaToken });
        setError(null);
        return;
      case 'mfa-enrolment':
        setStage({
          kind: 'enrol',
          enrolmentToken: outcome.enrolmentToken,
          secret: outcome.secret,
          otpauthUri: outcome.otpauthUri,
          reason: outcome.reason,
        });
        setError(null);
        return;
      case 'failed':
        setError(outcome.message);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (stage.kind === 'credentials') handle(await login(email, password));
      else if (stage.kind === 'mfa') handle(await verifyMfa(stage.mfaToken, code));
      else handle(await confirmEnrolment(stage.enrolmentToken, code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '26rem', paddingTop: 'var(--s7)' }}>
      <form className="card stack" onSubmit={(event) => void submit(event)}>
        <h1>Community Health Centre</h1>

        {stage.kind === 'credentials' && (
          <>
            <p className="muted small">
              Sign in to continue. If you have used this device before, you can sign in without a
              connection.
            </p>

            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </>
        )}

        {stage.kind === 'mfa' && (
          <>
            <p className="muted small">Enter the 6-digit code from your authenticator app.</p>
            <CodeInput value={code} onChange={setCode} />
          </>
        )}

        {stage.kind === 'enrol' && (
          <>
            <div className="notice notice-info">{stage.reason}</div>

            <div className="field">
              <span className="label">1. Add this to your authenticator app</span>
              <p className="hint">
                Scan the code in your app, or type this key in manually if you cannot scan.
              </p>
              <code className="mono small" style={{ wordBreak: 'break-all' }}>
                {stage.secret}
              </code>
            </div>

            <div className="field">
              <label className="label" htmlFor="code">
                2. Enter the 6-digit code it shows
              </label>
              <CodeInput value={code} onChange={setCode} />
            </div>
          </>
        )}

        {error && (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Please wait…' : stage.kind === 'credentials' ? 'Sign in' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <input
      id="code"
      className="input mono"
      type="text"
      /* numeric, not `type="number"`: a leading zero must survive, and spinners
         on a one-time code are nonsense. */
      inputMode="numeric"
      pattern="[0-9]{6}"
      autoComplete="one-time-code"
      maxLength={6}
      required
      style={{ fontSize: 'var(--text-2xl)', letterSpacing: '0.4em', textAlign: 'center' }}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { api, ApiError, setToken } from '../api';
import { setSession } from '../store';
import { card, field, panel, primaryBtn, linkBtn } from './ui';

function humanize(e: ApiError): string {
  switch (e.message) {
    case 'name_taken':
      return 'That name is already taken.';
    case 'bad_credentials':
      return 'Wrong name or PIN.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'invalid':
      return 'Enter a name and a 4-6 digit PIN.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(displayName.trim(), pin)
          : await api.register(displayName.trim(), pin);
      setToken(res.token);
      setSession(res.user);
      await navigate({ to: '/lobby' });
    } catch (err) {
      setError(err instanceof ApiError ? humanize(err) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={panel}>
      <form style={card} onSubmit={onSubmit}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>VTT</div>
        <div style={{ opacity: 0.7, marginBottom: 8 }}>
          {mode === 'login' ? 'Sign in' : 'Create an account'}
        </div>
        <input
          style={field}
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoFocus
        />
        <input
          style={field}
          placeholder="PIN (4-6 digits)"
          value={pin}
          inputMode="numeric"
          type="password"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
        <button style={primaryBtn} disabled={busy} type="submit">
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Register'}
        </button>
        <button
          style={linkBtn}
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}

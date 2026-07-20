import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import type { GameSummary } from '@vtt/shared';
import { api, ApiError, clearToken } from '../api';
import { clearSession, state } from '../store';
import { field, ghostBtn, linkBtn, primaryBtn, surface } from './ui';

export function Lobby() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setGames(await api.listGames());
    } catch {
      setError('Could not load your Games.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function createGame() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const game = await api.createGame(newName.trim());
      setNewName('');
      await refresh();
      void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } });
    } catch (e) {
      setError(e instanceof ApiError ? `Could not create Game (${e.message})` : 'Could not create Game.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    clearSession();
    void navigate({ to: '/login' });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: '#0a0a0f',
        color: '#e5e7eb',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          ...surface,
          width: 260,
          flexShrink: 0,
          margin: 16,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Your Games</div>
          <button style={linkBtn} onClick={logout}>
            log out
          </button>
        </div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>{state.session?.user.displayName}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {games.map((g) => (
            <button
              key={g.id}
              style={{ ...ghostBtn, textAlign: 'left', width: '100%' }}
              onClick={() => void navigate({ to: '/lobby/game/$gameId', params: { gameId: g.id } })}
            >
              {g.name}
              <div style={{ opacity: 0.6, fontSize: 11 }}>
                {g.campaignCount} campaign{g.campaignCount === 1 ? '' : 's'} · {g.memberCount} member
                {g.memberCount === 1 ? '' : 's'}
              </div>
            </button>
          ))}
          {games.length === 0 && <div style={{ opacity: 0.5, fontSize: 12 }}>No Games yet.</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
          <input
            style={field}
            placeholder="New Game name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button style={primaryBtn} onClick={createGame} disabled={busy}>
            {busy ? '…' : '+ New Game'}
          </button>
          {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        <Outlet />
      </div>
    </div>
  );
}

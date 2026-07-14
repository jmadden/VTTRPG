import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { CampaignSummary } from '@vtt/shared';
import { api, ApiError, clearToken } from '../api';
import { clearSession, state } from '../store';
import { field, ghostBtn, linkBtn, panel, primaryBtn } from './ui';

export function Lobby() {
  const navigate = useNavigate();
  const [camps, setCamps] = useState<CampaignSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCamps(await api.listCampaigns());
    } catch {
      setError('Could not load campaigns.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    if (!newName.trim()) return;
    try {
      await api.createCampaign(newName.trim());
      setNewName('');
      await refresh();
    } catch {
      setError('Could not create campaign.');
    }
  }

  async function join(c: CampaignSummary) {
    setError(null);
    try {
      await api.joinCampaign(c.id, codes[c.id]);
      await refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.message === 'bad_code' ? 'Wrong join code.' : 'Could not join.',
      );
    }
  }

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }

  function manage(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId/manage', params: { campaignId: c.id } });
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
    <div style={{ ...panel, alignItems: 'flex-start', overflow: 'auto' }}>
      <div style={{ width: 480, maxWidth: '90vw', margin: '40px auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Campaigns</div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            {state.session?.user.displayName}{' '}
            <button style={linkBtn} onClick={logout}>
              log out
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
          <input
            style={{ ...field, flex: 1 }}
            placeholder="New campaign name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button style={primaryBtn} onClick={create}>
            Create (you GM)
          </button>
        </div>

        {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {camps.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                background: '#14141f',
                border: '1px solid #2a2a3a',
                borderRadius: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {c.name} {c.isGm && <span style={{ opacity: 0.6, fontSize: 12 }}>(you GM)</span>}
                </div>
                <div style={{ opacity: 0.6, fontSize: 12 }}>
                  GM {c.gmName} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                </div>
              </div>
              {c.isGm ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={ghostBtn} onClick={() => manage(c)}>
                    Manage
                  </button>
                  {c.activeMapId && (
                    <button style={primaryBtn} onClick={() => enter(c)}>
                      Enter
                    </button>
                  )}
                </div>
              ) : c.isMember ? (
                c.activeMapId ? (
                  <button style={primaryBtn} onClick={() => enter(c)}>
                    Enter
                  </button>
                ) : (
                  <span style={{ opacity: 0.5, fontSize: 12 }}>no active map yet</span>
                )
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...field, width: 110 }}
                    placeholder="join code"
                    value={codes[c.id] ?? ''}
                    onChange={(e) => setCodes((m) => ({ ...m, [c.id]: e.target.value }))}
                  />
                  <button style={ghostBtn} onClick={() => join(c)}>
                    Join
                  </button>
                </div>
              )}
            </div>
          ))}
          {camps.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet. Create one above.</div>
          )}
        </div>
      </div>
    </div>
  );
}

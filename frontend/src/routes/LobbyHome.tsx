import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { CampaignSummary } from '@vtt/shared';
import { api, ApiError } from '../api';
import { field, ghostBtn, primaryBtn } from './ui';

// docs/12 §2: players are unaffected by the Games hierarchy -- this is the
// pre-existing flat campaign list (Enter / Join by code), scoped to
// campaigns the viewer is NOT the GM of (their own GM'd campaigns now live
// under their Games in the sidebar instead).
export function LobbyHome() {
  const navigate = useNavigate();
  const [camps, setCamps] = useState<CampaignSummary[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const all = await api.listCampaigns();
      setCamps(all.filter((c) => !c.isGm));
    } catch {
      setError('Could not load campaigns.');
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function join(c: CampaignSummary) {
    setError(null);
    try {
      await api.joinCampaign(c.id, codes[c.id]);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.message === 'bad_code' ? 'Wrong join code.' : 'Could not join.');
    }
  }

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }

  return (
    <div style={{ width: 480, maxWidth: '90vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Your Campaigns</div>

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
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ opacity: 0.6, fontSize: 12 }}>
                GM {c.gmName} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
              </div>
            </div>
            {c.isMember ? (
              <button style={primaryBtn} onClick={() => enter(c)}>
                Enter
              </button>
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
          <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet — ask your GM for a join code.</div>
        )}
      </div>
    </div>
  );
}

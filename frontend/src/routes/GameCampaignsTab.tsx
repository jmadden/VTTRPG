import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { CampaignStatus, CampaignSummary, GameDetail } from '@vtt/shared';
import { api, ApiError } from '../api';
import { ghostBtn, primaryBtn, statusBadge } from './ui';

const PRIMARY_ACTION: Record<CampaignStatus, string> = {
  live: 'Enter',
  paused: 'Start Session',
  draft: 'Manage',
  completed: 'View',
};

export function GameCampaignsTab({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = game.campaigns.filter((c) => showCompleted || c.status !== 'completed');

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }
  function manage(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId/manage', params: { campaignId: c.id } });
  }
  function primaryAction(c: CampaignSummary) {
    if (c.status === 'draft') return manage(c);
    if (c.status === 'paused') return void startSession(c);
    return enter(c);
  }

  async function startSession(c: CampaignSummary) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.startSession(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start session.');
    } finally {
      setBusyId(null);
    }
  }
  async function endSession(c: CampaignSummary) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.endSession(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not end session.');
    } finally {
      setBusyId(null);
    }
  }
  async function markComplete(c: CampaignSummary) {
    if (!window.confirm(`Mark "${c.name}" complete? This cannot be undone.`)) return;
    setBusyId(c.id);
    setError(null);
    try {
      await api.completeCampaign(c.id);
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not mark complete.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
        <button
          style={primaryBtn}
          onClick={() => void navigate({ to: '/lobby/game/$gameId/campaigns/new', params: { gameId: game.id } })}
        >
          + New Campaign
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {visible.map((c) => (
          <div key={c.id} style={{ padding: 14, background: '#14141f', border: '1px solid #2a2a3a', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <span style={statusBadge(c.status)}>{c.status}</span>
            </div>
            <div style={{ opacity: 0.6, fontSize: 12, margin: '6px 0 10px' }}>
              {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={primaryBtn} disabled={busyId === c.id} onClick={() => primaryAction(c)}>
                {PRIMARY_ACTION[c.status]}
              </button>
              {c.status === 'draft' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void startSession(c)}>
                  Start Session
                </button>
              )}
              {c.status === 'live' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void endSession(c)}>
                  End Session
                </button>
              )}
              {c.status === 'paused' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => manage(c)}>
                  Manage
                </button>
              )}
              {c.status !== 'completed' && (
                <button style={ghostBtn} disabled={busyId === c.id} onClick={() => void markComplete(c)}>
                  Mark Complete
                </button>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet. Create one above.</div>}
      </div>
    </div>
  );
}

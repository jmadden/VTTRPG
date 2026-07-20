import { useNavigate } from '@tanstack/react-router';
import type { CampaignSummary, GameDetail } from '@vtt/shared';
import { ghostBtn, primaryBtn } from './ui';

export function GameCampaignsTab({ game }: { game: GameDetail; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate();

  function enter(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId', params: { campaignId: c.id } });
  }
  function manage(c: CampaignSummary) {
    void navigate({ to: '/campaign/$campaignId/manage', params: { campaignId: c.id } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {game.campaigns.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            background: '#14141f',
            border: '1px solid #2a2a3a',
            borderRadius: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div style={{ opacity: 0.6, fontSize: 12 }}>
              {c.memberCount} member{c.memberCount === 1 ? '' : 's'} · {c.status}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={ghostBtn} onClick={() => manage(c)}>
              Manage
            </button>
            <button style={primaryBtn} onClick={() => enter(c)}>
              Enter
            </button>
          </div>
        </div>
      ))}
      {game.campaigns.length === 0 && (
        <div style={{ opacity: 0.5, fontSize: 13 }}>No campaigns yet in this Game.</div>
      )}
    </div>
  );
}

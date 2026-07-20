import { useState } from 'react';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { api, ApiError } from '../api';
import { chip, field, ghostBtn, primaryBtn } from './ui';

const gameRouteApi = getRouteApi('/authed/lobby/game/$gameId');

export function CreateCampaignPage() {
  const { game } = gameRouteApi.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState('');
  const [templateIds, setTemplateIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function create() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createCampaign({
        gameId: game.id,
        name: name.trim(),
        templateIds: [...templateIds],
        memberUserIds: [...memberIds],
      });
      // The parent gameRoute's loader data (game.campaigns) was fetched
      // before this campaign existed -- invalidate so GamePage remounts
      // with the fresh list instead of the stale empty one.
      await router.invalidate();
      void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } });
    } catch (e) {
      setError(e instanceof ApiError ? `Could not create campaign (${e.message})` : 'Could not create campaign.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ width: 640, maxWidth: '92vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>New Campaign · {game.name}</div>

      <input
        style={{ ...field, width: '100%', marginBottom: 16 }}
        placeholder="Campaign name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Map Library templates</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {game.mapTemplates.map((t) => (
              <div key={t.id} style={chip(templateIds.has(t.id))} onClick={() => toggle(templateIds, setTemplateIds, t.id)}>
                {t.name}
              </div>
            ))}
            {game.mapTemplates.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 12 }}>No templates yet in this Game's Map Library.</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Roster members</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {game.members.map((m) => (
              <div key={m.userId} style={chip(memberIds.has(m.userId))} onClick={() => toggle(memberIds, setMemberIds, m.userId)}>
                {m.displayName}
              </div>
            ))}
            {game.members.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 12 }}>
                No roster members yet -- share the Game's join code from the Roster tab.
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 13, margin: '16px 0 0' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button style={ghostBtn} onClick={() => void navigate({ to: '/lobby/game/$gameId', params: { gameId: game.id } })}>
          Cancel
        </button>
        <button style={primaryBtn} onClick={create} disabled={busy}>
          {busy ? '…' : 'Create Campaign'}
        </button>
      </div>
    </div>
  );
}

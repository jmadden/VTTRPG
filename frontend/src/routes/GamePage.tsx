import { useEffect, useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { GameCampaignsTab } from './GameCampaignsTab';
import { GameMapLibraryTab } from './GameMapLibraryTab';
import { GameRosterTab } from './GameRosterTab';
import { api } from '../api';
import { tabChip } from './ui';

const routeApi = getRouteApi('/authed/lobby/game/$gameId');

type Tab = 'campaigns' | 'maps' | 'roster';

export function GamePage() {
  const loader = routeApi.useLoaderData();
  const [game, setGame] = useState(loader.game);
  const [tab, setTab] = useState<Tab>('campaigns');

  async function refresh() {
    setGame(await api.getGame(game.id));
  }

  // The parent gameRoute's loader data can be stale by the time this mounts
  // (e.g. returning from Create Campaign) -- always refetch on mount rather
  // than trusting the loader snapshot, same pattern as Lobby.tsx/LobbyHome.tsx.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader.game.id]);

  return (
    <div style={{ width: 760, maxWidth: '92vw', margin: '40px auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{game.name}</div>
      {game.description && (
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 12 }}>{game.description}</div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2a2a3a', marginBottom: 16 }}>
        <button style={tabChip(tab === 'campaigns')} onClick={() => setTab('campaigns')}>
          Campaigns
        </button>
        <button style={tabChip(tab === 'maps')} onClick={() => setTab('maps')}>
          Map Library
        </button>
        <button style={tabChip(tab === 'roster')} onClick={() => setTab('roster')}>
          Roster
        </button>
      </div>

      {tab === 'campaigns' && <GameCampaignsTab game={game} onRefresh={refresh} />}
      {tab === 'maps' && <GameMapLibraryTab game={game} onRefresh={refresh} />}
      {tab === 'roster' && <GameRosterTab game={game} onRefresh={refresh} />}
    </div>
  );
}

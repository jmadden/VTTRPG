import { useEffect, useSyncExternalStore } from 'react';
import { EV } from '@vtt/shared';
import { socket } from '../../socket';
import { getVersion, state, subscribe } from '../../store';
import { tabChip } from '../ui';

interface Props {
  campaignId: string;
  mapId: string | null;
  onSelect: (mapId: string) => void;
  onRelocateToken: (tokenId: string, toMapId: string) => Promise<boolean>;
}

/** GM's ordered live-map tabs. Click switches the joined map; a dragged
 *  player row (from PlayersPanel) dropped on a tab relocates that player. */
export function TabBar({ campaignId, mapId, onSelect, onRelocateToken }: Props) {
  useSyncExternalStore(subscribe, getVersion);
  const liveMaps = state.liveMaps;

  // No map selected yet (empty live set on load, or the last tab was just
  // removed) and a tab now exists -> auto-select the first one.
  useEffect(() => {
    if (mapId === null && liveMaps.length > 0) onSelect(liveMaps[0]!.mapId);
  }, [mapId, liveMaps, onSelect]);

  function removeTab(id: string) {
    const next = liveMaps
      .filter((m) => m.mapId !== id)
      .map((m, i) => ({ mapId: m.mapId, title: m.title, position: i }));
    socket.emit(EV.SET_LIVE_MAPS, { campaignId, liveMaps: next }, () => {});
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', height: '100%' }}
    >
      {liveMaps.map((m) => (
        <div
          key={m.mapId}
          data-testid={`tab-${m.mapId}`}
          onClick={() => onSelect(m.mapId)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const tokenId = e.dataTransfer.getData('text/plain');
            if (tokenId) void onRelocateToken(tokenId, m.mapId);
          }}
          style={tabChip(m.mapId === mapId)}
        >
          {m.title}
          <span
            onClick={(e) => {
              e.stopPropagation();
              removeTab(m.mapId);
            }}
            title="Remove tab"
            style={{ opacity: 0.5 }}
          >
            ×
          </span>
        </div>
      ))}
      {liveMaps.length === 0 && (
        <div style={{ opacity: 0.5, fontSize: 12 }}>No live tabs yet.</div>
      )}
    </div>
  );
}

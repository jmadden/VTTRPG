import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { EV, type MemberTokenDto, type TokenMoveBroadcast } from '@vtt/shared';
import { PixiStage } from '../game/PixiStage';
import { socket } from '../socket';
import { assetUrl, clearToken } from '../api';
import {
  addToken,
  applyConceal,
  applyReveal,
  applyStateSync,
  clearSession,
  getVersion,
  moveToken,
  removeToken,
  setLiveMaps as applyLiveMaps,
  state,
  subscribe,
} from '../store';
import { chip, ghostBtn, gmToggle, space, surface } from './ui';
import { TabBar } from './gm/TabBar';
import { LibraryDrawer } from './gm/LibraryDrawer';
import { PlayersPanel } from './gm/PlayersPanel';

type FogMode = 'reveal' | 'conceal';

const routeApi = getRouteApi('/authed/campaign/$campaignId');

export function MapView() {
  const loader = routeApi.useLoaderData();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<FogMode>('reveal');
  const [connected, setConnected] = useState(false);
  // gm-maps-1b: mapId is live state, not frozen loader data — a GM tab click
  // or an incoming map_relocated push both just set it, and the join effect
  // below re-runs join_map exactly like the initial mount used to.
  const [mapId, setMapId] = useState<string | null>(loader.mapId);
  const [memberTokens, setMemberTokens] = useState<MemberTokenDto[]>(loader.campaign.memberTokens);
  const modeRef = useRef<FogMode>(mode);
  modeRef.current = mode;
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const mapIdRef = useRef(mapId);
  mapIdRef.current = mapId;

  const version = useSyncExternalStore(subscribe, getVersion);

  const campaignId = loader.campaign.id;
  const isGm = loader.campaign.gmUserId === state.session?.user.id;

  // Seed the GM's live-tab list once from the loader (subsequent changes
  // arrive via the set_live_maps broadcast, handled below).
  useEffect(() => {
    if (isGm) applyLiveMaps(loader.campaign.liveMaps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create the Pixi stage once per joined map and wire canvas input handlers.
  // No map selected yet (empty live set / player not yet placed) -> no stage.
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent || !mapId) return;

    let cancelled = false;
    const stage = new PixiStage();
    stage.init(parent).then(() => {
      if (cancelled) {
        stage.destroy();
        return;
      }
      stage.setHandlers({
        // Click empty cell: GM reveals or conceals per the active mode.
        onCellAction: (cell) => {
          if (!state.isGM) return;
          if (modeRef.current === 'reveal') {
            if (state.revealed.has(cell)) return;
            applyReveal([cell]);
            socket.emit(EV.REVEAL_TILES, { mapId, add: [cell] });
          } else {
            if (!state.revealed.has(cell)) return;
            applyConceal([cell]);
            socket.emit(EV.CONCEAL_TILES, { mapId, remove: [cell] });
          }
        },
        // Drop a dragged token: optimistic local move + tell the server.
        onTokenDrop: (tokenId, x, y) => {
          moveToken(tokenId, x, y);
          socket.emit(EV.TOKEN_MOVE, { tokenId, x, y });
        },
      });
      stageRef.current = stage;
      setReady(true);
    });

    return () => {
      cancelled = true;
      stageRef.current?.destroy();
      stageRef.current = null;
      setReady(false);
    };
  }, [mapId]);

  // Socket connection lifecycle: runs once. Deliberately NOT keyed on mapId —
  // a tab switch or relocation must reuse the same connection, not tear it
  // down (that used to be safe when mapId never changed after mount).
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const id = mapIdRef.current;
      if (id) joinMap(id);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      if (err.message === 'unauthorized') {
        clearToken();
        clearSession();
        void navRef.current({ to: '/login' });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_error', onConnectError);
    socket.on('connect_error', onConnectError);
    socket.on(EV.STATE_SYNC, applyStateSync);
    socket.on(EV.REVEAL_TILES, (p) => {
      if ('newlyVisible' in p) applyReveal(p.revealed, p.newlyVisible);
      else applyReveal(p.revealed);
    });
    socket.on(EV.CONCEAL_TILES, (p) => applyConceal(p.concealed));
    socket.on(EV.TOKEN_ADD, (p) => addToken(p.token));
    socket.on(EV.TOKEN_REMOVE, (p) => removeToken(p.tokenId));
    socket.on(EV.TOKEN_MOVE, (p: TokenMoveBroadcast) => moveToken(p.tokenId, p.x, p.y));
    // The entire player-relocation client story: state_sync (triggered by the
    // join_map that follows) replaces the store wholesale.
    socket.on(EV.MAP_RELOCATED, (p) => setMapId(p.mapId));
    socket.on(EV.SET_LIVE_MAPS, (p) => applyLiveMaps(p.liveMaps));

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_error', onConnectError);
      socket.off(EV.STATE_SYNC);
      socket.off(EV.REVEAL_TILES);
      socket.off(EV.CONCEAL_TILES);
      socket.off(EV.TOKEN_ADD);
      socket.off(EV.TOKEN_REMOVE);
      socket.off(EV.TOKEN_MOVE);
      socket.off(EV.MAP_RELOCATED);
      socket.off(EV.SET_LIVE_MAPS);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-join whenever the selected map changes (GM tab click, or a
  // map_relocated push that called setMapId above). The initial join on
  // mount is handled by the `connect` handler instead, since the socket
  // isn't connected yet when this effect first runs.
  useEffect(() => {
    if (mapId && socket.connected) joinMap(mapId);
  }, [mapId]);

  function joinMap(id: string) {
    socket.emit(EV.JOIN_MAP, { mapId: id }, (ack) => {
      if (!ack.ok) void navRef.current({ to: '/lobby' });
    });
  }

  // Redraw on store change. Skip while a drag is active so the rebuild does not
  // destroy the container being dragged (an incoming delta would otherwise).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready || stage.isDragging) return;
    void stage.drawMap(
      state.gridDims.cols,
      state.gridDims.rows,
      state.grid,
      state.assetPath ? assetUrl(state.assetPath) : null,
    );
    stage.syncTokens(state.tokens.values(), state.grid, state.movable, state.isGM);
    stage.redrawShroud(
      state.revealed,
      state.grid,
      state.gridDims.cols,
      state.gridDims.rows,
      state.isGM,
    );
  }, [version, ready]);

  async function leave() {
    await navigate({ to: '/lobby' });
  }

  function relocateToken(tokenId: string, toMapId: string): Promise<boolean> {
    return new Promise((resolve) => {
      // v1: no target-position picker yet, drop near the map origin; the GM
      // can drag the token further with the existing token_move flow.
      socket.emit(EV.TOKEN_RELOCATE, { tokenId, toMapId, x: 100, y: 100 }, (ack) => {
        if (ack.ok) {
          setMemberTokens((prev) =>
            prev.map((m) => (m.tokenId === tokenId ? { ...m, mapId: toMapId } : m)),
          );
        }
        resolve(ack.ok);
      });
    });
  }

  return (
    <div ref={parentRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      {isGm ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...surface,
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            borderRadius: 0,
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: space.lg,
            height: 48,
            padding: `0 ${space.lg}px`,
            fontSize: 13,
            color: '#e5e7eb',
            zIndex: 10,
          }}
        >
          {/* Identity + status: brand, connection dot, tokens count, leave. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              paddingRight: space.lg,
              borderRight: '1px solid #2a2a3a',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 700 }}>VTT · GM</span>
            <span
              title={connected ? 'connected' : 'connecting…'}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? '#4ade80' : '#6b7280',
                flexShrink: 0,
              }}
            />
            <span style={{ opacity: 0.6, fontSize: 12 }}>tokens: {state.tokens.size}</span>
            <button style={ghostBtn} onClick={leave}>
              Lobby
            </button>
          </div>

          {/* Live map tabs fill the remaining width, scrolling if crowded. */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', overflowX: 'auto' }}>
            <TabBar
              campaignId={campaignId}
              mapId={mapId}
              onSelect={setMapId}
              onRelocateToken={relocateToken}
            />
          </div>

          {/* GM tools: fog toggle (amber = GM-authority state) + library. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['reveal', 'conceal'] as FogMode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)} style={gmToggle(mode === m)}>
                  {m === 'reveal' ? 'Reveal' : 'Conceal'}
                </button>
              ))}
            </div>
            <LibraryDrawer campaignId={campaignId} />
          </div>
        </div>
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: 10,
            left: 10,
            padding: '8px 12px',
            background: 'rgba(20,20,31,0.9)',
            border: '1px solid #2a2a3a',
            borderRadius: 8,
            fontSize: 12,
            color: '#e5e7eb',
            zIndex: 10,
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            VTT · player{' '}
            <button style={chip(false)} onClick={leave}>
              LOBBY
            </button>
          </div>
          <div style={{ opacity: 0.8 }}>
            {connected ? 'connected' : 'connecting…'} · tokens: {state.tokens.size}
          </div>
          <div style={{ opacity: 0.7 }}>drag your own token</div>
        </div>
      )}

      {isGm && <PlayersPanel members={loader.campaign.members} memberTokens={memberTokens} />}

      {mapId === null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
            fontSize: 14,
          }}
        >
          {isGm
            ? 'No live maps yet — add one from the library drawer.'
            : "Your GM hasn't placed you on a map yet."}
        </div>
      )}
    </div>
  );
}

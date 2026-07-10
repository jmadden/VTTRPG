import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { EV, type TokenMoveBroadcast } from '@vtt/shared';
import { PixiStage } from '../game/PixiStage';
import { socket } from '../socket';
import {
  addToken,
  applyConceal,
  applyReveal,
  applyStateSync,
  getVersion,
  moveToken,
  removeToken,
  setIsGM,
  state,
  subscribe,
} from '../store';

// Seeded demo IDs (see backend/db/seed.sql). Switching role rejoins the map as
// the GM or the player, which is how the anti-cheat is visible in-browser:
// the hidden "Lurking Orc" on an unrevealed cell only reaches the GM.
const MAP_ID = '44444444-4444-4444-4444-444444444444';
const USERS = {
  gm: '11111111-1111-1111-1111-111111111111',
  player: '22222222-2222-2222-2222-222222222222',
} as const;

type Role = keyof typeof USERS;
type FogMode = 'reveal' | 'conceal';

export function MapView() {
  const parentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('gm');
  const [mode, setMode] = useState<FogMode>('reveal');
  const [connected, setConnected] = useState(false);
  const roleRef = useRef<Role>(role);
  roleRef.current = role;
  const modeRef = useRef<FogMode>(mode);
  modeRef.current = mode;

  const version = useSyncExternalStore(subscribe, getVersion);

  // Create the Pixi stage once on mount and wire canvas input handlers.
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

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
            socket.emit(EV.REVEAL_TILES, { mapId: MAP_ID, add: [cell] });
          } else {
            if (!state.revealed.has(cell)) return;
            applyConceal([cell]);
            socket.emit(EV.CONCEAL_TILES, { mapId: MAP_ID, remove: [cell] });
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
  }, []);

  // Register socket listeners once; (re)join on connect for the current role.
  useEffect(() => {
    const join = () => {
      setConnected(true);
      socket.emit(EV.JOIN_MAP, { mapId: MAP_ID, userId: USERS[roleRef.current] });
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', join);
    socket.on('disconnect', onDisconnect);
    socket.on(EV.STATE_SYNC, applyStateSync);
    socket.on(EV.REVEAL_TILES, (p) => {
      if ('newlyVisible' in p) applyReveal(p.revealed, p.newlyVisible);
      else applyReveal(p.revealed);
    });
    socket.on(EV.CONCEAL_TILES, (p) => applyConceal(p.concealed));
    socket.on(EV.TOKEN_ADD, (p) => addToken(p.token));
    socket.on(EV.TOKEN_REMOVE, (p) => removeToken(p.tokenId));
    socket.on(EV.TOKEN_MOVE, (p: TokenMoveBroadcast) => moveToken(p.tokenId, p.x, p.y));

    socket.connect();

    return () => {
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off(EV.STATE_SYNC);
      socket.off(EV.REVEAL_TILES);
      socket.off(EV.CONCEAL_TILES);
      socket.off(EV.TOKEN_ADD);
      socket.off(EV.TOKEN_REMOVE);
      socket.off(EV.TOKEN_MOVE);
      socket.disconnect();
    };
  }, []);

  // Reflect the selected role locally (drives shroud alpha + draggability) and
  // rejoin so the server sends a fresh, correctly-filtered snapshot.
  useEffect(() => {
    setIsGM(role === 'gm');
    if (socket.connected) {
      socket.emit(EV.JOIN_MAP, { mapId: MAP_ID, userId: USERS[role] });
    }
  }, [role]);

  // Redraw on store change. Skip while a drag is active so the rebuild does not
  // destroy the container being dragged (an incoming delta would otherwise).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready || stage.isDragging) return;
    stage.drawMapPlaceholder(state.gridDims.cols, state.gridDims.rows, state.grid);
    stage.syncTokens(state.tokens.values(), state.grid, state.movable, state.isGM);
    stage.redrawShroud(
      state.revealed,
      state.grid,
      state.gridDims.cols,
      state.gridDims.rows,
      state.isGM,
    );
  }, [version, ready]);

  const isGM = role === 'gm';

  return (
    <div ref={parentRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      <div
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
        <div style={{ fontWeight: 600, marginBottom: 4 }}>VTT · seeded map</div>
        <div>
          view as:{' '}
          {(['gm', 'player'] as Role[]).map((r) => (
            <button key={r} onClick={() => setRole(r)} style={chip(role === r)}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        {isGM && (
          <div>
            fog tool:{' '}
            {(['reveal', 'conceal'] as FogMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={chip(mode === m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <div style={{ opacity: 0.8 }}>
          {connected ? 'connected' : 'connecting…'} · tokens: {state.tokens.size}
        </div>
        <div style={{ opacity: 0.7 }}>
          {isGM
            ? `drag tokens · click a cell to ${mode}`
            : 'drag your own token'}
        </div>
      </div>
    </div>
  );
}

function chip(active: boolean): CSSProperties {
  return {
    marginRight: 6,
    padding: '2px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid #3a3a4a',
    background: active ? '#4ade80' : '#1a1a24',
    color: active ? '#08130a' : '#e5e7eb',
  };
}

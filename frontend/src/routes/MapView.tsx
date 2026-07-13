import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { EV, type TokenMoveBroadcast } from '@vtt/shared';
import { PixiStage } from '../game/PixiStage';
import { socket } from '../socket';
import { api, clearToken } from '../api';
import {
  addToken,
  applyConceal,
  applyReveal,
  applyStateSync,
  clearSession,
  getVersion,
  moveToken,
  removeToken,
  state,
  subscribe,
} from '../store';
import { chip } from './ui';

type FogMode = 'reveal' | 'conceal';

const routeApi = getRouteApi('/authed/campaign/$campaignId');

export function MapView() {
  const { mapId } = routeApi.useLoaderData();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PixiStage | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<FogMode>('reveal');
  const [connected, setConnected] = useState(false);
  const modeRef = useRef<FogMode>(mode);
  modeRef.current = mode;
  const navRef = useRef(navigate);
  navRef.current = navigate;

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

  // Socket lifecycle: connect (identity is in the handshake auth), join the map,
  // and route out on an auth failure.
  useEffect(() => {
    const join = () => {
      setConnected(true);
      socket.emit(EV.JOIN_MAP, { mapId }, (ack) => {
        if (!ack.ok) void navRef.current({ to: '/lobby' });
      });
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      if (err.message === 'unauthorized') {
        clearToken();
        clearSession();
        void navRef.current({ to: '/login' });
      }
    };

    socket.on('connect', join);
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

    socket.connect();

    return () => {
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_error', onConnectError);
      socket.off(EV.STATE_SYNC);
      socket.off(EV.REVEAL_TILES);
      socket.off(EV.CONCEAL_TILES);
      socket.off(EV.TOKEN_ADD);
      socket.off(EV.TOKEN_REMOVE);
      socket.off(EV.TOKEN_MOVE);
      socket.disconnect();
    };
  }, [mapId]);

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

  async function leave() {
    await navigate({ to: '/lobby' });
  }

  const isGM = state.isGM;

  return (
    <div ref={parentRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
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
          VTT · {isGM ? 'GM' : 'player'}{' '}
          <button style={chip(false)} onClick={leave}>
            LOBBY
          </button>
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
          {isGM ? `drag tokens · click a cell to ${mode}` : 'drag your own token'}
        </div>
      </div>
    </div>
  );
}

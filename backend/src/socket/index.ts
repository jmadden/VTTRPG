// Socket.io wiring: implements the wire contract with the anti-cheat filter as
// the single choke point for every non-GM payload. Server-authoritative.
import type { Server, Socket, DefaultEventsMap } from 'socket.io';
import {
  EV,
  revealedSet,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@vtt/shared';
import {
  filterTokensForClient,
  gatePlayerTokenMove,
  tokensNewlyHidden,
  tokensNewlyVisible,
} from '../lib/visibilityFilter.js';
import {
  addRevealedTiles,
  applySheetUpdate,
  getMapState,
  getOwnedSheetIds,
  getSheetOwner,
  getToken,
  getTokenOwner,
  getTokens,
  getUserRole,
  removeRevealedTiles,
  updateTokenPosition,
} from '../repo.js';

export interface SocketData {
  userId?: string;
  role?: 'gm' | 'player';
  mapId?: string;
}

type VttServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type VttSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

const gmRoom = (mapId: string) => `map:${mapId}:gm`;
const playersRoom = (mapId: string) => `map:${mapId}:players`;

export function registerSocketHandlers(io: VttServer): void {
  io.on('connection', (socket: VttSocket) => {
    socket.on(EV.JOIN_MAP, async ({ mapId, userId }) => {
      try {
        const role = await getUserRole(userId);
        if (!role) return; // unknown user: ignore
        const state = await getMapState(mapId);
        if (!state) return;

        // Leave any previously joined map's rooms so a role/map switch on the
        // same socket does not linger in both rooms.
        if (socket.data.mapId) {
          await socket.leave(gmRoom(socket.data.mapId));
          await socket.leave(playersRoom(socket.data.mapId));
        }

        socket.data.userId = userId;
        socket.data.role = role;
        socket.data.mapId = mapId;
        const isGM = role === 'gm';
        await socket.join(isGM ? gmRoom(mapId) : playersRoom(mapId));

        const tokens = await getTokens(mapId);
        const revealed = revealedSet(state.revealed);

        // Which tokens this client may move: GM = all; player = tokens whose
        // sheet they own. The client uses this to gate dragging.
        let movableTokenIds: string[];
        if (isGM) {
          movableTokenIds = tokens.map((t) => t.id);
        } else {
          const owned = await getOwnedSheetIds(userId);
          movableTokenIds = tokens
            .filter((t) => t.characterSheetId && owned.has(t.characterSheetId))
            .map((t) => t.id);
        }

        socket.emit(EV.STATE_SYNC, {
          mapId,
          gridType: state.gridType,
          gridSize: state.gridSize,
          cols: state.cols,
          rows: state.rows,
          revealed: state.revealed,
          tokens: filterTokensForClient(tokens, revealed, state.grid, isGM),
          movableTokenIds,
        });
      } catch (err) {
        console.error('[socket] join_map failed:', (err as Error).message);
      }
    });

    socket.on(EV.TOKEN_MOVE, async ({ tokenId, x, y }) => {
      try {
        const { userId, role, mapId } = socket.data;
        if (!userId || !role || !mapId) return;

        const token = await getToken(tokenId);
        if (!token || token.mapId !== mapId) return;

        // Authorization: GM, or the player who owns the token's sheet.
        const isGM = role === 'gm';
        if (!isGM) {
          const owner = await getTokenOwner(tokenId);
          if (owner !== userId) return;
        }

        const prevX = token.x;
        const prevY = token.y;
        await updateTokenPosition(tokenId, x, y);

        const state = await getMapState(mapId);
        if (!state) return;
        const revealed = revealedSet(state.revealed);

        // GM room always sees the raw move.
        io.to(gmRoom(mapId)).emit(EV.TOKEN_MOVE, { tokenId, x, y, actorId: userId });

        // Players room: gate on the visibility transition.
        const action = gatePlayerTokenMove({ ...token, x, y }, prevX, prevY, revealed, state.grid);
        const room = io.to(playersRoom(mapId));
        switch (action.kind) {
          case 'move':
            room.emit(EV.TOKEN_MOVE, { tokenId, x, y, actorId: userId });
            break;
          case 'add':
            room.emit(EV.TOKEN_ADD, { token: action.token });
            break;
          case 'remove':
            room.emit(EV.TOKEN_REMOVE, { tokenId: action.tokenId });
            break;
          case 'none':
            break;
        }
      } catch (err) {
        console.error('[socket] token_move failed:', (err as Error).message);
      }
    });

    // GM ONLY.
    socket.on(EV.REVEAL_TILES, async ({ mapId, add }) => {
      try {
        const { role, mapId: joinedMap } = socket.data;
        if (role !== 'gm' || joinedMap !== mapId) return;

        const state = await getMapState(mapId);
        if (!state) return;
        const already = revealedSet(state.revealed);
        const newAdded = add.filter((c) => !already.has(c));
        if (newAdded.length === 0) return;

        await addRevealedTiles(mapId, newAdded);

        // GM room: fog delta only.
        io.to(gmRoom(mapId)).emit(EV.REVEAL_TILES, { mapId, revealed: newAdded });

        // Players room: fog delta plus any hidden tokens it just uncovered.
        const tokens = await getTokens(mapId);
        const newlyVisible = tokensNewlyVisible(tokens, revealedSet(newAdded), state.grid);
        io.to(playersRoom(mapId)).emit(EV.REVEAL_TILES, { mapId, revealed: newAdded, newlyVisible });
      } catch (err) {
        console.error('[socket] reveal_tiles failed:', (err as Error).message);
      }
    });

    // GM ONLY. Paint fog back over cells.
    socket.on(EV.CONCEAL_TILES, async ({ mapId, remove }) => {
      try {
        const { role, mapId: joinedMap } = socket.data;
        if (role !== 'gm' || joinedMap !== mapId) return;

        const state = await getMapState(mapId);
        if (!state) return;
        const revealed = revealedSet(state.revealed);
        const toRemove = remove.filter((c) => revealed.has(c));
        if (toRemove.length === 0) return;

        await removeRevealedTiles(mapId, toRemove);

        // Both rooms redraw fog over the concealed cells.
        io.to(gmRoom(mapId)).emit(EV.CONCEAL_TILES, { mapId, concealed: toRemove });
        io.to(playersRoom(mapId)).emit(EV.CONCEAL_TILES, { mapId, concealed: toRemove });

        // Players lose any hidden token that just went back under fog.
        const tokens = await getTokens(mapId);
        const nowHidden = tokensNewlyHidden(tokens, revealedSet(toRemove), state.grid);
        for (const t of nowHidden) {
          io.to(playersRoom(mapId)).emit(EV.TOKEN_REMOVE, { tokenId: t.id });
        }
      } catch (err) {
        console.error('[socket] conceal_tiles failed:', (err as Error).message);
      }
    });

    socket.on(EV.SHEET_UPDATE, async ({ sheetId, path, value }) => {
      try {
        const { userId, role, mapId } = socket.data;
        if (!userId || !role || !mapId) return;

        // Authorization: GM, or the sheet's owner.
        if (role !== 'gm') {
          const owner = await getSheetOwner(sheetId);
          if (owner !== userId) return;
        }

        await applySheetUpdate(sheetId, path, value);
        io.to(gmRoom(mapId)).to(playersRoom(mapId)).emit(EV.SHEET_UPDATE, { sheetId, path, value });
      } catch (err) {
        console.error('[socket] sheet_update failed:', (err as Error).message);
      }
    });
  });
}

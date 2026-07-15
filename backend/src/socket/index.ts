// Socket.io wiring: implements the wire contract with the anti-cheat filter as
// the single choke point for every non-GM payload. Server-authoritative.
import type { Server, Socket, DefaultEventsMap } from 'socket.io';
import {
  EV,
  revealedSet,
  type ClientToServerEvents,
  type LiveMapEntry,
  type ServerToClientEvents,
} from '@vtt/shared';
import {
  filterTokensForClient,
  gatePlayerTokenMove,
  isVisibleToPlayers,
  stripGMFields,
  tokensNewlyHidden,
  tokensNewlyVisible,
} from '../lib/visibilityFilter.js';
import { normalizePositions } from '../lib/liveMaps.js';
import {
  addRevealedTiles,
  applySheetUpdate,
  getCampaignForMap,
  getMapState,
  getOwnedSheetIds,
  getSessionUser,
  getSheetOwner,
  getToken,
  getTokenOwner,
  getTokens,
  isCampaignGm,
  isCampaignMember,
  isMapLive,
  removeRevealedTiles,
  setLiveMaps,
  touchSession,
  updateTokenMap,
  updateTokenPosition,
} from '../repo.js';
import { sha256 } from '../auth.js';

export interface SocketData {
  userId?: string;
  role?: 'gm' | 'player';
  mapId?: string;
}

type VttServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type VttSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

const gmRoom = (mapId: string) => `map:${mapId}:gm`;
const playersRoom = (mapId: string) => `map:${mapId}:players`;
// Reached at connection time from the authenticated userId, independent of
// which map (if any) the socket has joined. Lets set_live_maps broadcasts and
// map_relocated pushes reach every open tab/device for the same user.
const userRoom = (userId: string) => `user:${userId}`;

export function registerSocketHandlers(io: VttServer): void {
  // Handshake auth: establish identity once per socket from the session token,
  // before any event handler runs. `userId` no longer travels in join_map.
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) return next(new Error('unauthorized'));
      const tokenHash = sha256(token);
      const user = await getSessionUser(tokenHash);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = user.id;
      void touchSession(tokenHash);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: VttSocket) => {
    // Join this user's own room right away, before any event handler runs, so
    // set_live_maps / map_relocated pushes can reach this socket regardless
    // of whether (or which map) it has joined yet.
    void socket.join(userRoom(socket.data.userId!));

    socket.on(EV.JOIN_MAP, async ({ mapId }, ack) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return ack?.({ ok: false, reason: 'unauthorized' });

        const campaign = await getCampaignForMap(mapId);
        if (!campaign) return ack?.({ ok: false, reason: 'not_found' });
        if (!(await isCampaignMember(campaign.campaignId, userId))) {
          return ack?.({ ok: false, reason: 'not_member' });
        }
        const state = await getMapState(mapId);
        if (!state) return ack?.({ ok: false, reason: 'not_found' });

        // Role is derived per campaign: the campaign's GM, else a player.
        const role: 'gm' | 'player' = userId === campaign.gmUserId ? 'gm' : 'player';

        // Leave any previously joined map's rooms so a map switch on the same
        // socket does not linger in both rooms.
        if (socket.data.mapId) {
          await socket.leave(gmRoom(socket.data.mapId));
          await socket.leave(playersRoom(socket.data.mapId));
        }

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
          assetPath: state.assetPath,
          cols: state.cols,
          rows: state.rows,
          revealed: state.revealed,
          tokens: filterTokensForClient(tokens, revealed, state.grid, isGM),
          movableTokenIds,
          role,
          userId,
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error('[socket] join_map failed:', (err as Error).message);
        ack?.({ ok: false, reason: 'not_found' });
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

    // GM ONLY. Client always sends the full ordered live-tab list; the server
    // rewrites campaign_live_maps to match. Broadcasts to the GM's own
    // user:<id> room, so every open tab/device for that GM stays in sync —
    // including the sender (no separate optimistic-update path needed).
    socket.on(EV.SET_LIVE_MAPS, async ({ campaignId, liveMaps }, ack) => {
      try {
        const userId = socket.data.userId;
        if (!userId) return ack?.({ ok: false, reason: 'unauthorized' });
        if (!(await isCampaignGm(campaignId, userId))) {
          return ack?.({ ok: false, reason: 'not_gm' });
        }

        // Note: removing a live tab while a player's token still points at
        // that map is allowed with no guard (v1) — the token's map still
        // exists in the library, nothing breaks.
        const normalized = normalizePositions(liveMaps);
        const saved: LiveMapEntry[] = await setLiveMaps(campaignId, normalized);

        io.to(userRoom(userId)).emit(EV.SET_LIVE_MAPS, { campaignId, liveMaps: saved });
        ack?.({ ok: true, liveMaps: saved });
      } catch (err) {
        console.error('[socket] set_live_maps failed:', (err as Error).message);
        ack?.({ ok: false, reason: 'unauthorized' });
      }
    });

    // GM ONLY. Cross-map move of an existing token — distinct from token_move
    // (which stays "move within the map you're joined to"). Reassigns the
    // token's map_id, fans out token_remove/token_add to both maps' rooms
    // (gated by the destination map's fog for its players room), and pushes
    // map_relocated to the token owner's user room so their client re-joins.
    socket.on(EV.TOKEN_RELOCATE, async ({ tokenId, toMapId, x, y }, ack) => {
      try {
        const userId = socket.data.userId;
        if (!userId || socket.data.role !== 'gm') {
          return ack?.({ ok: false, reason: 'unauthorized' });
        }

        const token = await getToken(tokenId);
        if (!token) return ack?.({ ok: false, reason: 'not_found' });

        const sourceCampaign = await getCampaignForMap(token.mapId);
        if (!sourceCampaign || sourceCampaign.gmUserId !== userId) {
          return ack?.({ ok: false, reason: 'unauthorized' });
        }

        const targetCampaign = await getCampaignForMap(toMapId);
        if (!targetCampaign || targetCampaign.campaignId !== sourceCampaign.campaignId) {
          return ack?.({ ok: false, reason: 'not_found' });
        }
        if (!(await isMapLive(sourceCampaign.campaignId, toMapId))) {
          return ack?.({ ok: false, reason: 'not_live' });
        }

        const fromMapId = token.mapId;
        await updateTokenMap(tokenId, toMapId, x, y);

        // Old map: both rooms lose the token entirely.
        io.to(gmRoom(fromMapId)).to(playersRoom(fromMapId)).emit(EV.TOKEN_REMOVE, { tokenId });

        // New map: GM room always gets the raw token; players room only if the
        // destination map's fog currently makes it visible (anti-cheat holds
        // across the relocation, same as any other move).
        const relocated = { ...token, mapId: toMapId, x, y };
        io.to(gmRoom(toMapId)).emit(EV.TOKEN_ADD, { token: stripGMFields(relocated) });

        const newState = await getMapState(toMapId);
        if (newState) {
          const revealed = revealedSet(newState.revealed);
          if (isVisibleToPlayers(relocated, revealed, newState.grid)) {
            io.to(playersRoom(toMapId)).emit(EV.TOKEN_ADD, { token: stripGMFields(relocated) });
          }
        }

        // Tell the relocated player's socket(s) to load the new map. The
        // existing join_map/state_sync path takes it from here.
        const ownerId = await getTokenOwner(tokenId);
        if (ownerId) io.to(userRoom(ownerId)).emit(EV.MAP_RELOCATED, { mapId: toMapId });

        ack?.({ ok: true });
      } catch (err) {
        console.error('[socket] token_relocate failed:', (err as Error).message);
        ack?.({ ok: false, reason: 'not_found' });
      }
    });
  });
}

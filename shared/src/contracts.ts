// ============================================================================
// contracts.ts — the WebSocket wire protocol. SINGLE SOURCE OF TRUTH.
//
// Both @vtt/backend and @vtt/frontend import these types. Payloads are tiny
// JSON deltas, never full-state dumps. Server-authoritative: the backend owns
// the truth and gates every non-GM payload through the visibility filter.
//
// Room model: per map the server keeps a `gm` room (raw) and a `players` room
// (gated). `revealed_tiles` is map-level, so all players share one visibility
// view — the only audience split is GM-vs-players.
// ============================================================================

import type { CellKey } from './coords.js';

// ── Domain shapes ───────────────────────────────────────────────────────────

export type TokenType = 'player' | 'monster' | 'prop';

/** Full token as stored server-side. GM-only fields (e.g. `hidden`) are
 *  stripped before a token reaches the players room — see ClientToken. */
export interface Token {
  id: string;
  mapId: string;
  characterSheetId: string | null;
  name: string;
  type: TokenType;
  x: number;
  y: number;
  hidden: boolean;
}

/** Token shape sent to non-GM clients (GM-only fields removed). */
export type ClientToken = Omit<Token, 'hidden'>;

// ── Event name constants ─────────────────────────────────────────────────────

export const EV = {
  // client → server
  TOKEN_MOVE: 'token_move',
  REVEAL_TILES: 'reveal_tiles',
  CONCEAL_TILES: 'conceal_tiles',
  SHEET_UPDATE: 'sheet_update',
  JOIN_MAP: 'join_map',
  // server → client
  STATE_SYNC: 'state_sync',
  TOKEN_ADD: 'token_add',
  TOKEN_REMOVE: 'token_remove',
} as const;

// ── token_move ────────────────────────────────────────────────────────────
// Client → server: a bare position delta.
export interface TokenMoveRequest {
  tokenId: string;
  x: number;
  y: number;
}
// Server broadcast (both rooms, for visible tokens): adds who moved it.
export interface TokenMoveBroadcast {
  tokenId: string;
  x: number;
  y: number;
  actorId: string;
}

// ── reveal_tiles (GM ONLY) ──────────────────────────────────────────────────
// Client → server: cell keys the GM manually uncovered. Server validates that
// the sender is the GM before applying; ignored otherwise.
export interface RevealTilesRequest {
  mapId: string;
  add: CellKey[];
}
// Server → GM room: just the newly revealed cells.
export interface RevealTilesBroadcastGM {
  mapId: string;
  revealed: CellKey[];
}
// Server → players room: revealed cells PLUS any hidden tokens that those
// cells just uncovered, so players see the monster without a full resync.
export interface RevealTilesBroadcastPlayers {
  mapId: string;
  revealed: CellKey[];
  newlyVisible: ClientToken[];
}

// ── conceal_tiles (GM ONLY) ─────────────────────────────────────────────────
// The inverse of reveal_tiles: the GM paints fog back over cells.
// Client → server: cells to re-hide.
export interface ConcealTilesRequest {
  mapId: string;
  remove: CellKey[];
}
// Server → both rooms: the cells that were concealed (delta). Players
// additionally receive a token_remove for any hidden token those cells re-hid.
export interface ConcealTilesBroadcast {
  mapId: string;
  concealed: CellKey[];
}

// ── token_add / token_remove (server → players room only) ───────────────────
// Emitted when a hidden token crosses the visibility boundary via token_move.
export interface TokenAddBroadcast {
  token: ClientToken;
}
export interface TokenRemoveBroadcast {
  tokenId: string;
}

// ── state_sync (server → client on join) ────────────────────────────────────
// Initial snapshot, already filtered for the joining client's role.
export interface StateSyncPayload {
  mapId: string;
  gridType: 'square' | 'hex';
  gridSize: number;
  cols: number;
  rows: number;
  revealed: CellKey[];
  tokens: ClientToken[]; // GM receives full tokens cast to this shape too
  // Ids of tokens this client may move (GM: all; player: tokens they own).
  // Point-in-time snapshot; the UI uses it to decide draggability.
  movableTokenIds: string[];
}

// ── sheet_update ────────────────────────────────────────────────────────────
// Client → server AND server broadcast: one nested attribute path in a sheet.
// `path` maps directly to a Postgres jsonb_set text[] path.
export interface SheetUpdatePayload {
  sheetId: string;
  path: string[];
  value: unknown;
}

// ── join_map (client → server) ──────────────────────────────────────────────
export interface JoinMapRequest {
  mapId: string;
  userId: string;
}

// ── Typed event maps for socket.io generics (build-phase convenience) ────────

export interface ClientToServerEvents {
  [EV.JOIN_MAP]: (p: JoinMapRequest) => void;
  [EV.TOKEN_MOVE]: (p: TokenMoveRequest) => void;
  [EV.REVEAL_TILES]: (p: RevealTilesRequest) => void;
  [EV.CONCEAL_TILES]: (p: ConcealTilesRequest) => void;
  [EV.SHEET_UPDATE]: (p: SheetUpdatePayload) => void;
}

export interface ServerToClientEvents {
  [EV.STATE_SYNC]: (p: StateSyncPayload) => void;
  [EV.TOKEN_MOVE]: (p: TokenMoveBroadcast) => void;
  [EV.REVEAL_TILES]: (p: RevealTilesBroadcastGM | RevealTilesBroadcastPlayers) => void;
  [EV.CONCEAL_TILES]: (p: ConcealTilesBroadcast) => void;
  [EV.TOKEN_ADD]: (p: TokenAddBroadcast) => void;
  [EV.TOKEN_REMOVE]: (p: TokenRemoveBroadcast) => void;
  [EV.SHEET_UPDATE]: (p: SheetUpdatePayload) => void;
}

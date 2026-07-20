// Data access layer: hand-written SQL mapped to the shared domain types.
import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import type {
  AuthUser,
  CampaignDetail,
  CampaignSummary,
  CellKey,
  EligibleSheetDto,
  GameDetail,
  GameMemberDto,
  GameSummary,
  Grid,
  LiveMapEntry,
  MapSummary,
  MapTemplateSummary,
  MemberTokenDto,
  Token,
  TokenType,
} from '@vtt/shared';

export interface MapState {
  mapId: string;
  grid: Grid;
  gridType: 'square' | 'hex';
  gridSize: number;
  assetPath: string;
  cols: number;
  rows: number;
  revealed: CellKey[];
}

interface MapRow {
  grid_type: 'square' | 'hex';
  grid_size: number;
  asset_path: string;
  cols: number;
  rows: number;
  revealed_tiles: CellKey[];
}

interface TokenRow {
  id: string;
  map_id: string;
  character_sheet_id: string | null;
  name: string;
  type: TokenType;
  x: number;
  y: number;
  hidden: boolean;
}

function toToken(r: TokenRow): Token {
  return {
    id: r.id,
    mapId: r.map_id,
    characterSheetId: r.character_sheet_id,
    name: r.name,
    type: r.type,
    x: r.x,
    y: r.y,
    hidden: r.hidden,
  };
}

// ── users / sessions ────────────────────────────────────────────────────────

export async function createUser(displayName: string, pinHash: string): Promise<AuthUser> {
  const res = await query<{ id: string; display_name: string }>(
    'INSERT INTO users (display_name, pin_hash) VALUES ($1, $2) RETURNING id, display_name',
    [displayName, pinHash],
  );
  const r = res.rows[0]!;
  return { id: r.id, displayName: r.display_name };
}

export async function getUserByName(
  displayName: string,
): Promise<{ id: string; displayName: string; pinHash: string } | null> {
  const res = await query<{ id: string; display_name: string; pin_hash: string }>(
    'SELECT id, display_name, pin_hash FROM users WHERE lower(display_name) = lower($1)',
    [displayName],
  );
  const r = res.rows[0];
  return r ? { id: r.id, displayName: r.display_name, pinHash: r.pin_hash } : null;
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const res = await query<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM users WHERE id = $1',
    [userId],
  );
  const r = res.rows[0];
  return r ? { id: r.id, displayName: r.display_name } : null;
}

export async function createSession(tokenHash: string, userId: string): Promise<void> {
  await query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [tokenHash, userId]);
}

export async function getSessionUser(tokenHash: string): Promise<AuthUser | null> {
  const res = await query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const r = res.rows[0];
  return r ? { id: r.id, displayName: r.display_name } : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function touchSession(tokenHash: string): Promise<void> {
  await query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
}

// ── games (docs/12) ──────────────────────────────────────────────────────

interface GameRow {
  id: string;
  name: string;
  description: string | null;
  join_code: string;
  campaign_count: string;
  member_count: string;
}

function toGameSummary(row: GameRow): GameSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    campaignCount: Number(row.campaign_count),
    memberCount: Number(row.member_count),
    joinCode: row.join_code,
  };
}

/** Create a Game, generating its standing-roster join code. */
export async function createGame(
  userId: string,
  name: string,
  description?: string,
): Promise<GameSummary> {
  const joinCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const res = await query<GameRow>(
    `INSERT INTO games (gm_user_id, name, description, join_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, join_code, 0 AS campaign_count, 0 AS member_count`,
    [userId, name, description ?? null, joinCode],
  );
  return toGameSummary(res.rows[0]!);
}

/** List every Game the user GMs (Player-facing "my Games" is out of scope, docs/12 §9). */
export async function listGames(userId: string): Promise<GameSummary[]> {
  const res = await query<GameRow>(
    `SELECT g.id, g.name, g.description, g.join_code,
            (SELECT count(*) FROM campaigns c WHERE c.game_id = g.id) AS campaign_count,
            (SELECT count(*) FROM game_members gm WHERE gm.game_id = g.id) AS member_count
       FROM games g
      WHERE g.gm_user_id = $1
      ORDER BY g.created_at`,
    [userId],
  );
  return res.rows.map(toGameSummary);
}

/** Is this user the GM of this Game? (Game-keyed authz, mirrors isCampaignGm) */
export async function isGameGm(gameId: string, userId: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM games WHERE id = $1 AND gm_user_id = $2', [
    gameId,
    userId,
  ]);
  return res.rows.length > 0;
}

/** Join a Game's standing roster by its join_code (docs/12 §5). */
export async function joinGame(
  userId: string,
  gameId: string,
  joinCode: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'bad_code' }> {
  const g = await query<{ id: string; join_code: string }>('SELECT id, join_code FROM games WHERE id = $1', [
    gameId,
  ]);
  const row = g.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.join_code !== joinCode) return { ok: false, reason: 'bad_code' };
  await query('INSERT INTO game_members (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    gameId,
    userId,
  ]);
  return { ok: true };
}

/** Every Game-level roster member with their persistent character sheet, if any. */
export async function listGameMembers(gameId: string): Promise<GameMemberDto[]> {
  const res = await query<{ user_id: string; display_name: string; character_sheet_id: string | null }>(
    `SELECT gm.user_id, u.display_name, gm.character_sheet_id
       FROM game_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.game_id = $1
      ORDER BY gm.joined_at`,
    [gameId],
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    characterSheetId: r.character_sheet_id,
  }));
}

/** Campaign summaries scoped to one Game (same shape as listCampaigns, just
 *  filtered by game_id instead of "every campaign the user can see"). */
async function listCampaignsForGame(gameId: string, userId: string): Promise<CampaignSummary[]> {
  const res = await query<{
    id: string;
    name: string;
    gm_name: string;
    member_count: string;
    is_member: boolean;
    is_gm: boolean;
    status: CampaignSummary['status'];
  }>(
    `SELECT c.id, c.name, c.status,
            gm.display_name AS gm_name,
            (SELECT count(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS member_count,
            EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = $2) AS is_member,
            (c.gm_user_id = $2) AS is_gm
       FROM campaigns c JOIN users gm ON gm.id = c.gm_user_id
      WHERE c.game_id = $1
      ORDER BY c.created_at`,
    [gameId, userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    gmName: r.gm_name,
    memberCount: Number(r.member_count),
    isMember: r.is_member,
    isGm: r.is_gm,
    status: r.status,
  }));
}

/** Upload a template into a Game's Map Library. */
export async function createMapTemplate(
  gameId: string,
  m: { name: string; assetPath: string; gridType: 'square' | 'hex'; gridSize: number; cols: number; rows: number },
): Promise<MapTemplateSummary> {
  const res = await query<{ id: string }>(
    `INSERT INTO map_templates (game_id, name, asset_path, grid_type, grid_size, cols, rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [gameId, m.name, m.assetPath, m.gridType, m.gridSize, m.cols, m.rows],
  );
  return { id: res.rows[0]!.id, gameId, ...m };
}

/** Map Library for a Game. */
export async function listMapTemplates(gameId: string): Promise<MapTemplateSummary[]> {
  const res = await query<{
    id: string;
    game_id: string;
    name: string;
    asset_path: string;
    grid_type: 'square' | 'hex';
    grid_size: number;
    cols: number;
    rows: number;
  }>(
    `SELECT id, game_id, name, asset_path, grid_type, grid_size, cols, rows
       FROM map_templates WHERE game_id = $1 ORDER BY created_at`,
    [gameId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    gameId: r.game_id,
    name: r.name,
    assetPath: r.asset_path,
    gridType: r.grid_type,
    gridSize: r.grid_size,
    cols: r.cols,
    rows: r.rows,
  }));
}

/** Sheets a Roster member could attach: theirs, from a campaign under this
 *  Game (docs/12 §6: "attach their existing sheet from the Roster tab"). */
export async function listEligibleSheets(gameId: string, userId: string): Promise<EligibleSheetDto[]> {
  const res = await query<{ id: string; name: string }>(
    `SELECT cs.id, cs.name
       FROM character_sheets cs JOIN campaigns c ON c.id = cs.campaign_id
      WHERE cs.owner_user_id = $2 AND c.game_id = $1
      ORDER BY cs.created_at`,
    [gameId, userId],
  );
  return res.rows;
}

/** Attach (or clear, characterSheetId=null) a roster member's persistent
 *  character sheet reference. The sheet must be owned by that user and come
 *  from a campaign under this same Game. */
export async function setGameMemberSheet(
  gameId: string,
  userId: string,
  characterSheetId: string | null,
): Promise<{ ok: true } | { ok: false; reason: 'not_member' | 'invalid_sheet' }> {
  const member = await query('SELECT 1 FROM game_members WHERE game_id = $1 AND user_id = $2', [
    gameId,
    userId,
  ]);
  if (member.rows.length === 0) return { ok: false, reason: 'not_member' };
  if (characterSheetId !== null) {
    const sheet = await query(
      `SELECT 1 FROM character_sheets cs
         JOIN campaigns c ON c.id = cs.campaign_id
        WHERE cs.id = $1 AND cs.owner_user_id = $2 AND c.game_id = $3`,
      [characterSheetId, userId, gameId],
    );
    if (sheet.rows.length === 0) return { ok: false, reason: 'invalid_sheet' };
  }
  await query('UPDATE game_members SET character_sheet_id = $3 WHERE game_id = $1 AND user_id = $2', [
    gameId,
    userId,
    characterSheetId,
  ]);
  return { ok: true };
}

/** Assembles the full Game detail: campaigns, roster, and (until the Map
 *  Library is wired in) an empty template list. */
export async function getGameDetail(gameId: string, userId: string): Promise<GameDetail | null> {
  const games = await listGames(userId);
  const game = games.find((g) => g.id === gameId);
  if (!game) return null;

  const campaigns = await listCampaignsForGame(gameId, userId);
  const mapTemplates = await listMapTemplates(gameId);
  const members = await listGameMembers(gameId);

  return { ...game, campaigns, mapTemplates, members };
}

// ── campaigns / membership ────────────────────────────────────────────────

export async function listCampaigns(userId: string): Promise<CampaignSummary[]> {
  const res = await query<{
    id: string;
    name: string;
    gm_name: string;
    member_count: string;
    is_member: boolean;
    is_gm: boolean;
    status: CampaignSummary['status'];
  }>(
    `SELECT c.id, c.name, c.status,
            gm.display_name AS gm_name,
            (SELECT count(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS member_count,
            EXISTS(SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = $1) AS is_member,
            (c.gm_user_id = $1) AS is_gm
       FROM campaigns c JOIN users gm ON gm.id = c.gm_user_id
      ORDER BY c.created_at`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    gmName: r.gm_name,
    memberCount: Number(r.member_count),
    isMember: r.is_member,
    isGm: r.is_gm,
    status: r.status,
  }));
}

/** Insert the campaign (under a required Game) and the creator's GM member
 *  row atomically (CTE). `templateIds` are copy-on-assigned into fresh
 *  game_maps rows (docs/12: never a shared reference — fog/tokens are
 *  inherently per-playthrough); a foreign template (from a different Game)
 *  is silently dropped by the game_id match in the WHERE clause. */
export async function createCampaign(
  userId: string,
  gameId: string,
  name: string,
  joinCode: string | null,
  templateIds: string[] = [],
  memberUserIds: string[] = [],
): Promise<CampaignDetail> {
  const res = await query<{ id: string }>(
    `WITH c AS (
       INSERT INTO campaigns (name, gm_user_id, join_code, game_id)
       VALUES ($1, $2, $3, $4) RETURNING id, gm_user_id
     ), m AS (
       INSERT INTO campaign_members (campaign_id, user_id) SELECT id, gm_user_id FROM c
     )
     SELECT id FROM c`,
    [name, userId, joinCode, gameId],
  );
  const campaignId = res.rows[0]!.id;

  if (templateIds.length > 0) {
    await query(
      `INSERT INTO game_maps (campaign_id, name, asset_path, grid_type, grid_size, cols, rows, template_id)
       SELECT $1, name, asset_path, grid_type, grid_size, cols, rows, id
         FROM map_templates
        WHERE id = ANY($2::uuid[]) AND game_id = $3`,
      [campaignId, templateIds, gameId],
    );
  }

  if (memberUserIds.length > 0) {
    // game_id = $2 scopes to this Game's roster -- a non-roster id is
    // silently dropped, same precedent as the template copy above.
    await query(
      `INSERT INTO campaign_members (campaign_id, user_id)
       SELECT $1, gm.user_id FROM game_members gm
        WHERE gm.game_id = $2 AND gm.user_id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`,
      [campaignId, gameId, memberUserIds],
    );
  }

  // Creator is the GM, so they're the viewer for the detail returned here.
  return (await getCampaignDetail(campaignId, userId))!;
}

export async function joinCampaign(
  userId: string,
  campaignId: string,
  joinCode: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'bad_code' }> {
  const c = await query<{ id: string; join_code: string | null }>(
    'SELECT id, join_code FROM campaigns WHERE id = $1',
    [campaignId],
  );
  const row = c.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.join_code && row.join_code !== joinCode) return { ok: false, reason: 'bad_code' };
  await query(
    'INSERT INTO campaign_members (campaign_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [campaignId, userId],
  );
  return { ok: true };
}

/**
 * Full campaign detail, computed per-viewer:
 * - `liveMaps`: the GM's ordered live tabs.
 * - `viewerMapId`: the map the viewer's own token currently sits on (v1: one
 *   PC token per player is the load anchor — docs/11 §2/§10), or null if
 *   unplaced (or the viewer has no token, e.g. the GM).
 * - `memberTokens`: GM-only — every member's current token/map, for the
 *   Players Panel. Empty for non-GM viewers.
 */
export async function getCampaignDetail(
  campaignId: string,
  viewerUserId: string,
): Promise<CampaignDetail | null> {
  const c = await query<{ id: string; name: string; gm_user_id: string; status: CampaignSummary['status'] }>(
    'SELECT id, name, gm_user_id, status FROM campaigns WHERE id = $1',
    [campaignId],
  );
  const row = c.rows[0];
  if (!row) return null;

  const m = await query<{ id: string; display_name: string; is_gm: boolean }>(
    `SELECT u.id, u.display_name, (u.id = $2) AS is_gm
       FROM campaign_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.campaign_id = $1
      ORDER BY cm.joined_at`,
    [campaignId, row.gm_user_id],
  );

  const liveMaps = await listLiveMaps(campaignId);

  const viewerTok = await query<{ map_id: string }>(
    `SELECT t.map_id
       FROM tokens t JOIN character_sheets cs ON cs.id = t.character_sheet_id
      WHERE cs.campaign_id = $1 AND cs.owner_user_id = $2
      LIMIT 1`,
    [campaignId, viewerUserId],
  );
  const viewerMapId = viewerTok.rows[0]?.map_id ?? null;

  let memberTokens: MemberTokenDto[] = [];
  const isGmViewer = viewerUserId === row.gm_user_id;
  if (isGmViewer) {
    const mt = await query<{ user_id: string; token_id: string; map_id: string }>(
      `SELECT cs.owner_user_id AS user_id, t.id AS token_id, t.map_id
         FROM character_sheets cs JOIN tokens t ON t.character_sheet_id = cs.id
        WHERE cs.campaign_id = $1`,
      [campaignId],
    );
    memberTokens = mt.rows.map((r) => ({ userId: r.user_id, tokenId: r.token_id, mapId: r.map_id }));
  }

  return {
    id: row.id,
    name: row.name,
    gmUserId: row.gm_user_id,
    status: row.status,
    members: m.rows.map((r) => ({ id: r.id, displayName: r.display_name, isGm: r.is_gm })),
    liveMaps,
    viewerMapId,
    memberTokens,
  };
}

export async function getCampaignForMap(
  mapId: string,
): Promise<{ campaignId: string; gmUserId: string } | null> {
  const res = await query<{ campaign_id: string; gm_user_id: string }>(
    `SELECT c.id AS campaign_id, c.gm_user_id
       FROM game_maps gm JOIN campaigns c ON c.id = gm.campaign_id
      WHERE gm.id = $1`,
    [mapId],
  );
  const r = res.rows[0];
  return r ? { campaignId: r.campaign_id, gmUserId: r.gm_user_id } : null;
}

export async function isCampaignMember(campaignId: string, userId: string): Promise<boolean> {
  const res = await query(
    'SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND user_id = $2',
    [campaignId, userId],
  );
  return res.rows.length > 0;
}

/** Is this user the GM of this campaign? (campaign-keyed authz for map routes) */
export async function isCampaignGm(campaignId: string, userId: string): Promise<boolean> {
  const res = await query(
    'SELECT 1 FROM campaigns WHERE id = $1 AND gm_user_id = $2',
    [campaignId, userId],
  );
  return res.rows.length > 0;
}

export async function getMapState(mapId: string): Promise<MapState | null> {
  const res = await query<MapRow>(
    `SELECT grid_type, grid_size, asset_path, cols, rows, revealed_tiles
       FROM game_maps WHERE id = $1`,
    [mapId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    mapId,
    grid: { type: row.grid_type, size: row.grid_size },
    gridType: row.grid_type,
    gridSize: row.grid_size,
    assetPath: row.asset_path,
    cols: row.cols,
    rows: row.rows,
    revealed: row.revealed_tiles,
  };
}

// ── map library (Phase 1a) ────────────────────────────────────────────────

export async function createMap(
  campaignId: string,
  m: {
    name: string;
    assetPath: string;
    gridType: 'square' | 'hex';
    gridSize: number;
    cols: number;
    rows: number;
  },
): Promise<MapSummary> {
  const res = await query<{ id: string }>(
    `INSERT INTO game_maps (campaign_id, name, asset_path, grid_type, grid_size, cols, rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [campaignId, m.name, m.assetPath, m.gridType, m.gridSize, m.cols, m.rows],
  );
  return { id: res.rows[0]!.id, ...m };
}

export async function listMapsForCampaign(campaignId: string): Promise<MapSummary[]> {
  const res = await query<{
    id: string;
    name: string;
    asset_path: string;
    grid_type: 'square' | 'hex';
    grid_size: number;
    cols: number;
    rows: number;
  }>(
    `SELECT id, name, asset_path, grid_type, grid_size, cols, rows
       FROM game_maps WHERE campaign_id = $1 ORDER BY created_at`,
    [campaignId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    assetPath: r.asset_path,
    gridType: r.grid_type,
    gridSize: r.grid_size,
    cols: r.cols,
    rows: r.rows,
  }));
}

// ── live map tabs (gm-maps-1b) ────────────────────────────────────────────

export async function listLiveMaps(campaignId: string): Promise<LiveMapEntry[]> {
  const res = await query<{ map_id: string; title: string; position: number }>(
    `SELECT map_id, title, position FROM campaign_live_maps
      WHERE campaign_id = $1 ORDER BY position`,
    [campaignId],
  );
  return res.rows.map((r) => ({ mapId: r.map_id, title: r.title, position: r.position }));
}

/**
 * Rewrite campaign_live_maps to exactly match `entries` in one atomic
 * statement: deletes rows not in the incoming list, upserts the rest, and
 * silently drops any map_id that doesn't belong to campaignId (join against
 * game_maps). Caller (the socket handler) normalizes positions/dedupes first.
 */
export async function setLiveMaps(
  campaignId: string,
  entries: readonly LiveMapEntry[],
): Promise<LiveMapEntry[]> {
  const payload = JSON.stringify(
    entries.map((e) => ({ map_id: e.mapId, title: e.title, position: e.position })),
  );
  const res = await query<{ map_id: string; title: string; position: number }>(
    `WITH valid AS (
       SELECT e.map_id, e.title, e.position
         FROM jsonb_to_recordset($2::jsonb) AS e(map_id uuid, title text, position int)
         JOIN game_maps gm ON gm.id = e.map_id AND gm.campaign_id = $1
     ),
     del AS (
       DELETE FROM campaign_live_maps
        WHERE campaign_id = $1
          AND map_id NOT IN (SELECT map_id FROM valid)
     ),
     ins AS (
       INSERT INTO campaign_live_maps (campaign_id, map_id, position, title)
       SELECT $1, map_id, position, title FROM valid
       ON CONFLICT (campaign_id, map_id) DO UPDATE
         SET position = EXCLUDED.position, title = EXCLUDED.title
     )
     SELECT map_id, title, position FROM valid ORDER BY position`,
    [campaignId, payload],
  );
  return res.rows.map((r) => ({ mapId: r.map_id, title: r.title, position: r.position }));
}

/** Is this map one of the campaign's current live tabs? Enforced by token_relocate. */
export async function isMapLive(campaignId: string, mapId: string): Promise<boolean> {
  const res = await query(
    'SELECT 1 FROM campaign_live_maps WHERE campaign_id = $1 AND map_id = $2',
    [campaignId, mapId],
  );
  return res.rows.length > 0;
}

/** Cross-map token move: reassigns map_id in addition to x/y (token_relocate). */
export async function updateTokenMap(
  tokenId: string,
  mapId: string,
  x: number,
  y: number,
): Promise<void> {
  await query('UPDATE tokens SET map_id = $2, x = $3, y = $4 WHERE id = $1', [
    tokenId,
    mapId,
    x,
    y,
  ]);
}

export async function getTokens(mapId: string): Promise<Token[]> {
  const res = await query<TokenRow>(
    `SELECT id, map_id, character_sheet_id, name, type, x, y, hidden
       FROM tokens WHERE map_id = $1`,
    [mapId],
  );
  return res.rows.map(toToken);
}

export async function getToken(tokenId: string): Promise<Token | null> {
  const res = await query<TokenRow>(
    `SELECT id, map_id, character_sheet_id, name, type, x, y, hidden
       FROM tokens WHERE id = $1`,
    [tokenId],
  );
  const row = res.rows[0];
  return row ? toToken(row) : null;
}

export async function updateTokenPosition(
  tokenId: string,
  x: number,
  y: number,
): Promise<void> {
  await query('UPDATE tokens SET x = $2, y = $3 WHERE id = $1', [tokenId, x, y]);
}

/** Merge `add` into revealed_tiles (deduped) and return the current full set. */
export async function addRevealedTiles(
  mapId: string,
  add: CellKey[],
): Promise<void> {
  await query(
    `UPDATE game_maps
        SET revealed_tiles = (
              SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                FROM jsonb_array_elements(revealed_tiles || $2::jsonb) AS e
            )
      WHERE id = $1`,
    [mapId, JSON.stringify(add)],
  );
}

/** Remove `remove` cells from revealed_tiles (the conceal_tiles write). */
export async function removeRevealedTiles(
  mapId: string,
  remove: CellKey[],
): Promise<void> {
  await query(
    `UPDATE game_maps
        SET revealed_tiles = COALESCE(
              (SELECT jsonb_agg(e)
                 FROM jsonb_array_elements(revealed_tiles) AS e
                WHERE (e #>> '{}') <> ALL($2)),
              '[]'::jsonb
            )
      WHERE id = $1`,
    [mapId, remove],
  );
}

/** Sheet ids owned by a user, to decide which tokens they may move. */
export async function getOwnedSheetIds(userId: string): Promise<Set<string>> {
  const res = await query<{ id: string }>(
    'SELECT id FROM character_sheets WHERE owner_user_id = $1',
    [userId],
  );
  return new Set(res.rows.map((r) => r.id));
}

/** Owner user id for authorization checks. */
export async function getSheetOwner(sheetId: string): Promise<string | null> {
  const res = await query<{ owner_user_id: string }>(
    'SELECT owner_user_id FROM character_sheets WHERE id = $1',
    [sheetId],
  );
  return res.rows[0]?.owner_user_id ?? null;
}

/** Owner user id of the sheet a token is linked to (null if unlinked). */
export async function getTokenOwner(tokenId: string): Promise<string | null> {
  const res = await query<{ owner_user_id: string | null }>(
    `SELECT cs.owner_user_id
       FROM tokens t
       LEFT JOIN character_sheets cs ON cs.id = t.character_sheet_id
      WHERE t.id = $1`,
    [tokenId],
  );
  return res.rows[0]?.owner_user_id ?? null;
}

// ── campaign lifecycle (docs/12 §4) ──────────────────────────────────────

type TransitionResult =
  | { ok: true; status: CampaignSummary['status'] }
  | { ok: false; reason: 'not_found' | 'invalid_transition' };

async function transitionCampaign(
  campaignId: string,
  toStatus: CampaignSummary['status'],
  fromStatuses: CampaignSummary['status'][],
): Promise<TransitionResult> {
  const res = await query<{ status: CampaignSummary['status'] }>(
    `UPDATE campaigns SET status = $2
        WHERE id = $1 AND status = ANY($3::campaign_status[])
      RETURNING status`,
    [campaignId, toStatus, fromStatuses],
  );
  if (res.rows[0]) return { ok: true, status: res.rows[0].status };
  const exists = await query('SELECT 1 FROM campaigns WHERE id = $1', [campaignId]);
  return { ok: false, reason: exists.rows.length ? 'invalid_transition' : 'not_found' };
}

/** draft/paused -> live ("Start Session"). */
export function startCampaignSession(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'live', ['draft', 'paused']);
}

/** live -> paused ("End Session"). */
export function endCampaignSession(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'paused', ['live']);
}

/** any non-completed -> completed, terminal ("Mark Complete"). */
export function completeCampaign(campaignId: string): Promise<TransitionResult> {
  return transitionCampaign(campaignId, 'completed', ['draft', 'live', 'paused']);
}

/** Apply a single nested path update via jsonb_set (the sheet_update write). */
export async function applySheetUpdate(
  sheetId: string,
  path: string[],
  value: unknown,
): Promise<void> {
  await query(
    `UPDATE character_sheets
        SET system_data = jsonb_set(system_data, $2::text[], $3::jsonb, true),
            updated_at = now()
      WHERE id = $1`,
    [sheetId, path, JSON.stringify(value)],
  );
}

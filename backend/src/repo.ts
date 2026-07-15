// Data access layer: hand-written SQL mapped to the shared domain types.
import { query } from './db.js';
import type {
  AuthUser,
  CampaignDetail,
  CampaignSummary,
  CellKey,
  Grid,
  LiveMapEntry,
  MapSummary,
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

// ── campaigns / membership ────────────────────────────────────────────────

export async function listCampaigns(userId: string): Promise<CampaignSummary[]> {
  const res = await query<{
    id: string;
    name: string;
    gm_name: string;
    member_count: string;
    is_member: boolean;
    is_gm: boolean;
  }>(
    `SELECT c.id, c.name,
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
  }));
}

/** Insert the campaign and the creator's GM member row atomically (CTE). */
export async function createCampaign(
  userId: string,
  name: string,
  joinCode: string | null,
): Promise<CampaignDetail> {
  const res = await query<{ id: string }>(
    `WITH c AS (
       INSERT INTO campaigns (name, gm_user_id, join_code)
       VALUES ($1, $2, $3) RETURNING id, gm_user_id
     ), m AS (
       INSERT INTO campaign_members (campaign_id, user_id) SELECT id, gm_user_id FROM c
     )
     SELECT id FROM c`,
    [name, userId, joinCode],
  );
  // Creator is the GM, so they're the viewer for the detail returned here.
  return (await getCampaignDetail(res.rows[0]!.id, userId))!;
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
  const c = await query<{ id: string; name: string; gm_user_id: string }>(
    'SELECT id, name, gm_user_id FROM campaigns WHERE id = $1',
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

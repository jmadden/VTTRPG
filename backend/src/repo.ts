// Data access layer: hand-written SQL mapped to the shared domain types.
import { query } from './db.js';
import type { CellKey, Grid, Token, TokenType } from '@vtt/shared';

export interface MapState {
  mapId: string;
  grid: Grid;
  gridType: 'square' | 'hex';
  gridSize: number;
  cols: number;
  rows: number;
  revealed: CellKey[];
}

interface MapRow {
  grid_type: 'square' | 'hex';
  grid_size: number;
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

export async function getUserRole(userId: string): Promise<'gm' | 'player' | null> {
  const res = await query<{ role: 'gm' | 'player' }>(
    'SELECT role FROM users WHERE id = $1',
    [userId],
  );
  return res.rows[0]?.role ?? null;
}

export async function getMapState(mapId: string): Promise<MapState | null> {
  const res = await query<MapRow>(
    `SELECT grid_type, grid_size, cols, rows, revealed_tiles
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
    cols: row.cols,
    rows: row.rows,
    revealed: row.revealed_tiles,
  };
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

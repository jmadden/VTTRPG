-- ============================================================================
-- VTT — Local PostgreSQL schema
-- Apply with:  psql "$DATABASE_URL" -f backend/db/schema.sql
--
-- Local-host trust model: no password hashing, just local account profiles.
-- System-agnostic character data lives in a JSONB column (`system_data`).
-- Fog-of-war state lives in a JSONB array of canonical cell keys
-- (`revealed_tiles`), geometry-agnostic across square and hex grids.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid()

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role  AS ENUM ('gm', 'player');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE grid_type  AS ENUM ('square', 'hex');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE token_type AS ENUM ('player', 'monster', 'prop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── users ─────────────────────────────────────────────────────────────────
-- Simple local profiles. `pin` is an optional convenience gate, NOT security.
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT        NOT NULL,
  role         user_role   NOT NULL DEFAULT 'player',
  pin          TEXT,                         -- optional, plaintext, local-only
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── campaigns ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  gm_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_gm ON campaigns(gm_user_id);

-- ── character_sheets ──────────────────────────────────────────────────────
-- `system_data` holds the entire system-agnostic sheet (any RPG system).
-- Updated one path at a time via jsonb_set (see sheet_update example below).
CREATE TABLE IF NOT EXISTS character_sheets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_user_id UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  system_data   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheets_campaign ON character_sheets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sheets_owner    ON character_sheets(owner_user_id);
-- GIN index enables efficient queries into arbitrary system_data paths.
CREATE INDEX IF NOT EXISTS idx_sheets_system_data ON character_sheets USING GIN (system_data);

-- ── game_maps ─────────────────────────────────────────────────────────────
-- `revealed_tiles` is a JSONB array of canonical cell keys, e.g. ["3,4","3,5"].
-- Square keys are "col,row"; hex keys are axial "q,r". It is MAP-LEVEL:
-- fog is identical for all players, so the only visibility split is GM vs players.
CREATE TABLE IF NOT EXISTS game_maps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  asset_path     TEXT        NOT NULL,              -- path/URL to the map image
  grid_type      grid_type   NOT NULL DEFAULT 'square',
  grid_size      INTEGER     NOT NULL DEFAULT 70,   -- cell size in world px
  cols           INTEGER     NOT NULL DEFAULT 0,
  rows           INTEGER     NOT NULL DEFAULT 0,
  revealed_tiles JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT revealed_tiles_is_array CHECK (jsonb_typeof(revealed_tiles) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_maps_campaign ON game_maps(campaign_id);

-- ── tokens ────────────────────────────────────────────────────────────────
-- Position is world pixels (x, y). The server converts (x, y) -> cell key via
-- the map's grid_type/grid_size to decide visibility. `hidden` monsters on
-- unrevealed cells are stripped from non-GM payloads entirely (anti-cheat).
CREATE TABLE IF NOT EXISTS tokens (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id             UUID        NOT NULL REFERENCES game_maps(id)        ON DELETE CASCADE,
  character_sheet_id UUID        REFERENCES character_sheets(id) ON DELETE SET NULL,
  name               TEXT        NOT NULL,
  type               token_type  NOT NULL DEFAULT 'player',
  x                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  y                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  hidden             BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tokens_map ON tokens(map_id);

-- ============================================================================
-- Example: applying a single nested `sheet_update` with jsonb_set.
-- Client sends { sheetId, path: ["stats","hp","current"], value: 27 }.
-- The path array maps to a Postgres text[] path; `true` creates missing keys.
--
--   UPDATE character_sheets
--      SET system_data = jsonb_set(
--            system_data,
--            '{stats,hp,current}',      -- text[] built from the path array
--            to_jsonb(27),              -- value, JSON-encoded
--            true
--          ),
--          updated_at = now()
--    WHERE id = $1;
--
-- Deep-set that also creates intermediate objects: jsonb_set is not recursive,
-- so build the path server-side and rely on the `create_missing = true` flag,
-- or COALESCE parent objects to '{}' before setting.
-- ============================================================================

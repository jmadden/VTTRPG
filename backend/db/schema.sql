-- ============================================================================
-- VTT — PostgreSQL schema
-- Apply with:  psql "$DATABASE_URL" -f backend/db/schema.sql
--
-- Identity: login by display name + a bcrypt-hashed PIN (see backend auth).
-- Role is NOT stored on the user; it is derived per campaign (creator = GM).
-- System-agnostic character data lives in JSONB (`system_data`). Fog-of-war
-- state lives in a JSONB array of canonical cell keys (`revealed_tiles`),
-- geometry-agnostic across square and hex grids.
--
-- Pre-release: this schema is edited in place and the DB is reset, never
-- migrated (`npm run db:reset`). CREATE TABLE IF NOT EXISTS will not alter an
-- existing table, so column changes require a reset.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt()/gen_salt()

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE grid_type  AS ENUM ('square', 'hex');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE token_type AS ENUM ('player', 'monster', 'prop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'live', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── users ─────────────────────────────────────────────────────────────────
-- Login by display name (case-insensitive unique) + a bcrypt-hashed PIN.
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT        NOT NULL,
  pin_hash     TEXT        NOT NULL,          -- bcrypt (bcryptjs / pgcrypto bf)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Names are the login key, so they must be unique; lower() blocks "Bob"/"bob".
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique ON users (lower(display_name));

-- ── sessions ────────────────────────────────────────────────────────────────
-- Survive restarts. Only sha256(token) is stored; the raw token is returned to
-- the client once at login and never persisted.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── games (docs/12) ───────────────────────────────────────────────────────
-- Sits above campaigns: a reusable ruleset/setting owning a Map Library
-- (map_templates) and a standing player roster (game_members). A campaign is
-- required to belong to exactly one Game. `join_code` gates the standing
-- roster join, separate from each campaign's own join_code below.
CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gm_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name        TEXT        NOT NULL,
  description TEXT,
  join_code   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_gm ON games(gm_user_id);

-- ── campaigns ───────────────────────────────────────────────────────────────
-- `join_code` (nullable) gates open join over a public URL. Which maps are
-- "live" right now lives in campaign_live_maps below, not on this row — see
-- the gm-maps-1b design note there. `status` is the docs/12 lifecycle
-- (draft/live/paused/completed), manually toggled by the GM.
CREATE TABLE IF NOT EXISTS campaigns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  gm_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  game_id    UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status     campaign_status NOT NULL DEFAULT 'draft',
  join_code  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_gm ON campaigns(gm_user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_game ON campaigns(game_id);

-- ── campaign_members ──────────────────────────────────────────────────────
-- Explicit membership. The GM gets a row too (inserted at campaign creation),
-- so "list this campaign's members" is one uniform query. Role is never stored
-- here; it is always derived from campaigns.gm_user_id.
CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS campaign_members_user_idx ON campaign_members (user_id);

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

-- ── map_templates (docs/12) ───────────────────────────────────────────────
-- A Game's reusable Map Library. Never played on directly — no revealed_tiles,
-- no tokens. Assigning one to a campaign COPIES it into a fresh game_maps row
-- (see game_maps.template_id below); the template itself never changes after
-- that copy, since fog-of-war/tokens are inherently per-playthrough state.
CREATE TABLE IF NOT EXISTS map_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  asset_path TEXT        NOT NULL,
  grid_type  grid_type   NOT NULL DEFAULT 'square',
  grid_size  INTEGER     NOT NULL DEFAULT 70,
  cols       INTEGER     NOT NULL DEFAULT 0,
  rows       INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_map_templates_game ON map_templates(game_id);

-- ── game_members (docs/12) ────────────────────────────────────────────────
-- A Game's standing roster: players join once (via games.join_code) and keep
-- their persistent character sheet reference here across whichever of the
-- Game's campaigns they're actively playing in.
CREATE TABLE IF NOT EXISTS game_members (
  game_id            UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_sheet_id UUID REFERENCES character_sheets(id) ON DELETE SET NULL,
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

-- ── game_maps ─────────────────────────────────────────────────────────────
-- `revealed_tiles` is a JSONB array of canonical cell keys, e.g. ["3,4","3,5"].
-- Square keys are "col,row"; hex keys are axial "q,r". It is MAP-LEVEL:
-- fog is identical for all players, so the only visibility split is GM vs players.
-- `template_id` (docs/12) traces a copy-on-assign map back to its Map Library
-- template, purely for reference — no sync back, edits after copy diverge.
CREATE TABLE IF NOT EXISTS game_maps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id    UUID        REFERENCES map_templates(id) ON DELETE SET NULL,
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

-- ── campaign_live_maps ────────────────────────────────────────────────────
-- gm-maps-1b: the GM's ordered set of "live" tabs, a subset of the campaign's
-- game_maps library. Add/remove/reorder = row changes via one atomic
-- set_live_maps rewrite (backend/src/repo.ts). Both FKs CASCADE: dropping a
-- library map or the campaign drops its tab row(s) too.
CREATE TABLE IF NOT EXISTS campaign_live_maps (
  campaign_id UUID    NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  map_id      UUID    NOT NULL REFERENCES game_maps(id)  ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  PRIMARY KEY (campaign_id, map_id)
);
CREATE INDEX IF NOT EXISTS idx_live_maps_campaign ON campaign_live_maps(campaign_id, position);

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

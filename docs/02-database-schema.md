# 02 - Database Schema

Local PostgreSQL, accessed with raw `pg` and hand-written SQL (no ORM), chosen
for full control over JSONB path updates and the anti-cheat query path. DDL
lives in `backend/db/schema.sql`; demo data in `backend/db/seed.sql`.

Apply:
```bash
psql -d vtt -f backend/db/schema.sql
psql -d vtt -f backend/db/seed.sql   # optional demo data
```

Or, with `DATABASE_URL` exported in your shell, use the npm scripts:
```bash
npm run db:setup     # db:init (schema) then db:seed (demo data)
npm run db:init      # schema only
npm run db:seed      # demo data only
```
Both files are idempotent (`CREATE ... IF NOT EXISTS`, `ON CONFLICT DO NOTHING`),
so re-running is safe.

**Pre-release policy: the schema is edited in place, never migrated.**
`CREATE TABLE IF NOT EXISTS` won't alter an existing table, so a column/table
change requires `npm run db:reset` (drops + recreates the `public` schema,
then re-applies `schema.sql` + `seed.sql`) rather than a migration file. This
is called out directly in `schema.sql`'s own header comment.

## Design principles

- **System-agnostic sheets**: a character's full sheet lives in a JSONB
  `system_data` column, so any RPG system fits without schema changes.
- **Geometry-agnostic fog**: `game_maps.revealed_tiles` is a JSONB array of
  canonical cell-key strings (`"col,row"` for square, axial `"q,r"` for hex),
  so reveal state is a flat set regardless of grid type.
- **Real local accounts** (doc 09): display name + a bcrypt-hashed PIN
  (`pin_hash`), never plaintext. Role is **not** stored on the user at all —
  it's derived per campaign (`campaigns.gm_user_id`), so the same person can be
  GM of one campaign and a player in another.

## Enums

`grid_type` (`square` | `hex`), `token_type` (`player` | `monster` | `prop`).
Created idempotently. (There is no `user_role` enum — see above.)

## Tables

### `users`
`id` (uuid pk), `display_name` (case-insensitive unique — a lowercased unique
index blocks `"Bob"`/`"bob"` colliding), `pin_hash TEXT NOT NULL` (bcrypt via
`bcryptjs`), `created_at`. Login is by name, so names must be unique.

### `sessions`
`token_hash` (pk — sha256 of the raw token; the raw token is returned to the
client once at login/register and never persisted), `user_id` -> `users(id)`
`ON DELETE CASCADE`, `created_at`, `last_seen_at`. Survives backend restarts.
See doc 09 for the auth/session model in full.

### `campaigns`
`id`, `name`, `gm_user_id` -> `users(id)` `ON DELETE RESTRICT`, `join_code`
(nullable `TEXT` — gates open join over a public URL; the seeded demo uses
`DEMO42`), `created_at`. Which maps are "live" right now lives in
`campaign_live_maps` below, not on this row (`campaigns.active_map_id` from an
earlier iteration was removed entirely, superseded by that table).

### `campaign_members`
`campaign_id` -> `campaigns(id)`, `user_id` -> `users(id)`, `joined_at`; PK
`(campaign_id, user_id)`. Explicit membership — the GM gets a row here too
(inserted at campaign creation), so "list this campaign's members" is one
uniform query; role is never stored here, always derived from
`campaigns.gm_user_id`.

### `character_sheets`
`id`, `campaign_id` -> `campaigns(id)`, `owner_user_id` -> `users(id)`, `name`,
`system_data JSONB NOT NULL DEFAULT '{}'`, `created_at`, `updated_at`.
A **GIN index** on `system_data` enables efficient queries into arbitrary paths.
`owner_user_id` drives the `sheet_update` / `token_move` authorization checks.

### `game_maps`
`id`, `campaign_id`, `name`, `asset_path`, `grid_type`, `grid_size` (px),
`cols`, `rows`, `revealed_tiles JSONB NOT NULL DEFAULT '[]'`, `created_at`.
A CHECK constraint enforces `jsonb_typeof(revealed_tiles) = 'array'`.
`revealed_tiles` is map-level (shared by all players); the only visibility split
is GM-vs-players.

### `campaign_live_maps`
`campaign_id` -> `campaigns(id)`, `map_id` -> `game_maps(id)` (both `ON DELETE
CASCADE`), `position INT NOT NULL`, `title TEXT NOT NULL`; PK
`(campaign_id, map_id)`, indexed on `(campaign_id, position)`. The GM's
ordered set of "live" tabs — a subset of the campaign's `game_maps` library
(doc 11). Add/remove/reorder is a full rewrite of this table's rows for that
campaign (`repo.setLiveMaps`), not per-row mutation. A player's location is
**not** stored here or anywhere else explicit — "a player is where their
token is": whichever live map their token's `map_id` points at.

### `tokens`
`id`, `map_id` -> `game_maps(id)`, `character_sheet_id` -> `character_sheets(id)`
(nullable, `ON DELETE SET NULL`), `name`, `type` (`token_type`), `x`, `y`
(world pixels, double precision), `hidden BOOLEAN DEFAULT false`, `created_at`.
Indexed on `map_id`. Foreign keys cascade from campaign down.

The server converts `(x, y)` to a cell key via the map's `grid_type`/`grid_size`
to decide visibility. A `hidden` monster on an unrevealed cell is stripped from
non-GM payloads entirely (doc 04).

## JSONB path updates (the `sheet_update` write)

A `sheet_update` carries `{ sheetId, path: string[], value }`. `path` maps
directly to a Postgres `text[]` path for `jsonb_set`:

```sql
UPDATE character_sheets
   SET system_data = jsonb_set(system_data, $2::text[], $3::jsonb, true),
       updated_at = now()
 WHERE id = $1;
-- $2 = ['stats','hp','current'], $3 = to_jsonb(value); `true` creates missing keys
```

`node-postgres` serializes a JS string array to a Postgres array automatically,
so the client's `path` array is passed straight through.

## Reveal / conceal writes

- **Reveal** (`addRevealedTiles`) unions new cells into `revealed_tiles`,
  deduped:
  ```sql
  revealed_tiles = (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                      FROM jsonb_array_elements(revealed_tiles || $2::jsonb) e)
  ```
- **Conceal** (`removeRevealedTiles`) filters cells out by text value:
  ```sql
  revealed_tiles = COALESCE(
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(revealed_tiles) e
      WHERE (e #>> '{}') <> ALL($2)), '[]'::jsonb)
  ```

## Seed data (`seed.sql`)

Deterministic fixed UUIDs, idempotent (`ON CONFLICT DO NOTHING`):

| Entity | ID |
|--------|----|
| GM user "Game Master" (PIN `1234`) | `11111111-1111-1111-1111-111111111111` |
| Player user "Player One" (PIN `4321`) | `22222222-2222-2222-2222-222222222222` |
| Campaign "Demo Campaign" (join code `DEMO42`) | `33333333-3333-3333-3333-333333333333` |
| Map "Demo Map" (square, 70px, 16x12) | `44444444-4444-4444-4444-444444444444` |
| Sheet "Aria" (player-owned) | `55555555-5555-5555-5555-555555555555` |
| Token "Aria" (player) | `66666666-6666-6666-6666-666666666666` |
| Token "Lurking Orc" (hidden monster) | `77777777-7777-7777-7777-777777777777` |

Also seeded: `campaign_members` rows for both the GM and Player One, and one
`campaign_live_maps` row (position 0, title "Demo Map") — without it the
seeded GM would land on an empty tab bar.

The map seeds a small revealed region (top-left 3x3). The player token sits in a
revealed cell; the hidden Orc sits on unrevealed cell `10,5`, so players do not
receive it until the GM reveals that cell. This is the anti-cheat demo fixture.

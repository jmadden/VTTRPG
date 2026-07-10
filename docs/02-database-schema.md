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

## Design principles

- **System-agnostic sheets**: a character's full sheet lives in a JSONB
  `system_data` column, so any RPG system fits without schema changes.
- **Geometry-agnostic fog**: `game_maps.revealed_tiles` is a JSONB array of
  canonical cell-key strings (`"col,row"` for square, axial `"q,r"` for hex),
  so reveal state is a flat set regardless of grid type.
- **Local trust model**: no password hashing; users are simple local profiles
  with an optional plaintext `pin` (convenience, not security).

## Enums

`user_role` (`gm` | `player`), `grid_type` (`square` | `hex`),
`token_type` (`player` | `monster` | `prop`). Created idempotently.

## Tables

### `users`
`id` (uuid pk), `display_name`, `role` (`user_role`), `pin` (nullable),
`created_at`.

### `campaigns`
`id`, `name`, `gm_user_id` -> `users(id)`, `created_at`.

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
| GM user | `11111111-1111-1111-1111-111111111111` |
| Player user | `22222222-2222-2222-2222-222222222222` |
| Campaign | `33333333-3333-3333-3333-333333333333` |
| Map (square, 70px, 16x12) | `44444444-4444-4444-4444-444444444444` |
| Sheet "Aria" (player-owned) | `55555555-5555-5555-5555-555555555555` |
| Token "Aria" (player) | `66666666-6666-6666-6666-666666666666` |
| Token "Lurking Orc" (hidden monster) | `77777777-7777-7777-7777-777777777777` |

The map seeds a small revealed region (top-left 3x3). The player token sits in a
revealed cell; the hidden Orc sits on unrevealed cell `10,5`, so players do not
receive it until the GM reveals that cell. This is the anti-cheat demo fixture.

-- Deterministic demo data for local dev / tests.
-- Apply after schema.sql:  psql -d vtt -f backend/db/seed.sql
-- Idempotent: ON CONFLICT DO NOTHING on fixed UUIDs.
-- Demo login PINs (bcrypt-hashed via pgcrypto below):
--   Game Master = 1234   |   Player One = 4321
-- These double as the committed-test-suite fixtures.

INSERT INTO users (id, display_name, pin_hash) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Game Master', crypt('1234', gen_salt('bf', 10))),
  ('22222222-2222-2222-2222-222222222222', 'Player One',  crypt('4321', gen_salt('bf', 10)))
ON CONFLICT (id) DO NOTHING;

-- join_code gates open join over a public URL. active_map_id is set after the
-- map is inserted (below).
INSERT INTO campaigns (id, name, gm_user_id, join_code) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Demo Campaign',
   '11111111-1111-1111-1111-111111111111', 'DEMO42')
ON CONFLICT (id) DO NOTHING;

-- Square grid, 70px cells, 16 x 12. A small revealed region in the top-left.
INSERT INTO game_maps (id, campaign_id, name, asset_path, grid_type, grid_size, cols, rows, revealed_tiles) VALUES
  ('44444444-4444-4444-4444-444444444444',
   '33333333-3333-3333-3333-333333333333',
   'Demo Map', '/assets/demo-map.png', 'square', 70, 16, 12,
   '["0,0","1,0","2,0","0,1","1,1","2,1","0,2","1,2","2,2"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO character_sheets (id, campaign_id, owner_user_id, name, system_data) VALUES
  ('55555555-5555-5555-5555-555555555555',
   '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222',
   'Aria', '{"stats":{"hp":{"current":18,"max":24}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Player token in a revealed cell (1,1) -> world center (105,105).
-- Hidden monster in an UNREVEALED cell (10,5) -> world (735,385):
-- players must NOT receive it until the GM reveals that cell.
INSERT INTO tokens (id, map_id, character_sheet_id, name, type, x, y, hidden) VALUES
  ('66666666-6666-6666-6666-666666666666',
   '44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555',
   'Aria', 'player', 105, 105, false),
  ('77777777-7777-7777-7777-777777777777',
   '44444444-4444-4444-4444-444444444444',
   NULL, 'Lurking Orc', 'monster', 735, 385, true)
ON CONFLICT (id) DO NOTHING;

-- Memberships (GM + player). The GM row mirrors what campaign creation inserts.
INSERT INTO campaign_members (campaign_id, user_id) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- Demo map is a live tab (gm-maps-1b): without this the seeded GM lands on an
-- empty tab bar and the committed e2e (login.spec.ts) assertions about
-- visible tokens would break.
INSERT INTO campaign_live_maps (campaign_id, map_id, position, title) VALUES
  ('33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444', 0, 'Demo Map')
ON CONFLICT (campaign_id, map_id) DO NOTHING;

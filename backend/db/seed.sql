-- Deterministic demo data for local dev / end-to-end testing.
-- Apply after schema.sql:  psql -d vtt -f backend/db/seed.sql
-- Idempotent: ON CONFLICT DO NOTHING on fixed UUIDs.

INSERT INTO users (id, display_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Game Master', 'gm'),
  ('22222222-2222-2222-2222-222222222222', 'Player One',  'player')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaigns (id, name, gm_user_id) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Demo Campaign',
   '11111111-1111-1111-1111-111111111111')
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

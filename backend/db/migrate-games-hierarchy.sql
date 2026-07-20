-- One-time migration for a DEPLOYED instance upgrading to the Games hierarchy
-- (docs/12 §6). Local dev/test never needs this: npm run db:reset always
-- starts from an empty schema, so there is no pre-existing data to wrap.
--
-- Run once, after applying schema.sql's new tables/columns to the deployed DB,
-- and as part of the same maintenance window as that schema change — the
-- schema.sql games/campaigns tables must already exist, but campaigns.game_id
-- must not yet have been marked NOT NULL on the running instance (or this
-- script must be the thing that populates it before any code requiring
-- gameId is deployed).

-- 1. Wrap every existing campaign in its own new Game.
INSERT INTO games (id, gm_user_id, name, join_code)
SELECT gen_random_uuid(), c.gm_user_id, c.name,
       upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  FROM campaigns c
 WHERE c.game_id IS NULL;

-- 2. Point each campaign at the Game just created for it (matched by name +
--    gm_user_id, which is unique for this one-time backfill since each Game
--    above was minted 1:1 from a campaign in the same statement batch).
UPDATE campaigns c
   SET game_id = g.id
  FROM games g
 WHERE c.game_id IS NULL
   AND g.gm_user_id = c.gm_user_id
   AND g.name = c.name;

-- 3. Back-fill each new Game's roster from that campaign's existing members.
INSERT INTO game_members (game_id, user_id)
SELECT c.game_id, cm.user_id
  FROM campaign_members cm JOIN campaigns c ON c.id = cm.campaign_id
 ON CONFLICT DO NOTHING;

-- 4. Only after confirming every campaigns.game_id is populated:
--      SELECT count(*) FROM campaigns WHERE game_id IS NULL;  -- expect 0
--    apply the NOT NULL constraint if the deployed table predates it:
-- ALTER TABLE campaigns ALTER COLUMN game_id SET NOT NULL;

# 11 - Game Master Toolkit

**Status: Phase 1 (Maps foundation) done; Phases 2-5 design only.** This doc
scopes and sequences the whole GM toolkit: multi-map management, tokens and
monsters, per-audience fog, session tools, and an in-app map builder. It is
built in phases (section 8); each phase ships and is verified before the
next. Login (docs/09) is the prerequisite and is done, so per-user and
per-campaign identity is real.

Phase 1 shipped in two slices: gm-maps-1a (map upload, library, single active
map, real image render) and gm-maps-1b (`campaign_live_maps` tabs, GM tab
bar/library drawer/players panel, cross-map token relocation, players
auto-loading whichever map their token is on). `campaigns.active_map_id` and
its REST route no longer exist, superseded by `campaign_live_maps`.

This design absorbs the "breakout maps" idea from `docs/08` into a first-class
model (section 2) and treats docs/08's per-audience fog as one phase here.

## 1. Why

Today a campaign has at most one active map and a GM who creates a campaign in
the lobby lands on an empty, unenterable campaign. There is no in-app way to add
a map, place tokens, or run a session. The GM toolkit fills that, and the
central requirement is running **several maps at once**, not one.

## 2. The tab-based multi-map model

```
Campaign
├─ Map library ............ every game_maps row for the campaign (browse/import)
├─ Live maps (tabs) ....... ordered subset the GM is running now (add/remove live)
│   └─ each map: grid, terrain (builder), tokens, per-user fog
└─ Players ................ each loads the map their character's token is on

GM     -> opens/switches any live tab; full tools on each; sees everything (fog alpha 0.5)
Player -> loads only the map they are on; sees the effective fog for that map
```

- **Library vs live set.** The library is all of a campaign's maps. The **live
  set** is the ordered subset the GM is actively running, shown as labeled tabs.
  The GM adds a tab (from the library or a fresh upload), removes a tab, and
  reorders tabs in real time. "What we're using now" vs "what we could pull from."
- **The GM sees every live map** by clicking its tab, with the full tool set
  (fog, tokens, later the builder) on whichever tab is open.
- **Players are located individually.** Different players can be on different
  live maps simultaneously. Example: tabs are Tavern, Farmhouse, Dungeon; Player
  A is in the Tavern; when A leaves, the GM opens the Dungeon tab and moves A's
  token there, and A now loads the Dungeon. Player B may be elsewhere the whole
  time.

### Single source of truth: a player is where their token is

There is **no separate player-location table**. A player loads the map their
character's token is on; relocation is one action: reassign that token's
`map_id` (the GM drags the player's token onto another live tab). "Unplaced" (no
token yet) shows a waiting screen. This matches how the GM actually thinks ("put
Player A's token on the Dungeon") and avoids two records disagreeing about where
someone is.

v1 assumes **one PC token per player per campaign** as the load anchor. A
token-less spectator who watches a map, or a player with several tokens on
different maps, is out of v1 scope (either would reintroduce an explicit
location; revisit then, see section 10).

## 3. Anti-cheat continuity

Unchanged in spirit, now evaluated **per (map, user)**. The visibility filter
(`backend/src/lib/visibilityFilter.ts`, docs/04) already takes a `revealed` set
+ a `Grid`; it is called with the recipient's current map and effective fog. A
hidden token on a cell outside that recipient's effective set is stripped
entirely from that recipient's payload. No new leak surface: because players are
routed to their own map and filtered against their own fog, there is never a
shared payload that could leak another map's or another player's tokens.

## 4. Data model deltas (`backend/db/schema.sql`)

New now (Phase 1):

- **`campaign_live_maps`** - `(campaign_id, map_id)` PK, `position INT`,
  `title TEXT`. The GM's ordered live tabs; add/remove/reorder = row changes.

Reused as-is:

- **`game_maps`** is the library (all maps for a campaign) plus `asset_path`
  (rendered under the grid) and `revealed_tiles` (base fog).
- **`tokens`** already has `map_id` + `character_sheet_id`; cross-map moves are a
  `map_id` reassign. No schema change for player location.

New in later phases:

- **`map_visibility`** (docs/08) - `(map_id, user_id)` per-user fog overlay; base
  fog stays on `game_maps.revealed_tiles`. Phase 3.
- **`game_maps.terrain JSONB`** - ordered placed shapes/stamps
  (`{shapeId,x,y,rotation,scale}`), rendered under tokens; plus a **`shapes`**
  asset catalog (id, name, asset_path or vector, category). Phase 5. Keep the
  Phase-1 map schema forward-compatible with this so Phase 5 is not a rewrite.
- **`monster_templates`** - reusable monster definitions (name, default token
  props, `system_data`); spawning copies a template to a token. Phase 2.
- **`initiative`** / **`handouts`** - session tools. Phase 4. Dice may stay
  transient (socket-only) or be logged.

## 5. Real-time model (`shared/src/contracts.ts`, `backend/src/socket`)

- **Per-map rooms already exist** (`map:<id>:gm` / `map:<id>:players`). Extend to
  tabs: the GM's socket joins the room of the tab it is viewing (switching tabs =
  leave/join, exactly like today's `join_map`); a player's socket joins the room
  of the map their token is on.
- **New GM events (Phase 1, built):** `set_live_maps` (GM sends the full
  ordered live-tab list, server rewrites `campaign_live_maps` atomically,
  broadcasts to the GM's own `user:<id>` room) and `token_relocate` (a
  **distinct event from `token_move`**, not an extension of it — `token_move`
  itself is unchanged and stays same-map-only; `token_relocate` is GM-only,
  reassigns a token's `map_id`, and pushes `map_relocated` to the relocated
  player's `user:<id>` room). Token CRUD (`token_create`/`token_delete`) is
  still **Phase 2, not built** — Phase 1 only relocates tokens that already
  exist. Fog events gain the docs/08 `audience` field in Phase 3.
- **Player relocation flow (one action):** the GM moves the player's token to
  another live map (its `map_id` changes); the server tells that player's socket
  to load the new map; the player re-runs the join flow and gets a fresh,
  filtered `state_sync`. Reuses the proven join/state_sync path.
- **Off-tab awareness (v1 cut):** the GM's non-focused tabs do NOT live-update;
  switching a tab re-joins that map. **Not built:** the "activity" dot on
  non-focused tabs described in earlier drafts of this doc — there is
  currently no indicator at all that something happened on a tab the GM isn't
  looking at. Open TODO, not shipped. Full multi-room live sync of all open
  tabs is a later optimization regardless.
- Emission stays per-socket by effective set (docs/08) and now also per current
  map; docs/08 notes this is additive, not a rewrite.

## 6. Frontend shape (`frontend/src`)

- **GM view:** a **tab bar** (live maps) + a **library drawer** (add a tab from
  the library or upload a new map) + the existing Pixi stage for the open tab + a
  **tools panel** (fog tool, token/monster palette, later builder tools) + a
  **players panel** (drag a player onto a tab to move them there).
- **Player view:** the current single-map experience, unchanged; it loads
  whatever map the player's token is on and re-loads when the GM moves them.
- Reuse: `PixiStage`, the store, the socket handshake, the visibility filter.

**Phase 1 UI note (built, but not originally scoped in this design — a
follow-up visual pass):** the GM toolbar was reworked from four disconnected
floating panels into one cohesive bar. New shared tokens in
`frontend/src/routes/ui.ts` (`surface`, `space`, `eyebrow`, `gmToggle`,
`tabChip`) introduce an amber `accentGm` reserved for GM-authority state (the
active live tab, the active fog tool) — visually distinct from the green
`primaryBtn` used for submit/confirm actions elsewhere. The library drawer was
renamed "Map Library" and now lists every campaign map with a thumbnail,
marking already-added ones as ghosted "Added" rather than hiding them
(`gm/LibraryDrawer.tsx`).

## 7. Authorization

All new mutating events are GM-only, except token moves a player is already
allowed (owner check, as today). `set_live_maps`, token create/delete, cross-map
moves, fog audiences, and builder edits require the caller to be the campaign's
GM, validated server-side by reusing `getCampaignForMap` + the `gm_user_id`
check.

## 8. Build phases

Each phase ships and is verified (section 9) before the next.

1. **Maps foundation.** Upload/import maps to the library; `campaign_live_maps`
   tabs (GM add/remove/reorder, broadcast); render the real `asset_path` image
   under the grid; move a player's token across live maps (relocation); GM tab
   bar + library panel + players panel; players load the map their token is on.
   Outcome: GM-created campaigns become playable with multiple simultaneous maps
   and per-player placement.
2. **Tokens & monsters.** GM token create/delete/move on any live map; monster
   templates (bestiary) + spawn; token properties (hidden, HP/conditions).
3. **Per-audience fog (docs/08).** `map_visibility` overlays; GM audience
   selector, parties/presets, view-as-player. Fog is now per (map, user).
4. **Session tools.** Initiative/turn tracker, shared dice roller, and handouts
   pushed to a chosen audience.
5. **Map builder + shape library.** In-app terrain painting with reusable stamps
   (`game_maps.terrain` + the `shapes` catalog); a build/edit mode on any tab.

## 9. Verification (per phase)

Extend the committed suite (`npm test`, docs/06): unit for any new pure logic;
integration (Vitest + `vtt_test`) for the new socket/REST events (live tabs,
player relocation, token CRUD, fog audiences) asserting authorization and the
per-map anti-cheat; Playwright e2e for the GM tab/library/placement flow and a
two-player split (Player A in the Tavern, Player B in the Dungeon, each seeing
only their map). Docker gate before merging each phase.

## 10. Open questions (resolve as the relevant phase begins)

- **Shape library:** bundled art vs user-imported; grid-snap vs free placement.
- **Dice / initiative:** transient socket events vs persisted rows.
- **Multiple tokens per player** (a PC plus a summon): v1 assumes one PC token as
  the load anchor; revisit if players need several, which would reintroduce an
  explicit per-player map location.

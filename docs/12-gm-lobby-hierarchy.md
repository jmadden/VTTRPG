# 12 - GM Lobby Hierarchy (Games above Campaigns)

**Status: design only, not built.** This doc scopes a new organizational layer
above `campaigns` so a GM can reuse maps and a standing player roster across
multiple playthroughs, and so the Lobby stays navigable as a GM accumulates
campaigns over time. Docs 02/03/04/11 (schema, sockets, anti-cheat, in-campaign
GM toolkit) are unaffected once inside a campaign — this doc only changes what
sits *above* a campaign and how a GM gets into one.

## 1. Why

Today (docs 02, 07) the Lobby is a flat list of `campaigns`; a map
(`game_maps`) belongs to exactly one campaign forever, and there is no
standing player group — every campaign re-invites its members from scratch.
Three compounding pain points as a GM's usage grows:

- **Maps aren't reusable.** Running the same dungeon in a new campaign means
  re-uploading and re-configuring the image and grid.
- **The empty-campaign landing problem** (already flagged in docs/11 §1):
  a GM creates a campaign and lands on an empty, unenterable screen.
- **Flat-list Lobby doesn't scale.** No grouping mechanism as campaigns pile
  up over months of play.

This doc introduces **Games** as the reusable container: a ruleset/setting
(e.g. "Homebrew World") that owns a Map Library and a standing player roster,
under which one or more **Campaigns** (concrete playthroughs, each with its
own group and its own lifecycle) run — including multiple **concurrently**,
e.g. a Tuesday group and a Saturday group in the same setting.

## 2. The Lobby -> Game -> Campaign model

```
Lobby (GM's dashboard) .... list of Games the GM owns
└─ Game ................... a ruleset/setting; the reusable container
   ├─ Map Library ......... map_templates: image + default grid config, reusable
   ├─ Roster .............. game_members: standing list of players + persistent
   │                        character sheets for this Game
   └─ Campaigns ........... concurrent playthroughs, each:
      ├─ status ........... draft -> live <-> paused -> completed (terminal)
      ├─ campaign_members . subset of the Game roster active in THIS campaign
      └─ game_maps ........ live copies of templates (own fog/tokens per docs/11)
```

- **Game is required**, not optional — every campaign lives inside one.
  Creating a campaign always means picking (or first creating) a Game.
- **Multiple campaigns run concurrently** under one Game. There is no
  single-live-per-Game constraint; two groups can each be `live` at once.
- **Templates are copied, not shared, on assign.** A map's `revealed_tiles`
  and tokens are inherently per-playthrough state (same reasoning as docs/11's
  per-campaign live maps) — sharing a `game_maps` row across campaigns would
  mean fog-of-war state has no single owner. `map_templates` holds the
  reusable asset (image + default grid); assigning one to a campaign copies it
  into a fresh `game_maps` row, independent from that point on.
- **Roster is persistent at the Game level, subset per Campaign.** A player
  joins a Game's roster once (via a Game-level join code, separate from each
  campaign's own code) and keeps their character there. Creating or managing
  a campaign picks which roster members are active `campaign_members` for
  that specific run — so pulling someone into whichever of the Game's
  campaigns is actually running doesn't require re-inviting them.
- **Players are unaffected.** Joining via a campaign's join code still lands a
  player straight in that campaign, same as today (docs 07/09) — the Game
  layer is GM-side organizational scaffolding, not player-facing structure in
  this phase (see §9, deferred).

## 3. Data model deltas (`backend/db/schema.sql`)

New:

- **`games`** — `id`, `gm_user_id` -> `users(id)` `ON DELETE RESTRICT`, `name`,
  `description`, `created_at`. Lobby lists these instead of campaigns
  directly.
- **`map_templates`** — `id`, `game_id` -> `games(id)` `ON DELETE CASCADE`,
  `name`, `asset_path`, `grid_type`, `grid_size`, `cols`, `rows`,
  `created_at`. No `revealed_tiles`, no tokens — a template is never played
  on directly.
- **`game_members`** — `game_id` -> `games(id)`, `user_id` -> `users(id)`,
  `character_sheet_id` -> `character_sheets(id)` (nullable until the player
  creates one), `joined_at`; PK `(game_id, user_id)`. The standing roster.

Changed:

- **`campaigns`** gains `game_id` -> `games(id)` `ON DELETE CASCADE` (`NOT
  NULL`), and `status campaign_status NOT NULL DEFAULT 'draft'` where
  `campaign_status` is a new enum: `draft`, `live`, `paused`, `completed`.
- **`game_maps`** gains a nullable `template_id` -> `map_templates(id)` `ON
  DELETE SET NULL`, purely for traceability back to the template it was
  copied from. No sync back to the template; edits after copy are
  independent (matches docs/11's existing per-campaign map independence).
- **`character_sheets`** stays campaign-scoped as-is (docs 02) for the
  playthrough's live sheet; `game_members.character_sheet_id` is a separate
  Game-level persistent record. (Whether these two ever need reconciling —
  e.g. carrying XP forward between campaigns — is out of scope here; see §9.)

Unaffected: `campaign_members`, `campaign_live_maps`, `tokens` — everything
docs/11 already built inside a campaign is untouched.

## 4. Campaign lifecycle

```
        Start Session         End Session
 draft ───────────────► live ───────────────► paused
   │                     │                       │
   │                     └──────Mark Complete─────┤
   └──────────────────Mark Complete────────────────┴──► completed (terminal)
```

- **`draft`** — created, no session run yet.
- **`live`** — session in progress. GM clicks **Start Session** from `draft`
  or `paused`.
- **`paused`** — between sessions/story beats. GM clicks **End Session** from
  `live`.
- **`completed`** — terminal, read-only. Reachable from any non-completed
  state via **Mark Complete**; drops out of the default Campaigns view behind
  a "Show completed" toggle rather than being deleted.
- **Manual toggle, not presence-inferred.** Chosen over inferring liveness
  from GM socket connection specifically to avoid a dropped-wifi reconnect
  flickering the status — this is the same class of explicit-state-over-
  inferred-state reasoning as docs/11 §2's "single source of truth" token
  location model.
- This status is also the hook a future Player-facing dashboard reads from
  (§9) — no further backend work needed when that phase starts.

## 5. Frontend shape (`frontend/src`)

- **Lobby shell**: persistent left sidebar listing the GM's Games (plus "+ New
  Game"); selecting one loads its content in the main area with a top-level
  tab set — **Campaigns / Map Library / Roster** — inside that Game. Chosen
  over a dashboard-drill-down or top-tab-only shell specifically so switching
  between Games never loses place, matching the Notion/Linear/Discord
  workspace-switcher pattern the GM asked to feel like a modern app.
- **Campaigns tab**: a card grid (not a compact list) — each card shows name,
  a color-coded status badge (live/paused/draft/completed per §4), player
  count, and the primary action for its state (`Enter`/`Start Session`/
  `Manage`/`View`). Chosen over dense list rows because the status distinction
  benefits from being visually prominent at a glance, and per-Game campaign
  counts are expected to stay small (a handful, not hundreds).
- **Create Campaign**: a single page, not a wizard — name field plus two
  side-by-side multi-select panels (Map Library templates | Roster members).
  Chosen over a step-by-step wizard because a GM creating a campaign already
  knows what they want; everything visible at once is faster and matches
  familiar "new item" form patterns.
- **Map Library tab**: upload/manage `map_templates` (grid/list layout is an
  implementation detail, not fixed by this doc — follow the Campaigns card
  grid's visual language).
- **Roster tab**: standing member list + each one's persistent character
  sheet, plus the Game-level join code for onboarding new players.
- Existing `/campaign/$id` (MapView) and `/campaign/$id/manage` (MapsManager)
  screens are **unchanged** — this doc only touches what's above them.

## 6. Migration of existing data

Since `games.id` is required on `campaigns`, every existing campaign needs a
parent at migration time:

1. For each existing `campaigns` row, create one `games` row: same
   `gm_user_id`, `name` defaulted to the campaign's name.
2. Set that `campaigns.game_id` to the new Game's id.
3. Back-fill `game_members` from that campaign's existing `campaign_members`
   (same `user_id`s), leaving `character_sheet_id` null if ambiguous — a
   player can attach their existing sheet from the Roster tab afterward.
4. Existing `game_maps` rows keep their `campaign_id` untouched;
   `template_id` stays null (they simply didn't come from a library
   template — the nullable FK already allows this).

Net effect: every pre-existing campaign becomes a Game-of-one, playable
exactly as before, until the GM chooses to add more campaigns or roster
members to that Game.

## 7. Authorization

Same pattern as docs/11 §7: all mutating Game-level actions (create/edit
Game, manage Map Library, manage roster, create/edit Campaign, status
transitions) require the caller to be `games.gm_user_id`, checked
server-side. Campaign-level authorization (docs 02/04/11) is unchanged.

## 8. Build phases

1. **Schema + migration.** `games`, `map_templates`, `game_members`,
   `campaigns.game_id`/`status`, `game_maps.template_id`; migrate existing
   campaigns into Game-of-one wrappers (§6).
2. **Lobby shell + Games CRUD.** Sidebar navigation, create/list Games, empty
   Map Library and Roster tabs.
3. **Map Library.** Upload/manage templates; copy-on-assign into a campaign's
   `game_maps` (reuses docs/11's existing map upload path, retargeted at
   `map_templates` as the source).
4. **Roster.** Game-level join code, `game_members` list, character sheet
   attach.
5. **Campaigns tab + lifecycle.** Card grid, status badges, Start/End
   Session/Mark Complete transitions, single-page Create Campaign wired to
   Map Library + Roster multi-select.

Each phase ships and is verified (per docs/06) before the next, matching
docs/11's phasing discipline.

## 9. Explicitly deferred (not in this doc's scope)

- **Player-facing dashboard** — seeing "my Games/Campaigns," which campaign
  is live so a player can jump in, managing their own character sheet outside
  a live campaign. The `status` field and Game-level roster from this doc are
  designed to support this without rework, but the UI itself is a later
  brainstorm.
- **"Rules/resources"** as a Game-level content type (NPC library, freeform
  notes, item tables) — deliberately cut from v1 scope.
- **Presence-inferred live status** — v1 uses the manual toggle (§4); revisit
  only if manual toggling proves to be friction in practice.
- **Character continuity across campaigns** (e.g. carrying XP from a
  completed campaign into a new one under the same Game) — `game_members`
  gives a hook for this but no reconciliation logic is designed here.

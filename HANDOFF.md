# HANDOFF - VTT project

Read this first if you are a new AI instance picking up this project. It is the
fastest path to being productive without re-deriving context. Last updated
2026-07-19.

## What this is

A system-agnostic 2D virtual tabletop (VTT). It runs as one Docker stack,
hostable two ways: self-hosted on the GM's machine with players joining via an
ngrok or Tailscale tunnel, or on a DigitalOcean droplet with Caddy for automatic
TLS. The backend serves the SPA + API + sockets same-origin in both. See docs/10.
Voice/video is external.

**Day-to-day development is native, not Docker.** `npm run dev` (backend :4000,
frontend :5173, hot reload) against a local Postgres install is the normal
workflow; Docker is only spun up when actually hosting a session (self-host +
tunnel, or DigitalOcean). Don't default to Docker for iteration — it was tried
mid-project and reverted because it's slower to iterate against and the
project's own convention (this file, docs/10, the README) is native-dev/
Docker-to-ship. See README section 8 if you do need the Docker path.

Stack: React + PixiJS v8 (frontend), Node + Express + Socket.io + raw `pg`
(backend), local PostgreSQL, TypeScript throughout. npm-workspaces monorepo with
a `shared` package that is the single source of truth for the WebSocket
contract.

**Status: working end to end, well past scaffold.** Login/identity, the
anti-cheat pipeline, fog of war (reveal + conceal), token dragging, real map
image upload/rendering, a full GM toolkit Phase 1 (multi-map live tabs,
cross-map token relocation, a redesigned GM toolbar), and a **Games hierarchy
above Campaigns** (docs/12: reusable Map Library, standing player roster,
explicit campaign lifecycle, a Games sidebar Lobby) are implemented and
verified against a live database, a committed automated test suite, and real
browser sessions. See "Done vs not done" below for what's still open.

## Read the docs (they are current, "as-built")

- `README.md` - cross-machine setup (native dev primary, Docker for
  deploying/hosting), all required installs, run, troubleshooting.
- `docs/01-architecture.md` - monorepo layout, scripts, env loading, connection model.
- `docs/02-database-schema.md` - tables, JSONB, reveal/conceal SQL, seed fixtures.
- `docs/03-websocket-contracts.md` - every socket event payload and the room model.
- `docs/04-visibility-filter.md` - the server-side anti-cheat pipeline.
- `docs/05-pixi-shroud-strategy.md` - rendering, fog of war, input, dragging, the GM HUD.
- `docs/06-verification.md` - how it was verified and how to reproduce.
- `docs/07-features.md` - the roadmap/backlog tracker. **Read this before picking
  a next task** — it's kept current and is the fastest way to see what's
  Done vs Proposed vs Candidate.
- `docs/08-per-audience-visibility.md` - per-player fog design (docs/11 Phase 3, not built).
- `docs/09-login-and-identity.md` - login/session/role design (built).
- `docs/10-cloud-deployment.md` - the Docker deployment guide (built, verified locally).
- `docs/11-gm-toolkit.md` - the GM toolkit phased design. **Phase 1 is built**
  (multi-map tabs, token relocation); phases 2-5 (monsters, per-audience fog,
  session tools, map builder) are design-only. Read this before extending the
  GM-facing feature set.
- `docs/12-gm-lobby-hierarchy.md` - the Games-above-Campaigns design. **Built
  in full this session** (schema, Games CRUD, Map Library, Roster, campaign
  lifecycle, Lobby sidebar shell). §9 lists what's explicitly deferred
  (Player-facing dashboard, "rules/resources" content, presence-inferred
  live status) — read that before assuming any of those exist.
- `docs/superpowers/plans/2026-07-18-gm-lobby-hierarchy.md` - the 27-task
  implementation plan docs/12 was built from, if you need the exact
  task-by-task history/rationale rather than just the end state.
- `shared/src/contracts.ts` / `shared/src/api.ts` - the authoritative wire
  types (sockets and REST respectively). If you change the wire protocol,
  change it here first; both ends fail to compile until they agree.

## Get it running in one minute

Prereqs already satisfied on the GM's dev machine: Node (dev on 24), PostgreSQL
18 via Homebrew (role = the OS user, trust auth, no password), database `vtt`
created and seeded, `.env` present (it also carries dormant `POSTGRES_*`
values for the Docker path — harmless for native dev).

```bash
cd /Users/jim/Claude/Code/TTRPG
npm run build -w shared     # only needed if shared/dist is missing or shared changed
npm run dev                 # backend :4000, frontend :5173
```
- Health: `curl http://localhost:4000/health` should return `{"ok":true,"db":true}`
  (note: this only checks `DATABASE_URL` is *set*, not that it actually
  connects with a valid role — don't over-trust it if something's wrong).
- UI: http://localhost:5173 — log in (`Game Master`/`1234` or `Player One`/
  `4321`), no GM/Player toggle anymore, role is server-derived.
- This machine's `.env` uses `DATABASE_URL=postgresql://jim@localhost:5432/vtt`.
- **Gotcha:** if login fails with `role "..." does not exist`, check whether
  `DATABASE_URL` is exported in your shell (it overrides `.env` silently,
  since `dotenv.config()` doesn't override an already-set var) — this bit us
  once from copy-pasting a README example verbatim without substituting the
  real username.

On a fresh machine, follow `README.md` (installs Node + PostgreSQL, creates and
seeds the DB, writes `.env`), or use the Docker path in README section 8 if
you're deploying rather than developing.

## Done vs not done

Implemented and verified:
- **Login/identity** (docs/09): real accounts (display name + bcrypt PIN),
  sessions, per-campaign roles derived from `campaigns.gm_user_id`, join
  codes. No hardcoded seeded IDs, no client-side GM/Player toggle.
- **GM toolkit Phase 1** (docs/11): map image upload + real rendering
  (`game_maps.asset_path` -> Pixi `Sprite`); a per-campaign map library; GM-
  managed **live map tabs** (`campaign_live_maps`); cross-map **token
  relocation** (`token_relocate`, distinct from `token_move`) so the GM can
  drag a player onto a different live tab; players auto-load whichever live
  map their own token is on ("a player is where their token is" — no shared
  "active map" anymore).
- **GM toolbar visual redesign** (not originally scoped in docs/11, done
  alongside it): one cohesive toolbar instead of four floating boxes, an
  amber "GM-authority" accent distinct from the green primary-action color,
  a renamed "Map Library" drawer showing every map with a thumbnail (ghosted
  "Added" for already-live ones, not hidden).
- Real-time token sync via tiny JSON deltas (`token_move`, `token_add`,
  `token_remove`).
- Manual click-to-reveal fog of war (`reveal_tiles`) and GM conceal
  (`conceal_tiles`), square and hex grids.
- Drag-and-drop tokens that snap to the grid cell center.
- Server-side anti-cheat: a hidden token on an unrevealed cell is stripped
  from players' payloads entirely; deltas that flip visibility are gated per
  audience; a relocated token is re-gated against the destination map's fog.
- Server-side authorization for every mutating event (GM-only reveal/
  conceal/relocate/set-live-maps; owner-or-GM for token_move and
  sheet_update) and `movableTokenIds` so the UI only offers draggable tokens
  the client may move.
- System-agnostic character sheets as JSONB with single-path `jsonb_set`
  updates (storage + socket handler only — still no UI screen, see below).
- **Committed test suite**: Vitest (unit + integration) + Playwright (e2e)
  via `npm test` on a `vtt_test` DB (doc 06). CI wiring is still the
  remaining follow-up (no `.github/workflows` yet).
- **Docker deployment** (docs/10): one image, three modes (local, self-host +
  tunnel, DigitalOcean/Caddy) — verified locally (containers build and run
  healthy, full login->map->tabs flow drives correctly against the
  containerized DB).
- **Games hierarchy** (docs/12, built this session): `games` sits above
  `campaigns` — every campaign now requires a `game_id`. A Game owns a
  reusable **Map Library** (`map_templates`, Game-scoped; assigning one to a
  campaign copies it into a fresh `game_maps` row — never a shared
  reference, since fog/tokens are inherently per-playthrough) and a
  **standing roster** (`game_members`, joined via the Game's own
  `join_code`, with character-sheet attach). Campaigns have an explicit
  lifecycle (`draft`/`live`/`paused`/`completed`), moved only by an
  explicit GM action (Start Session/End Session/Mark Complete) — never
  inferred from socket presence. The Lobby is now a persistent Games
  sidebar; each Game has Campaigns/Map Library/Roster tabs; Create Campaign
  is a single page with template/roster multi-select. Multiple campaigns
  can run concurrently under one Game.

Not done (see docs/07 for the full live list; highlights):
- **docs/11 Phases 2-5**: token/monster CRUD (spawn, HP/conditions,
  bestiary), per-audience fog (`map_visibility`, docs/08 Phase 3), session
  tools (initiative, dice, handouts), an in-app map builder + shape library.
  Zero code exists for any of these — confirmed by grep (no `token_create`,
  `monster_templates`, `map_visibility`, `initiative`, `handouts`, `terrain`
  anywhere).
- **Off-tab "activity" indicator**: docs/11 mentions a lightweight dot on
  non-focused GM tabs so the GM notices activity elsewhere — not built, no
  indicator exists at all today.
- `sheet_update` has a contract and server handler but no UI (no character
  sheet screen).
- No pan/zoom camera.
- Player presence indicator (who else is connected) — no `member_joined`
  broadcast exists.
- **Player-facing Games/Campaigns dashboard** (docs/12 §9, explicitly
  deferred): players still only see the flat `LobbyHome` campaign list they
  had before — no "which Games am I in," no jumping straight to whichever of
  a Game's campaigns is currently `live`, no player-facing character-sheet
  management outside a live campaign. The `status` field and Game-level
  roster are already designed to support this without backend rework; only
  the UI itself is unbuilt.
- **"Rules/resources" as a Game-level content type** (docs/12 §9, deferred):
  no NPC library, freeform notes, or item/loot tables. Deliberately cut from
  v1 scope; no design exists yet either.
- **Presence-inferred live status** (docs/12 §9, deferred): the manual GM
  toggle is the only way `campaigns.status` moves. Revisit only if that
  proves to be real friction in practice.
- **Character continuity across campaigns under the same Game** (docs/12
  §9): `game_members.character_sheet_id` is a hook for this (e.g. carrying
  XP from a completed campaign into a new one) but no reconciliation logic
  exists.

## Locked decisions (do not relitigate without reason)

- **Raw `pg` + hand-written SQL**, no ORM. Chosen for JSONB path control and
  the anti-cheat query path.
- **npm workspaces + a `shared/` package** for the contract. Not independent
  packages (would let the wire contract drift).
- **Both square and hex grids** via a cell-key abstraction in
  `shared/src/coords.ts` (`"col,row"` / axial `"q,r"`).
- **PixiJS v8** (async `Application.init`, `app.canvas`, chained `Graphics`
  API). Do not use v7 patterns.
- **Fog is map-level** (one visibility view for all players on a given map);
  the only split today is GM vs players. Per-audience fog is a real planned
  phase (docs/08, docs/11 Phase 3) but is NOT built yet — don't assume it
  exists.
- **Fog color** slate blue-gray `0x3b4a63`; GM alpha 0.5, players 1.0.
- **A player's location is their token's `map_id`, full stop** — no separate
  "where is this player" table. v1 assumes one PC token per player per
  campaign; multiple tokens per player would need a real redesign (docs/11 §10).
- **Native dev day-to-day, Docker only to ship.** Don't restructure the
  README or the default workflow back toward "Docker for local dev" — that
  was tried and explicitly reverted this session.
- **`GET /api/campaigns/:id` no longer returns `activeMapId`** — it returns
  `liveMaps`/`viewerMapId`/`memberTokens` (docs/11). If you see `activeMapId`
  referenced anywhere (old branches, stale notes), it's dead.
- **Every campaign requires a Game** (`campaigns.game_id NOT NULL`, docs/12)
  — there is no standalone/game-less campaign path. `POST /api/campaigns`
  requires `gameId` in the body (`CreateCampaignRequest`); the old
  `api.createCampaign(name, joinCode?)` two-arg client signature is gone,
  replaced by a single request-object param.
- **Map templates are copy-on-assign, never a shared reference** (docs/12) —
  `map_templates` (Game-scoped) hold only the reusable asset (image + grid
  config); assigning one to a campaign copies it into a fresh `game_maps`
  row (`template_id` traces back to the template for reference only, no
  sync). Never make two campaigns point at the same `game_maps` row or let a
  campaign reference a `map_templates` row directly — fog/tokens are
  inherently per-playthrough state.
- **Campaign lifecycle is a manual GM toggle, not presence-inferred**
  (docs/12 §4) — `campaigns.status` (`draft`/`live`/`paused`/`completed`)
  moves only via explicit Start Session/End Session/Mark Complete actions.
  Chosen specifically to avoid a dropped-wifi GM reconnect flickering the
  status; don't switch this to socket-presence-based inference without a
  real reason to revisit docs/12 §9.

## Gotchas that will bite you (hard-won)

- **Build `shared` first.** Backend and frontend import `@vtt/shared` from its
  `dist/`. On a fresh checkout or after editing `shared`, run
  `npm run build -w shared` or nothing typechecks/runs.
- **Env loading order (backend).** `backend/src/env.ts` must be imported first
  in `index.ts`, before `db.ts`, because `db.ts` builds the `pg` pool from
  `process.env` at import time and ES imports evaluate depth-first.
- **`dotenv.config()` does not override an already-exported shell var.** If
  `DATABASE_URL` is exported in your terminal (e.g. from copy-pasting a
  README example without substituting your real username), it silently wins
  over the correct value in `.env`. `/health` returning `db:true` does NOT
  catch this — it only checks the var is *set*, not that it connects with a
  valid role. `unset DATABASE_URL` and restart if login fails with
  `role "..." does not exist`.
- **Vite reads `.env` from the repo root** only because `vite.config.ts` sets
  `envDir: '..'`. `VITE_SERVER_URL` falls back to `http://localhost:4000` if unset.
- **The `db:init` / `db:seed` / `db:setup` / `db:reset` npm scripts read
  `DATABASE_URL` from the shell environment, NOT from `.env`.** Either
  `export DATABASE_URL=...` first, or use the raw `psql -d vtt -f ...`
  commands (no env var needed).
- **Schema is edited in place, never migrated (pre-release).** A
  `schema.sql` change (like `campaign_live_maps`) needs `npm run db:reset`
  (native) or `docker compose down -v && docker compose up -d --build`
  (Docker) to actually apply — `CREATE TABLE IF NOT EXISTS` won't alter an
  existing table/DB.
- **Pixi v8 hit testing:** a `Container` with `eventMode: 'static'` still
  needs an explicit `hitArea` (its child `Graphics` is passive by default),
  or `pointerdown` never fires and token dragging silently does nothing.
  Large background/fog `Graphics` are set to `eventMode: 'none'` so they do
  not intercept clicks meant for tokens or the stage.
- **Drag guard:** the redraw effect early-returns while a drag is active, so
  an incoming delta cannot destroy the container being dragged.
- **A map switch (GM tab click, or a `map_relocated` push) is a full
  rejoin, not a delta.** The client just re-emits `join_map` with a new
  `mapId`; the resulting `state_sync` replaces the store wholesale, and the
  Pixi stage itself is torn down/recreated per `mapId`. Don't try to patch
  this into an incremental update.
- **The seeded demo map's background image 404s.** `seed.sql` references
  `/assets/demo-map.png` but that file was never actually shipped anywhere
  (repo or `uploads/`). Harmless — grid/tokens/fog all work — but don't be
  surprised by the broken-image icon; it's a known, low-priority gap.
- **TanStack Router: a parent route's component MUST render `<Outlet/>` for
  a nested child route to show at all.** `gameRoute` originally had
  `component: GamePage` directly (no Outlet); navigating to the nested
  `/campaigns/new` child changed the URL but nothing new ever mounted —
  `waitForURL` passed, the page just silently kept showing the parent's old
  content. Fixed by splitting into a thin layout route
  (`component: () => <Outlet/>`) plus an index child route holding the real
  page, mirroring the existing `lobbyRoute`/`lobbyHomeRoute` shell pattern.
  If you nest a new route under an existing one, check the parent's
  component renders `<Outlet/>` — this fails silently, not with an error.
- **Router loader data goes stale after a mutation elsewhere; TanStack does
  not auto-refetch it for you.** `GamePage` read `gameRoute`'s loader data
  once via `useState(loader.game)`; after creating a campaign via a
  different route and navigating back, the parent's cached loader snapshot
  still showed zero campaigns. Fixed with `router.invalidate()` after the
  mutating action, plus having `GamePage` always refetch on mount
  (`useEffect`) instead of trusting the loader snapshot — the same pattern
  `Lobby.tsx`/`LobbyHome.tsx` already used, for the same reason. Any screen
  whose loader data a sibling/child route can mutate needs this.
- **Ambiguous Playwright locators when a card has nested divs sharing
  text.** `page.locator('div', {hasText: ...}).last()` resolved to the
  innermost single-purpose div (just the campaign name) once the card grew
  a status badge and buttons as siblings, not the outer card. Fixed with an
  explicit `data-testid={`campaign-${id}`}` — this codebase already has
  this convention (`tab-`, `library-add-`); reach for it immediately rather
  than trying to out-clever `hasText`/`.last()`/`.first()`.

## Demo fixtures (`backend/db/seed.sql`)

| Entity | ID |
|--------|----|
| GM user "Game Master" (PIN `1234`) | `11111111-1111-1111-1111-111111111111` |
| Player user "Player One" (PIN `4321`) | `22222222-2222-2222-2222-222222222222` |
| Game "Demo Campaign" (join code `GAMEDEMO`) | `88888888-8888-8888-8888-888888888888` |
| Campaign "Demo Campaign" (join code `DEMO42`) | `33333333-3333-3333-3333-333333333333` |
| Map "Demo Map" (square, 70px, 16x12) | `44444444-4444-4444-4444-444444444444` |
| Player sheet "Aria" | `55555555-5555-5555-5555-555555555555` |
| Token "Aria" (player) | `66666666-6666-6666-6666-666666666666` |
| Token "Lurking Orc" (hidden monster) | `77777777-7777-7777-7777-777777777777` |

Also seeded: a `game_members` row for Player One on the Demo Game;
`campaign_members` rows for both users on the Demo Campaign; one
`campaign_live_maps` row (Demo Map, position 0) — without it the seeded GM
lands on an empty tab bar. **The Demo Campaign's `status` is `'live'`**, not
the schema default `'draft'` — it's meant to be an already-running,
immediately-enterable demo session, and the committed e2e suite assumes
this (it clicks straight through to "Enter" with no Start Session step).

The Orc is hidden on unrevealed cell `10,5`, so players do not receive it until
the GM reveals that cell. This is the anti-cheat demo fixture. If you run
UI/socket tests that mutate token positions, fog, or live tabs, reset
afterward (or just `npm run db:reset`):
```sql
UPDATE tokens SET map_id='44444444-4444-4444-4444-444444444444', x=105,y=105
 WHERE id='66666666-6666-6666-6666-666666666666';
UPDATE tokens SET x=735,y=385 WHERE id='77777777-7777-7777-7777-777777777777';
UPDATE game_maps SET revealed_tiles='["0,0","1,0","2,0","0,1","1,1","2,1","0,2","1,2","2,2"]'::jsonb
 WHERE id='44444444-4444-4444-4444-444444444444';
```

## How to verify your changes (this project's bar)

Static checks are necessary but not sufficient here. The owner expects runtime
evidence.
- `npm run build -w shared && npm run typecheck` (all three workspaces).
- `npm test` — the committed Vitest + Playwright suite against `vtt_test`
  (doc 06). Run it after any socket/schema/contract change; it catches real
  regressions (e.g. a locator that becomes ambiguous once a UI element gains
  a second on-screen occurrence).
- For socket changes not yet covered by the suite: drive real
  `socket.io-client` connections against the running backend and assert
  payloads.
- For UI changes: drive the real page. Playwright + Chromium are installed
  (`npx playwright install chromium` if missing); navigate to :5173, perform
  the action, and cross-check the database with `pg`. Take screenshots for
  visual changes and actually look at them — this project's owner cares about
  layout/styling quality, not just functional correctness.
- **`npx playwright test` fails with "port already in use" if anything else
  holds :4000/:5173.** Playwright's `webServer` config has
  `reuseExistingServer: false` by design, so it refuses to share a port
  with your own `npm run dev` session or a leftover backend process from a
  prior interrupted test run (`lsof -nP -iTCP:4000 -sTCP:LISTEN` to find
  it). Check what's actually listening before killing it — a long-running
  process (multi-hour uptime) is likely the owner's own manual dev session
  and needs their OK before you stop it; a process only seconds/minutes
  old is almost always your own leftover test run and safe to kill.
- Run scripts from inside the repo (module resolution) or copy temp scripts
  into the repo root; the scratchpad is outside `node_modules`.

## How the owner likes to work

- **No em dashes** in any output (code, docs, chat). Use commas, colons, or parentheses.
- **Concise, direct** responses. No filler.
- **Verify at runtime, not just typecheck.** Passing `tsc` is not "it works." Show evidence.
- **Broad install latitude for this app**: install whatever tooling the app needs (compilers, browser drivers) without stalling. Still confirm before destructive commands (e.g. `docker compose down -v`, `db:reset` — both wipe data).
- **Native dev by default, Docker only to ship.** Don't default to Docker for
  local iteration; that was explicitly tried and reverted.
- **Brainstorm before building a feature**, and use plan mode / ask
  clarifying questions when there is a real design fork. Engage with
  corrections rather than just re-answering.
- **Delegate research/exploration and parallelizable work to subagents**; do
  not research and implement in the same context when the task is large
  (though for a big mechanical pass like a docs sweep, direct execution with
  the research already summarized in-context is fine — use judgment).
- Cares about **visual/UI polish**, not just function — asked for a full GM
  HUD redesign this session when the shipped-fast version looked disjointed.
- There is a per-project memory at `.claude/projects/.../memory/` (e.g. a note
  on verification expectations). A fresh Claude Code instance loads
  `MEMORY.md` automatically.

## Suggested next steps (owner's call on priority — check docs/07 first)

1. **Player-facing Games/Campaigns dashboard** (docs/12 §9) — the natural
   next slice now that the GM-side Games hierarchy is built: "my
   Games/Campaigns," jump into whichever campaign is `live`, manage own
   character sheet outside a live campaign. No design started yet.
2. Character sheet UI wired to the existing `sheet_update` contract/handler.
3. GM toolkit Phase 2: token/monster CRUD (spawn, bestiary, HP/conditions) —
   the natural next slice per docs/11's own phase order.
4. Per-audience fog (docs/08, docs/11 Phase 3) — design is already settled,
   just not built.
5. "Rules/resources" as a Game-level content type (docs/12 §9) — NPC
   library, freeform notes, item tables; deliberately deferred, no design
   yet either.
6. Wire CI to run `npm test` on push (no `.github/workflows` exists yet).
7. Fix the missing `demo-map.png` seed asset (cosmetic, low priority).
8. Pan/zoom camera (note: input math currently assumes stage coords == CSS
   pixels; a camera transform means converting through it).

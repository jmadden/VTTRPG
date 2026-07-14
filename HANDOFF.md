# HANDOFF - VTT project

Read this first if you are a new AI instance picking up this project. It is the
fastest path to being productive without re-deriving context. Last updated
2026-07-13.

## What this is

A system-agnostic 2D virtual tabletop (VTT). It runs as one Docker stack,
hostable two ways: self-hosted on the GM's machine with players joining via an
ngrok or Tailscale tunnel, or on a DigitalOcean droplet with Caddy for automatic
TLS. The backend serves the SPA + API + sockets same-origin in both. See docs/10.
Voice/video is external.

Stack: React + PixiJS v8 (frontend), Node + Express + Socket.io + raw `pg`
(backend), local PostgreSQL, TypeScript throughout. npm-workspaces monorepo with
a `shared` package that is the single source of truth for the WebSocket
contract.

**Status: working end to end.** Backend and frontend run together with
`npm run dev`; the anti-cheat pipeline, fog of war (reveal + conceal), and token
dragging are implemented and have been verified against a live database and in a
real browser. It is a scaffold, not a finished product (see "Done vs not done").

## Read the docs (they are current, "as-built")

- `README.md` - detailed cross-machine setup, all required installs, run, troubleshooting.
- `docs/01-architecture.md` - monorepo layout, scripts, env loading, connection model.
- `docs/02-database-schema.md` - tables, JSONB, reveal/conceal SQL, seed fixtures.
- `docs/03-websocket-contracts.md` - every socket event payload and the room model.
- `docs/04-visibility-filter.md` - the server-side anti-cheat pipeline.
- `docs/05-pixi-shroud-strategy.md` - rendering, fog of war, input and dragging.
- `docs/06-verification.md` - how it was verified and how to reproduce.
- `shared/src/contracts.ts` - the authoritative payload types. If you change the
  wire protocol, change it here first; both ends fail to compile until they agree.

## Get it running in one minute

Prereqs already satisfied on the GM's dev machine: Node (dev on 24), PostgreSQL
18 via Homebrew (role = the OS user, trust auth, no password), database `vtt`
created and seeded, `.env` present.

```bash
cd /Users/jim/Claude/Code/TTRPG
npm run build -w shared     # only needed if shared/dist is missing or shared changed
npm run dev                 # backend :4000, frontend :5173
```
- Health: `curl http://localhost:4000/health` should return `{"ok":true,"db":true}`.
- UI: http://localhost:5173 (HUD has a GM/Player toggle, fog Reveal/Conceal tools).
- This machine's `.env` uses `DATABASE_URL=postgresql://jim@localhost:5432/vtt`.

On a fresh machine, follow `README.md` (installs Node + PostgreSQL, creates and
seeds the DB, writes `.env`).

## Done vs not done

Implemented and verified:
- Real-time token sync via tiny JSON deltas (`token_move`, `token_add`, `token_remove`).
- Manual click-to-reveal fog of war (`reveal_tiles`) and GM conceal (`conceal_tiles`), square and hex grids.
- Drag-and-drop tokens that snap to the grid cell center.
- Server-side anti-cheat: a hidden token on an unrevealed cell is stripped from players' payloads entirely; deltas that flip visibility are gated per audience.
- Server-side authorization (GM-only reveal/conceal; owner-or-GM for token_move and sheet_update) and `movableTokenIds` so the UI only offers draggable tokens the client may move.
- System-agnostic character sheets as JSONB with single-path `jsonb_set` updates.

Not done (likely next work):
- Login / identity: DONE (docs/09, `feat/login`). Real accounts + sessions, per-campaign roles, join code; the HUD GM/Player toggle is gone (role is server-derived).
- No map image upload. The map layer is a placeholder grid; `game_maps.asset_path` is unused by the renderer.
- `sheet_update` has a contract and server handler but no UI (no character sheet screen).
- No pan/zoom camera.
- Committed test suite: DONE. Vitest (unit + integration) + Playwright (e2e) via `npm test` on a `vtt_test` DB (doc 06). CI wiring is the remaining follow-up.
- Under version control now; the login feature lives on the `feat/login` branch.

## Locked decisions (do not relitigate without reason)

- **Raw `pg` + hand-written SQL**, no ORM. Chosen for JSONB path control and the anti-cheat query path.
- **npm workspaces + a `shared/` package** for the contract. Not independent packages (would let the wire contract drift).
- **Both square and hex grids** via a cell-key abstraction in `shared/src/coords.ts` (`"col,row"` / axial `"q,r"`).
- **PixiJS v8** (async `Application.init`, `app.canvas`, chained `Graphics` API). Do not use v7 patterns.
- **Fog is map-level** (one visibility view for all players); the only split is GM vs players. This keeps delta gating simple; keep it that way.
- **Fog color** slate blue-gray `0x3b4a63`; GM alpha 0.5, players 1.0.

## Gotchas that will bite you (hard-won)

- **Build `shared` first.** Backend and frontend import `@vtt/shared` from its `dist/`. On a fresh checkout or after editing `shared`, run `npm run build -w shared` or nothing typechecks/runs.
- **Env loading order (backend).** `backend/src/env.ts` must be imported first in `index.ts`, before `db.ts`, because `db.ts` builds the `pg` pool from `process.env` at import time and ES imports evaluate depth-first. It loads the repo-root `.env` via a path relative to the file (works under tsx and node).
- **Vite reads `.env` from the repo root** only because `vite.config.ts` sets `envDir: '..'`. `VITE_SERVER_URL` falls back to `http://localhost:4000` if unset.
- **The `db:init` / `db:seed` / `db:setup` npm scripts read `DATABASE_URL` from the shell environment, NOT from `.env`.** Either `export DATABASE_URL=...` first, or use the raw `psql -d vtt -f ...` commands (no env var needed). This is called out in the README.
- **Pixi v8 hit testing:** a `Container` with `eventMode: 'static'` still needs an explicit `hitArea` (its child `Graphics` is passive by default), or `pointerdown` never fires and token dragging silently does nothing. Large background/fog `Graphics` are set to `eventMode: 'none'` so they do not intercept clicks meant for tokens or the stage.
- **Drag guard:** the redraw effect early-returns while a drag is active, so an incoming delta cannot destroy the container being dragged.
- **The seeded player token sits under the HUD panel** (top-left) at world (105,105); when testing drags in a browser, drag something in open canvas (e.g. the orc) so `mouse.down` hits the canvas, not the DOM overlay.

## Demo fixtures (`backend/db/seed.sql`)

| Entity | ID |
|--------|----|
| Map (square, 70px, 16x12) | `44444444-4444-4444-4444-444444444444` |
| GM user | `11111111-1111-1111-1111-111111111111` |
| Player user | `22222222-2222-2222-2222-222222222222` |
| Player sheet "Aria" | `55555555-5555-5555-5555-555555555555` |
| Token "Aria" (player) | `66666666-6666-6666-6666-666666666666` |
| Token "Lurking Orc" (hidden monster) | `77777777-7777-7777-7777-777777777777` |

The Orc is hidden on unrevealed cell `10,5`, so players do not receive it until
the GM reveals that cell. This is the anti-cheat demo fixture. If you run
UI/socket tests that mutate token positions or fog, reset afterward:
```sql
UPDATE tokens SET x=105,y=105 WHERE id='66666666-6666-6666-6666-666666666666';
UPDATE tokens SET x=735,y=385 WHERE id='77777777-7777-7777-7777-777777777777';
UPDATE game_maps SET revealed_tiles='["0,0","1,0","2,0","0,1","1,1","2,1","0,2","1,2","2,2"]'::jsonb
 WHERE id='44444444-4444-4444-4444-444444444444';
```

## How to verify your changes (this project's bar)

Static checks are necessary but not sufficient here. The owner expects runtime
evidence.
- `npm run build -w shared && npm run typecheck` (all three workspaces).
- For socket changes: drive real `socket.io-client` connections against the
  running backend and assert payloads (join as GM vs player, reveal/conceal,
  moves). See doc 06 for the assertions used.
- For UI changes: drive the real page. Playwright + Chromium are installed
  (`npx playwright install chromium` if missing); navigate to :5173, perform the
  action, and cross-check the database with `pg`. Take screenshots for visual
  changes and actually look at them.
- Run scripts from inside the repo (module resolution) or copy temp scripts into
  the repo root; the scratchpad is outside `node_modules`.

## How the owner likes to work

- **No em dashes** in any output (code, docs, chat). Use commas, colons, or parentheses.
- **Concise, direct** responses. No filler.
- **Verify at runtime, not just typecheck.** Passing `tsc` is not "it works." Show evidence.
- **Broad install latitude for this app**: install whatever tooling the app needs (compilers, browser drivers) without stalling. Still confirm before destructive commands.
- **Brainstorm before building a feature** (there is a brainstorming workflow), and use plan mode / ask clarifying questions when there is a real design fork. The owner will sometimes reject a batched question to add context first; engage, do not just answer.
- **Delegate research/exploration and parallelizable work to subagents**; do not research and implement in the same context.
- There is a per-project memory at `.claude/projects/.../memory/` (e.g. a note on verification expectations). A fresh Claude Code instance loads `MEMORY.md` automatically.

## Suggested backlog (owner's call on priority)

1. `git init` + `.gitignore`, commit the current state.
2. Login / user-select screen; drop the hardcoded seeded IDs.
3. Map image upload and render the real `asset_path` in the map layer.
4. Character sheet UI wired to `sheet_update`.
5. Commit the socket + browser checks as a real `npm test` suite with a test DB.
6. Pan/zoom camera (note: input math currently assumes stage coords == CSS pixels; a camera transform means converting through it).

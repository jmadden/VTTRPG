# 01 - Directory Structure & Scaffolding

System-agnostic 2D VTT. It runs as one Docker stack that can be self-hosted on
the GM's machine (players join via an ngrok or Tailscale tunnel) or deployed to a
DigitalOcean droplet (Caddy provides automatic TLS); in both, the backend serves
the SPA + API + sockets same-origin. See docs/10. The local dev workflow
(`npm run dev`) is described below. Voice/video is external.

This doc describes the system **as built**. For setup and run instructions see
the root `README.md`.

## Monorepo layout (npm workspaces)

```
vtt/
├─ package.json              # root: workspaces + concurrently dev/build scripts
├─ tsconfig.base.json        # shared strict TS compiler options
├─ .env.example              # template; copy to .env (see README)
├─ .env                      # local, machine-specific (not for other machines)
├─ README.md                 # setup + run guide
├─ docs/                     # design + as-built documentation (this folder)
│
├─ shared/                   # @vtt/shared - single source of truth for the wire
│  ├─ src/
│  │  ├─ contracts.ts        # every WebSocket event payload type + EV names
│  │  ├─ api.ts              # REST DTOs (CampaignDetail, LiveMapEntry, MemberTokenDto, ...)
│  │  ├─ coords.ts           # square + hex cell math (worldToCell, cellToWorld, ...)
│  │  └─ index.ts            # barrel re-export
│  ├─ dist/                  # compiled output (built; consumed by the other pkgs)
│  ├─ package.json
│  └─ tsconfig.json
│
├─ backend/                  # @vtt/backend - Node + Express + Socket.io
│  ├─ src/
│  │  ├─ env.ts              # loads root .env FIRST (before db.ts builds the pool)
│  │  ├─ index.ts            # Express (health + assets) + Socket.io bootstrap
│  │  ├─ db.ts               # pg Pool + query helper
│  │  ├─ auth.ts             # bcrypt PIN hashing, session tokens, requireAuth middleware (doc 09)
│  │  ├─ routes.ts           # REST: register/login/logout/me, campaigns, maps (doc 09)
│  │  ├─ repo.ts             # hand-written SQL mapped to shared domain types
│  │  ├─ socket/
│  │  │  └─ index.ts         # all socket event handlers (contract + auth)
│  │  ├─ lib/
│  │  │  ├─ visibilityFilter.ts   # anti-cheat choke point (see doc 04)
│  │  │  └─ liveMaps.ts           # pure set_live_maps normalization (doc 11)
│  │  └─ scripts/
│  │     └─ pinReset.ts      # one-off CLI to reset a seeded user's PIN
│  ├─ db/
│  │  ├─ schema.sql          # raw PostgreSQL DDL (see doc 02)
│  │  └─ seed.sql            # deterministic demo data
│  ├─ package.json
│  └─ tsconfig.json
│
└─ frontend/                 # @vtt/frontend - Vite + React + TanStack Router + PixiJS
   ├─ index.html
   ├─ src/
   │  ├─ main.tsx            # React mount + RouterProvider; hydrates session before render
   │  ├─ router.tsx          # TanStack Router (code-based): login, lobby, campaign/map, manage
   │  ├─ api.ts              # REST client (bearer token in localStorage)
   │  ├─ socket.ts           # typed socket.io-client (shared event maps)
   │  ├─ store.ts            # tiny vanilla store (useSyncExternalStore)
   │  ├─ game/PixiStage.ts   # Pixi v8 Application, layers, input (see doc 05)
   │  └─ routes/
   │     ├─ Login.tsx        # display name + PIN sign in / register (doc 09)
   │     ├─ Lobby.tsx        # campaign list, create, join by code
   │     ├─ MapsManager.tsx  # GM map library CRUD (upload; "Manage" route)
   │     ├─ MapView.tsx      # wires socket <-> store <-> Pixi + the GM/player HUD
   │     ├─ mapUpload.ts     # shared upload helper (MapsManager + LibraryDrawer)
   │     ├─ ui.ts            # shared style tokens (panel, card, surface, accentGm, ...)
   │     └─ gm/              # GM-only in-game toolkit UI (doc 11)
   │        ├─ TabBar.tsx        # live map tabs
   │        ├─ LibraryDrawer.tsx # "Map Library" drawer: add existing / upload new
   │        └─ PlayersPanel.tsx  # drag a player's row onto a tab to relocate them
   ├─ package.json
   ├─ tsconfig.json
   └─ vite.config.ts
```

`shared/` is depended on by both `backend/` and `frontend/` via the workspace
protocol (`"@vtt/shared": "*"`). Change a payload type once and both ends fail
to compile until they agree: the compile-time guarantee the delta protocol
relies on. `shared` must be built (`npm run build -w shared`) so its `dist/`
exists before the other packages typecheck or run.

## Why npm workspaces (not independent packages)

The architecture is built on tiny JSON deltas plus a server-side authority that
strips hidden tokens. The client and server MUST agree on those payload shapes
exactly. Keeping the contract types in one workspace package (`@vtt/shared`)
gives one definition; independent packages would duplicate the contract and let
it drift silently, the worst failure mode for a real-time sync protocol.

`concurrently` spins up both servers from a single `npm run dev` at the root. No
extra package manager is needed (unlike pnpm).

## Root scripts

From `package.json`:

| Script | What it does |
|--------|--------------|
| `npm run dev` | `concurrently` runs backend (`tsx watch`) and frontend (`vite`) together — native day-to-day dev |
| `npm run build` | Builds `shared`, then `backend`, then `frontend` (order matters) |
| `npm run start` | `SERVE_CLIENT=1` + run the built backend (serves the SPA same-origin; no Vite) |
| `npm run serve` | `build` then `start` — local prod-parity run without Docker |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces |
| `npm run db:init` | `psql "$DATABASE_URL" -f backend/db/schema.sql` (needs `DATABASE_URL` exported in the shell) |
| `npm run db:seed` | `psql "$DATABASE_URL" -f backend/db/seed.sql` (demo data; needs `DATABASE_URL` exported) |
| `npm run db:setup` | `db:init` then `db:seed` |
| `npm run db:reset` | Drop + recreate the `public` schema, then `db:setup` — schema is edited in place pre-release (no migrations), so this is how a changed `schema.sql` gets picked up |
| `npm run deploy:local` | `docker compose up -d --build` — build + start the Docker stack (doc 10) |
| `npm run deploy:cloud` | Same, plus Caddy (`--profile edge`) for a real domain |
| `npm run deploy:down` | `docker compose down` |
| `npm run test` | `build -w shared` + ensure `vtt_test` exists + `test:unit` + `test:e2e` (doc 06) |
| `npm run test:unit` / `test:e2e` | Just the Vitest or just the Playwright suite |

Root devDependencies: `typescript`, `@types/node`, `concurrently`, `vitest`, and
`@playwright/test`/`playwright` (used for the committed suite in doc 06).

## Environment loading (a real gotcha, solved)

There is one `.env` at the repo root, shared by both packages, but each package
runs with its own working directory under `npm run dev`:

- **Backend**: `src/env.ts` is imported first in `index.ts` and calls
  `dotenv.config({ path: ../../.env })` resolved relative to the file (works
  under `tsx` from `src/` and under `node` from `dist/`). It must run before
  `db.ts` is evaluated, because `db.ts` builds the `pg` pool from
  `process.env.DATABASE_URL` at import time. ES module imports evaluate
  depth-first, so a plain top-level `dotenv.config()` in `index.ts` would run
  too late; the dedicated `env.ts` import fixes the ordering.
- **Frontend**: `vite.config.ts` sets `envDir: '..'` so Vite reads `VITE_*`
  variables from the root `.env` too. If `VITE_SERVER_URL` is unset, the client
  falls back to `http://localhost:4000`.

## Player connection model

Entry point is login, not a bare URL: every player (including the GM) signs in
with a display name + PIN (doc 09); role is derived per campaign
(`campaigns.gm_user_id`), not a client toggle. Two ways to actually reach the
app:

**Native dev** (day-to-day building, this doc's default): GM runs `npm run
dev`; the backend binds `PORT` (4000) and Vite serves with `host: true` (all
interfaces) on 5173. Players open the GM's LAN IP (`http://192.168.x.x:5173`)
or an ngrok tunnel pointed at both ports. `CORS_ORIGINS` (backend) and
`VITE_SERVER_URL` (frontend) must include whichever origin players actually
use. See `.env.example` and the README.

**Docker (hosting a real session)**: the backend serves the SPA + API +
sockets same-origin on one port, so there's no CORS config at all — players
just open whatever URL reaches that port (`localhost`, a LAN IP, an ngrok/
Tailscale tunnel, or a real domain via Caddy). See doc 10 for the three
deployment modes and README section 8.

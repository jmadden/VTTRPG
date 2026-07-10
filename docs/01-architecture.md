# 01 - Directory Structure & Scaffolding

Local-host, system-agnostic 2D VTT. The entire stack runs on the GM's machine;
players connect over LAN IP or an ngrok tunnel. Voice/video is external.

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
│  │  ├─ repo.ts             # hand-written SQL mapped to shared domain types
│  │  ├─ socket/
│  │  │  └─ index.ts         # all socket event handlers (contract + auth)
│  │  └─ lib/
│  │     └─ visibilityFilter.ts   # anti-cheat choke point (see doc 04)
│  ├─ db/
│  │  ├─ schema.sql          # raw PostgreSQL DDL (see doc 02)
│  │  └─ seed.sql            # deterministic demo data
│  ├─ package.json
│  └─ tsconfig.json
│
└─ frontend/                 # @vtt/frontend - Vite + React + TanStack Router + PixiJS
   ├─ index.html
   ├─ src/
   │  ├─ main.tsx            # React mount + RouterProvider
   │  ├─ router.tsx          # TanStack Router (code-based, one route)
   │  ├─ socket.ts           # typed socket.io-client (shared event maps)
   │  ├─ store.ts            # tiny vanilla store (useSyncExternalStore)
   │  ├─ game/PixiStage.ts   # Pixi v8 Application, layers, input (see doc 05)
   │  └─ routes/MapView.tsx  # wires socket <-> store <-> Pixi + HUD controls
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
| `npm run dev` | `concurrently` runs backend (`tsx watch`) and frontend (`vite`) together |
| `npm run build` | Builds `shared`, then `backend`, then `frontend` (order matters) |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces |
| `npm run db:init` | `psql "$DATABASE_URL" -f backend/db/schema.sql` (needs `DATABASE_URL` exported in the shell) |
| `npm run db:seed` | `psql "$DATABASE_URL" -f backend/db/seed.sql` (demo data; needs `DATABASE_URL` exported) |
| `npm run db:setup` | `db:init` then `db:seed` |

Root devDependencies: `typescript`, `@types/node`, `concurrently`, and
`playwright` (used for the browser end-to-end checks in doc 06).

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

1. GM runs `npm run dev`; the backend binds `PORT` (4000) and Vite serves with
   `host: true` (all interfaces) on 5173.
2. Players open the GM's LAN IP (`http://192.168.x.x:5173`) or an ngrok tunnel.
3. `CORS_ORIGINS` (backend) and `VITE_SERVER_URL` (frontend) must include
   whichever origin players actually use. See `.env.example` and the README.

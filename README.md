# VTT - Cloud-Hosted 2D Virtual Tabletop

A system-agnostic 2D virtual tabletop that runs as one Docker stack, hostable two
ways: self-host it on your own machine and let remote players in via a tunnel
(ngrok or Tailscale), or deploy it to a DigitalOcean droplet where Caddy provides
automatic TLS. Play is remote in both. Voice and video are handled by external
tools (Discord, etc.). See `docs/10-cloud-deployment.md` for the deployment guide
(all three run modes).

**Stack:** React + PixiJS (frontend), Node + Express + Socket.io (backend),
PostgreSQL (Dockerized in the deployment stack; local for dev), TypeScript
throughout. It is an npm-workspaces monorepo with a shared package that holds the
WebSocket contract as a single source of truth.

**Features implemented:**
- Real-time token sync over Socket.io using tiny JSON deltas.
- Manual click-to-reveal fog of war (square and hex grids), plus a GM
  conceal tool to paint fog back.
- Drag-and-drop tokens that snap to the grid.
- Server-side anti-cheat: hidden tokens on unrevealed cells are stripped from
  players' payloads entirely.
- System-agnostic character sheets stored as JSONB.

---

## 1. Project layout

```
shared/    @vtt/shared - wire contract types + square/hex cell math
backend/   Express + Socket.io + raw pg; db/schema.sql, db/seed.sql
frontend/  Vite + React + TanStack Router + PixiJS
docs/      design + as-built docs (01 architecture ... 10 deployment: Docker + DigitalOcean)
```

---

## 2. Required software

Install these before anything else. Versions in parentheses are what this
project was developed against; newer patch/minor releases are fine.

| Tool | Minimum | Notes |
|------|---------|-------|
| Git | any | to obtain the code |
| Node.js + npm | Node 20+ (dev on 24) | npm ships with Node |
| PostgreSQL | 14+ (dev on 18) | includes the `psql` and `createdb` CLIs |

Optional:

| Tool | Purpose |
|------|---------|
| Playwright browsers | run the browser end-to-end checks (`npx playwright install chromium`) |
| ngrok | let players connect from outside your LAN |

### 2a. Install Node.js

**macOS / Linux (recommended: nvm)**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart your shell, then:
nvm install 20
nvm use 20
```
**macOS (Homebrew alternative):** `brew install node`
**Windows:** install the LTS build from https://nodejs.org, or
`winget install OpenJS.NodeJS.LTS`

Verify:
```bash
node --version   # v20 or newer
npm --version
```

### 2b. Install PostgreSQL

**macOS (Homebrew)**
```bash
brew install postgresql@18
brew services start postgresql@18
# ensure the CLIs are on PATH (Apple Silicon path shown):
echo 'export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"' >> ~/.zshrc
exec zsh
```
On Homebrew, PostgreSQL creates a superuser role equal to your macOS username,
with trust authentication for local connections (no password).

**Ubuntu / Debian**
```bash
sudo apt update
sudo apt install postgresql postgresql-client
sudo systemctl enable --now postgresql
```
The default superuser is `postgres` (access via `sudo -u postgres ...`).

**Windows**
Install via `winget install PostgreSQL.PostgreSQL.16` or the EDB installer from
https://www.postgresql.org/download/windows/. The installer creates the
`postgres` superuser and asks you to set its password. Use the bundled
"SQL Shell (psql)" or add the PostgreSQL `bin` folder to your PATH.

Verify:
```bash
psql --version
pg_isready          # should say "accepting connections"
```

---

## 3. Get the code and install dependencies

```bash
git clone <your-repo-url> vtt   # or copy the project folder
cd vtt
npm install                     # hydrates all three workspaces
```

Build the shared package once so the backend and frontend can resolve its types
(required on a fresh checkout, since `shared/dist/` is generated):
```bash
npm run build -w shared
```

---

## 4. Create and seed the database

Make sure the PostgreSQL server is running (`pg_isready`), then:

**macOS (Homebrew) / any setup where your OS user is a Postgres superuser**
```bash
createdb vtt
psql -d vtt -f backend/db/schema.sql
psql -d vtt -f backend/db/seed.sql      # optional demo data
```

**Linux (using the postgres superuser)**
```bash
sudo -u postgres createdb vtt
sudo -u postgres psql -d vtt -f backend/db/schema.sql
sudo -u postgres psql -d vtt -f backend/db/seed.sql
```

**Windows (SQL Shell / psql, as postgres)**
```bash
createdb -U postgres vtt
psql -U postgres -d vtt -f backend/db/schema.sql
psql -U postgres -d vtt -f backend/db/seed.sql
```

The schema creates the `users`, `campaigns`, `character_sheets`, `game_maps`,
and `tokens` tables (see `docs/02-database-schema.md`). The seed adds a demo
campaign, map, and tokens (see the Demo section below).

**Alternative (npm scripts):** if you export `DATABASE_URL` in your shell first,
you can use the bundled scripts instead of the per-OS `psql` commands above:
```bash
export DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/vtt
npm run db:setup     # runs db:init (schema) then db:seed (demo data)
# or individually:
npm run db:init      # schema only
npm run db:seed      # demo data only
```
Both the schema and the seed are idempotent, so re-running is safe.

> **Important:** the `db:init`, `db:seed`, and `db:setup` scripts read
> `DATABASE_URL` from your **shell environment only**. They do **not** read the
> `.env` file you create in step 5 (that `.env` is loaded by the backend at
> runtime, not by these psql scripts). So you must `export DATABASE_URL=...`
> first, or just use the per-OS `psql -d vtt -f ...` commands above, which need
> no environment variable at all.

---

## 5. Configure environment

Copy the template and edit it to match your database:
```bash
cp .env.example .env
```

`.env` is machine-specific; do not carry another machine's `.env` over. Set
`DATABASE_URL` for your setup:

- **macOS Homebrew** (role = your username, no password):
  ```
  DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/vtt
  ```
- **Linux / Windows** (postgres role with the password you set):
  ```
  DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/vtt
  ```

Other variables:
```
PORT=4000                                  # backend HTTP + Socket.io port
ASSET_DIR=./uploads                        # where map images are served from
CORS_ORIGINS=http://localhost:5173         # origins allowed to connect
VITE_SERVER_URL=http://localhost:4000      # backend URL the browser uses
```

`CORS_ORIGINS` accepts a comma-separated list. Add each origin players will
actually use (LAN IP, ngrok URL). The backend loads this root `.env` via
`backend/src/env.ts`; the frontend reads `VITE_*` from it via Vite `envDir`.

---

## 6. Run

```bash
npm run dev        # starts backend (:4000) and frontend (:5173) together
```

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health should return
  `{"ok":true,"db":true}`

Stop with Ctrl-C.

---

## 7. Try the demo

Open http://localhost:5173. The HUD (top-left) provides:

- **View as GM / Player** - rejoins as the seeded GM or player user. In Player
  view any hidden token on an unrevealed cell disappears (the anti-cheat,
  visible in the UI).
- **Drag tokens** - grab a token and drop it; it snaps to the cell center and
  broadcasts the move. The GM can move any token; a player only their own.
- **Fog tool REVEAL / CONCEAL** (GM only) - click an empty cell to uncover it or
  to paint fog back over it. Concealing a cell re-hides any hidden token
  standing on it from players.

Seeded IDs (from `backend/db/seed.sql`):

| Entity | ID |
|--------|----|
| Map | `44444444-4444-4444-4444-444444444444` |
| GM user | `11111111-1111-1111-1111-111111111111` |
| Player user | `22222222-2222-2222-2222-222222222222` |

A hidden "Lurking Orc" sits on unrevealed cell `10,5`; players do not receive it
until the GM reveals that cell.

---

## 8. Let players connect from other machines

Players on the same LAN:
1. Find the GM machine's LAN IP (macOS: `ipconfig getifaddr en0`; Linux:
   `hostname -I`; Windows: `ipconfig`).
2. Add both the LAN frontend and backend origins to `.env`, then restart
   `npm run dev`:
   ```
   CORS_ORIGINS=http://localhost:5173,http://192.168.1.20:5173
   VITE_SERVER_URL=http://192.168.1.20:4000
   ```
3. Players open `http://192.168.1.20:5173`. Allow the ports through the GM
   machine's firewall if prompted.

Players outside the LAN (ngrok): tunnel the frontend (and backend) and add the
generated `https://…ngrok…` URLs to `CORS_ORIGINS` / `VITE_SERVER_URL`.

Security note: this is a local trust model with no real authentication. Do not
expose it directly to the public internet beyond a trusted play group.

---

## 9. Verify the install

```bash
npm run typecheck      # tsc across shared, backend, frontend
```

Optional browser end-to-end checks need the Chromium binary once:
```bash
npx playwright install chromium
```
See `docs/06-verification.md` for the full verification approach and what the
end-to-end checks assert.

---

## 10. Scripts reference

Run from the repo root:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend together |
| `npm run build` | Build shared, then backend, then frontend |
| `npm run build -w shared` | Build only the shared package (needed on fresh checkout) |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run db:init` | Apply `schema.sql` (requires `DATABASE_URL` exported in your shell) |
| `npm run db:seed` | Apply `seed.sql` demo data (requires `DATABASE_URL` exported) |
| `npm run db:setup` | Run `db:init` then `db:seed` (requires `DATABASE_URL` exported) |

---

## 11. Troubleshooting

- **`/health` shows `"db":false` or the backend logs a connection error**:
  `DATABASE_URL` is unset or wrong. Confirm `.env` exists at the repo root and
  the value matches your Postgres role/password/db name. Check the server is up
  with `pg_isready`.
- **`role "..." does not exist` / `password authentication failed`**: your
  `DATABASE_URL` user does not match your Postgres setup. On Linux/Windows use
  the `postgres` user and its password; on macOS Homebrew use your OS username
  with no password.
- **`Cannot find module '@vtt/shared'` or type errors about it**: run
  `npm run build -w shared` (its `dist/` must exist).
- **`psql: command not found`**: the PostgreSQL client is not on your PATH (see
  step 2b, especially the Homebrew PATH line).
- **Port already in use (4000 or 5173)**: another process is bound. Stop it, or
  change `PORT` in `.env` (backend) / the Vite port in `frontend/vite.config.ts`.
- **Players get CORS errors or cannot connect**: the origin they use is not in
  `CORS_ORIGINS`, or `VITE_SERVER_URL` points at `localhost` instead of the GM's
  reachable IP. Update `.env` and restart.
- **Fog looks wrong / tokens not draggable after editing shared types**:
  rebuild shared (`npm run build -w shared`) and reload; the contract types are
  the source of truth for both ends.

---

## 12. Documentation

- `docs/01-architecture.md` - monorepo layout, scripts, env loading, connection model
- `docs/02-database-schema.md` - tables, JSONB usage, reveal/conceal SQL, seed data
- `docs/03-websocket-contracts.md` - every event payload and the room model
- `docs/04-visibility-filter.md` - the server-side anti-cheat pipeline
- `docs/05-pixi-shroud-strategy.md` - rendering, fog of war, input/dragging
- `docs/06-verification.md` - how the system is verified and how to reproduce it
- `docs/07-features.md` - feature backlog and status tracker (roadmap)
- `docs/08-per-audience-visibility.md` - per-player / per-audience fog design (not yet built)
- `docs/09-login-and-identity.md` - login, sessions, and per-campaign roles design (not yet built)
- `docs/10-cloud-deployment.md` - deployment: one Docker stack, three modes (local, self-host + tunnel, DigitalOcean); built and verified locally
- `shared/src/contracts.ts` - the authoritative payload types

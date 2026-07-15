# VTT - Cloud-Hosted 2D Virtual Tabletop

A system-agnostic 2D virtual tabletop that runs as one Docker stack, hostable two
ways: self-host it on your own machine and let remote players in via a tunnel
(ngrok or Tailscale), or deploy it to a DigitalOcean droplet where Caddy provides
automatic TLS. Play is remote in both. Voice and video are handled by external
tools (Discord, etc.). Day-to-day development is native (no Docker) for fast
iteration; Docker is only for actually hosting a session. See
`docs/10-cloud-deployment.md` for the full deployment guide (all three modes).

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
- GM toolkit Phase 1: a per-campaign map library, GM-managed live map tabs,
  and cross-map token relocation (players auto-load whichever map their
  token is on).

---

## 1. Project layout

```
shared/    @vtt/shared - wire contract types + square/hex cell math
backend/   Express + Socket.io + raw pg; db/schema.sql, db/seed.sql
frontend/  Vite + React + TanStack Router + PixiJS
docs/      design + as-built docs (01 architecture ... 10 deployment ... 11 GM toolkit)
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
| Docker Desktop | only needed when you're ready to host (section 8) — not for day-to-day dev |

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
`campaign_live_maps`, and `tokens` tables (see `docs/02-database-schema.md`).
The seed adds a demo campaign, map, and tokens (see the Demo section below).

**Alternative (npm scripts):** if you export `DATABASE_URL` in your shell first,
you can use the bundled scripts instead of the per-OS `psql` commands above:
```bash
export DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/vtt
npm run db:setup     # runs db:init (schema) then db:seed (demo data)
# or individually:
npm run db:init      # schema only
npm run db:seed      # demo data only
```
Both the schema and the seed are idempotent, so re-running is safe. After a
schema change, re-apply with `npm run db:reset` (drops + recreates, then
re-seeds).

> **Important:** the `db:init`, `db:seed`, `db:setup`, and `db:reset` scripts
> read `DATABASE_URL` from your **shell environment only**. They do **not**
> read the `.env` file you create in step 5 (that `.env` is loaded by the
> backend at runtime, not by these psql scripts). So you must
> `export DATABASE_URL=...` first, or just use the per-OS `psql -d vtt -f ...`
> commands above, which need no environment variable at all.

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

`CORS_ORIGINS` accepts a comma-separated list. The backend loads this root
`.env` via `backend/src/env.ts`; the frontend reads `VITE_*` from it via Vite
`envDir`. (This same `.env` also holds the `POSTGRES_*` variables Docker
Compose reads in section 8 — they're inert for native dev, so it's safe to
fill in both sets now if you know you'll deploy later.)

---

## 6. Run

```bash
npm run dev        # starts backend (:4000) and frontend (:5173) together, with hot reload
```

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health should return
  `{"ok":true,"db":true}`

Stop with Ctrl-C. This is the day-to-day workflow — Docker is not involved.

---

## 7. Try the demo

Open http://localhost:5173. You land on a login screen; sign in with a seeded
account (or register a new one), then the lobby lists your campaigns. Click
**Enter** on the Demo Campaign to open the map.

Seeded accounts (from `backend/db/seed.sql`):

| Display name | PIN | Role in Demo Campaign |
|--------------|-----|-----------------------|
| `Game Master` | `1234` | GM |
| `Player One` | `4321` | player |

In the map, the toolbar (GM) / HUD (player) provides:

- **Drag tokens** - grab a token and drop it; it snaps to the cell center. The GM
  can move any token; a player only their own.
- **Fog tool Reveal / Conceal** (GM only) - click an empty cell to uncover it or
  paint fog back over it. Concealing re-hides any hidden token on that cell from
  players.
- **Live map tabs** (GM only) - the tab bar switches between the GM's live
  maps; **Map Library** adds an existing library map as a tab (or uploads a
  new one straight into the live set); the **Players** panel relocates a
  player by dragging their row onto a tab.

Role is **server-derived** from the campaign (creator = GM), not a client toggle.
The hidden "Lurking Orc" on unrevealed cell `10,5` is visible to the GM but
stripped from players until the GM reveals that cell (the anti-cheat). The Demo
Campaign's join code is `DEMO42` (used when a second account joins via the lobby).

---

## 8. Deploying / hosting with Docker

Everything above is native, local, and disposable — good for building the
app, not for actually running a session with other people. When you're ready
to host, Docker is the packaging: same image, same `docker-compose.yml`,
three modes. Full walkthrough in `docs/10-cloud-deployment.md`; the essentials:

### 8a. One-time setup

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(includes the Compose plugin) — no separate Node/Postgres install needed for
this path, Docker builds everything. Confirm with `docker compose version`.

In your `.env` (the same file from section 5), set a `POSTGRES_PASSWORD`:
```
POSTGRES_USER=vtt
POSTGRES_PASSWORD=<a real value, not the placeholder>
POSTGRES_DB=vtt
```

### 8b. Local smoke test

```bash
docker compose up -d --build
curl http://localhost:4000/health   # {"ok":true,"db":true}
```
Builds the image and starts `postgres-db` + `vtt-app` (both show up in Docker
Desktop), serving the built SPA + API + Socket.io same-origin on :4000 — no
`:5173`, no CORS config, nothing else to wire up. Auto-applies
`backend/db/schema.sql` + `backend/db/seed.sql` on the database's first init.
Open http://localhost:4000 and log in as above to confirm it works.

```bash
docker compose down             # stop (keeps the pgdata/uploads volumes)
docker compose down -v          # stop AND wipe the DB — see the schema note below
docker compose logs -f vtt-app  # tail logs
```
(`npm run deploy:local` / `npm run deploy:down` are shorthands for the two
`up`/`down` commands above, if you have Node installed — not required.)

> **Schema changes:** the database only runs its init scripts once, on the
> *first* boot of a fresh `pgdata` volume. If `backend/db/schema.sql` changes
> after your volume already exists (e.g. you pulled new commits, or built the
> image before a schema change like `campaign_live_maps`), the running
> container's schema is stale until you `docker compose down -v && docker
> compose up -d --build`. This wipes all data in the containerized Postgres —
> fine for local/demo use, back up first if you've put real campaign data in it.

### 8c. Self-host + tunnel (let remote players in tonight)

Keep the stack from 8b running, then expose port 4000 from your machine:

- **ngrok** (simplest, no player install): `ngrok http 4000`, share the
  `https://…ngrok-free.app` URL. Free tier shows a one-time click-through
  interstitial; a new URL each run.
- **Tailscale Funnel** (stable URL, no interstitial): `tailscale funnel 4000`
  after enabling Funnel for your tailnet, players use your
  `https://<machine>.<tailnet>.ts.net` URL.
- **Tailscale Serve** (most private): `tailscale serve 4000`, only reachable
  by people you invite into your tailnet.
- **Same-LAN players**: set `APP_BIND=0.0.0.0` in `.env` and restart
  (`docker compose up -d --build`), players open `http://YOUR_LAN_IP:4000`.

Because the Docker build is same-origin, players just open the URL — nothing
to rebuild or reconfigure. See `docs/10-cloud-deployment.md` for the full
walkthrough of each tunnel option.

Security note: login is display name + PIN (bcrypt) with per-campaign join
codes, but the PIN space is small (see the threat model in
`docs/09-login-and-identity.md`). Keep any public tunnel within a trusted group.

### 8d. DigitalOcean (a real domain, always-on)

`npm run deploy:cloud` (`docker compose --profile edge up -d --build`) adds
Caddy for automatic Let's Encrypt TLS on a real domain. Full copy-paste guide
(droplet sizing, DNS, firewall, first launch, backups) is in
`docs/10-cloud-deployment.md`.

### 8e. Docker troubleshooting

- **No container shows up in Docker Desktop**: you haven't run `docker
  compose up -d --build` yet — day-to-day dev (sections 2-7) never touches
  Docker at all, by design.
- **`POSTGRES_PASSWORD` error on `docker compose up`**: `.env` doesn't have it
  set (see 8a).
- **Port already in use (4000)**: a native `npm run dev` is still running, or
  a leftover container. `docker ps` / stop the other process first.
- **Demo Map's thumbnail/background is a broken image (404 on
  `/assets/demo-map.png`)**: known gap — `backend/db/seed.sql` references that
  path but no such file ships in the repo or the `uploads` volume. Harmless
  (grid/tokens/fog all work); upload a real map to replace it, or ignore it.

---

## 9. Verify the install

```bash
npm run typecheck      # tsc across shared, backend, frontend
createdb vtt_test      # one-time test DB
npx playwright install chromium   # one-time, for the e2e
npm test               # Vitest (unit + integration) + Playwright (e2e)
```
`npm test` uses ports :4000 and :5173, so stop any running dev/Docker app first.
See `docs/06-verification.md` for the full suite layout and what it asserts.

---

## 10. Scripts reference

Run from the repo root:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend together, with hot reload (day-to-day dev) |
| `npm run build` | Build shared, then backend, then frontend |
| `npm run build -w shared` | Build only the shared package (needed on fresh checkout) |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run db:init` | Apply `schema.sql` (requires `DATABASE_URL` exported in your shell) |
| `npm run db:seed` | Apply `seed.sql` demo data (requires `DATABASE_URL` exported) |
| `npm run db:setup` | Run `db:init` then `db:seed` (requires `DATABASE_URL` exported) |
| `npm run db:reset` | Drop + recreate schema, then setup (needed after schema changes) |
| `npm test` | Vitest unit + integration and Playwright e2e (needs `vtt_test`) |
| `npm run test:unit` / `npm run test:e2e` | Run just the Vitest or just the Playwright suite |
| `npm run deploy:local` | **Docker:** build + start (`docker compose up -d --build`) — see section 8 |
| `npm run deploy:cloud` | **Docker:** same, plus Caddy for a real domain (`--profile edge`) |
| `npm run deploy:down` | **Docker:** stop the stack (add `-- -v` to also wipe volumes/data) |

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
- **Fog looks wrong / tokens not draggable after editing shared types**:
  rebuild shared (`npm run build -w shared`) and reload; the contract types are
  the source of truth for both ends.
- **Stale login after a `db:reset` / fresh seed**: an old browser tab may still
  hold a token for a session that no longer exists. The app detects this and
  drops you back to `/login` automatically; if it doesn't, hard-refresh or use
  an incognito window.
- Docker-specific issues: see section 8e.

---

## 12. Documentation

- `docs/01-architecture.md` - monorepo layout, scripts, env loading, connection model
- `docs/02-database-schema.md` - tables, JSONB usage, reveal/conceal SQL, seed data
- `docs/03-websocket-contracts.md` - every event payload and the room model
- `docs/04-visibility-filter.md` - the server-side anti-cheat pipeline
- `docs/05-pixi-shroud-strategy.md` - rendering, fog of war, input/dragging
- `docs/06-verification.md` - how the system is verified and how to reproduce it
- `docs/07-features.md` - feature backlog and status tracker (roadmap)
- `docs/08-per-audience-visibility.md` - per-player / per-audience fog design (not yet built; folded into docs/11 phase 3)
- `docs/09-login-and-identity.md` - login, sessions, and per-campaign roles design (built)
- `docs/10-cloud-deployment.md` - deployment: one Docker stack, three modes (local, self-host + tunnel, DigitalOcean); built and verified locally
- `docs/11-gm-toolkit.md` - GM toolkit design: tab-based multi-map model, tokens, per-audience fog, session tools, builder (Phase 1 built; phases 2-5 not yet)
- `shared/src/contracts.ts` - the authoritative payload types

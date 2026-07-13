# 10 - Cloud Deployment (Render)

**Status: decided, not yet built.** Full cloud hosting on Render is the chosen
model for how this game is run. Play is always remote (there is effectively no
LAN/co-located play), so a stable public server is required for every session.
This doc is the design; nothing here is implemented yet. It supersedes the
local-host + ngrok model as the *deployment* target; local setup remains only
for development.

Render figures were verified against render.com docs (July 2026); pricing and
free-tier terms change, so re-check render.com/pricing before acting.

## 1. Why cloud, and why this was reopened

An earlier pass concluded cloud offered "no real advantage." That conclusion
rested on LAN being a consideration (LAN is the lowest-latency path; a cloud DB
would break a no-wifi game night; ngrok is only occasional). Once play is
**always remote**, those objections disappear and the picture inverts:

- ngrok becomes mandatory for **every** session, permanently. A stable cloud URL
  removes it entirely (public URL + automatic TLS).
- The server never renders (all PixiJS rendering is client-side), so this is not
  a hardware/performance decision. Cloud's value is **availability and
  durability**, not horsepower.
- A managed database solves data **continuity** for free: a dead or stolen
  laptop loses nothing, because campaigns, sheets, maps, and fog live in the
  cloud, not on the GM's machine.
- Latency and internet-dependency, the old downsides, cost nothing now because
  every session is remote and already depends on the internet.

## 2. Why it fits the architecture

The backend is a state authority that syncs tiny JSON deltas over Socket.io;
rendering happens in each browser (docs 01, 03, 05). That makes cloud hosting
easy:

1. **Single instance is enough** for a table of players, and Render treats a
   single-instance WebSocket server as first-class. We must **not** autoscale:
   Render has no WebSocket sticky sessions, and one instance sidesteps that.
2. **The server already binds correctly:** `backend/src/index.ts` reads `PORT`
   and calls a bare `listen(PORT)`, which binds all interfaces. No change needed.
3. **Config is already env-driven:** `DATABASE_URL`, `PORT`, `CORS_ORIGINS`,
   `ASSET_DIR`, and the frontend `VITE_SERVER_URL` are environment variables, so
   cloud vs local is config, not a code fork. Local dev keeps working unchanged.

## 3. Topology: one same-origin web service

Serve the built frontend from the backend so the SPA, REST API, and socket all
live on **one origin**:

```
Browser ->  https://vttrpg.onrender.com
              |-- GET /            -> frontend/dist (SPA)
              |-- GET /api/...     -> Express (login, campaigns; see docs/09)
              |-- WS  /socket.io   -> Socket.io
Render web service  ->  Render Postgres (same region)
```

Why single-service over a separate static site + web service:

- **No CORS.** Same origin removes the `CORS_ORIGINS` allow-list entirely.
- **`VITE_SERVER_URL` can be empty.** The client connects the socket to its own
  origin; no per-environment backend URL to bake in.
- **Auth is simpler.** Same origin plus Render's automatic HTTPS makes the
  docs/09 bearer-token flow trivial.
- **One thing to deploy, one URL, one bill.**

## 4. Code and config changes required

All small and env-gated, so local `npm run dev` is unaffected:

1. **Postgres SSL (`backend/src/db.ts`).** The pool is currently
   `new Pool({ connectionString: DATABASE_URL })` with no `ssl`. Use Render's
   same-region **internal** database URL (no SSL needed) for the running
   service, and add `ssl: { rejectUnauthorized: false }` behind an env flag for
   external connections (needed when running schema/seed from a laptop).
2. **Serve the SPA (`backend/src/index.ts`).** Add
   `express.static('frontend/dist')` plus an SPA catch-all fallback to
   `index.html`, alongside the existing `/health` and `/assets`.
3. **Same-origin socket (`frontend/src/socket.ts`).** When `VITE_SERVER_URL` is
   unset, connect to the current origin (`io()` with no URL) instead of the
   `http://localhost:4000` fallback.
4. **Deploy artifacts.** Add `render.yaml` (one web service + one Postgres, env
   wired from the DB resource), a `.node-version` to pin Node exactly (the repo
   only pins `>=20`), and the `db:reset` script noted in docs/09. Build command
   is the existing root `npm run build`; start is `npm run start -w backend`.

**These four deltas are now implemented behind env flags** (local `npm run dev`
is unchanged); section 6 shows how to build and run them locally. The remaining
Render plumbing (provisioning the service and DB, first-deploy env wiring) is
roughly half a day. The larger dependency is building the docs/09 login
(section 9), which blocks going public.

## 5. Database on Render

- Provision a Render Postgres, then run schema + seed once. The existing scripts
  already take a URL (`db:init` / `db:seed` run `psql "$DATABASE_URL" -f ...`),
  so pointing `DATABASE_URL` at the Render database (external URL with
  `sslmode=require` from a laptop) sets it up.
- Add the missing `db:reset` (drop schema, re-run setup); pre-release we reset
  rather than migrate (docs/09 §8).
- Free Postgres is 1 GB, ample for JSONB sheets, fog arrays, and tokens. Expiry
  is the catch (section 7).
- Continuity is now a first-class property: the database is the single home for
  all game data, and a paid instance carries automatic point-in-time recovery
  backups. Nothing lives only on the GM's laptop.

## 6. Local build and test parity

Before deploying, run the exact production setup on your machine. The env-gated
deltas from section 4 make the backend serve the built SPA same-origin, just
like Render.

```bash
npm run serve        # build (shared + backend + frontend/dist) then serve on :4000
# or, iterating:
npm run build && npm start
```

Open `http://localhost:4000` (single origin): the SPA, REST, and WebSocket are
all on one port with no CORS, exactly the Render layout. `npm run dev` (Vite
:5173 + backend :4000) is unchanged, because SPA serving is gated behind
`SERVE_CLIENT` (set only by `npm start` / `npm run serve` and on Render).

Environment flags:
- `SERVE_CLIENT=1` - backend serves `frontend/dist` with an SPA fallback.
- `VITE_SERVER_URL` empty - the built client uses its own origin for the socket.
- `DATABASE_SSL=1` - only for a managed cloud DB that requires SSL; unset for
  local Postgres.

`npm run db:reset` drops and rebuilds the schema + seed (pre-release we reset,
never migrate). Verified locally: `/health` returns `{"ok":true,"db":true}`, the
SPA is served at `/`, deep links fall back to `index.html`, `/socket.io`
handshakes on the same origin, and unknown `/api/*` routes 404 (not masked by
the SPA fallback).

Local-test then deploy: run `npm run serve`, click through, then push. Render
runs the same `npm run build` / `npm run start -w backend` from `render.yaml`.

## 7. Cost and on/off

Cloud is the model, but you still want it cheap and effectively "off" between
sessions. Current numbers:

| Option | Monthly cost | Behavior | Catch |
|--------|--------------|----------|-------|
| **A. All free** | $0 | Free web service sleeps after 15 min idle and cold-starts (~1 min) on the next visit, an automatic on/off. 750 instance-hours/month/workspace. | Free Postgres is **deleted ~30 days** after creation (14-day grace). Fine to validate the deploy, not for durable campaigns. |
| **B. Free web + paid Postgres** (recommended) | ~$6-7/mo | Web still auto-sleeps ($0 idle compute); wake with a visit before game night. | ~1 min cold start on the night's first connection. DB persists, with backups. |
| **C. Paid web + paid Postgres** | ~$13-14/mo always-on | No cold starts; suspend/resume the web service in the dashboard for deliberate on/off. Persistent disk available for map uploads. | Costs the most; DB keeps billing while the web service is suspended. |

Notes:
- Cold starts only bite the first connection of the evening; constant in-game
  traffic keeps a free service awake mid-session.
- Recommended path: deploy on **A** to validate end to end, then move the
  database to **B** as soon as there is campaign data worth keeping.

## 8. Gotchas

- **Free Postgres expires every ~30 days.** Removed by Option B.
- **Ephemeral filesystem.** `ASSET_DIR=./uploads` does not survive a redeploy or
  restart, and the free tier has no persistent disks. Committed seed assets are
  fine (they ship in the build), but the roadmap's **map-image upload** feature
  (docs/07 §1) needs a persistent disk (paid, $0.25/GB/mo, pins one
  instance/region) or external object storage. Design uploads accordingly.
- **Single instance only.** No WebSocket sticky sessions on Render, so do not
  autoscale. If we ever must scale, force the websocket transport (drop HTTP
  long-polling) and add a shared Socket.io adapter.

## 9. Hard dependency: login must ship first

A public URL that is up whenever you play turns the current "any client can
claim any `userId`" hole (docs/09 §1) into a standing invitation to impersonate
the GM. So **the docs/09 login is a precondition for going public**, not an
optional follow-up. Render serves HTTPS automatically, which also means the
plain-HTTP transport concern that shaped some of docs/09 no longer applies in
production (bearer tokens remain the recommendation regardless).

## 10. Order of operations

1. Build the docs/09 login (name + PIN, sessions, socket handshake auth). Blocker.
2. (Done) Local prod parity + Render artifacts: same-origin static serve, pg SSL
   env-gate, same-origin socket, `render.yaml`, `.node-version`, `db:reset`
   (section 6).
3. Deploy on the all-free tier (Option A); provision + seed the DB; confirm a
   real login round-trips and the socket connects over TLS.
4. Move the database to Option B once there is campaign data worth keeping.
5. Revisit persistent storage when map-image upload is built.

Build-order note: docs/09 (login) and docs/08 (per-audience fog) both precede a
public launch; login is the hard blocker, and the fog work depends on the
authenticated `campaign_members` this login introduces.

# Brainstorming: Hosting the VTT on Render

*Status: exploratory assessment, nothing here is committed work. Related backlog entry: docs/07-features.md §5 "Move off a single local host to better infrastructure" (Future). Render figures verified against render.com docs, July 2026; pricing and free-tier terms change, so re-check render.com/pricing before acting.*

## The question

Right now the stack runs on the GM's machine and players reach it over LAN or an
ngrok tunnel. ngrok is doing a lot of heavy lifting (public URL, TLS, NAT
traversal). How hard would it be to run the whole thing (including login/auth)
on Render instead, and turn it on and off for game nights? And can that live
alongside the local-host model rather than replacing it?

## The short answer

**Difficulty: low.** Nothing in the architecture fights cloud hosting, and
Render can host it as an *additional* deploy target while local play stays
exactly as it is today. The Render-specific work is mostly configuration plus a
handful of small, env-gated code edits. The one real precondition is auth: a
public URL that is up 24/7 makes the login design in `docs/09` **mandatory**,
because today the server trusts whatever `userId` a client claims (see §8).

The recommended shape is **one Render web service that serves the built SPA, the
API, and the WebSocket, all same-origin, plus one Render Postgres**.

## Why it fits the architecture

The backend is a state authority that syncs tiny JSON deltas over Socket.io;
all rendering happens in the players' browsers (docs 01, 03, 05). Render does
not care whether the client is served from Vite locally or from a CDN. Three
properties make this an easy target:

1. **Single instance is enough.** Six players and small deltas hold fine on one
   instance, and Render treats a single-instance WebSocket server as a
   first-class case. (We must *not* autoscale: Render has no WebSocket sticky
   sessions. Staying at one instance sidesteps that entirely.)
2. **Server binds correctly already.** `backend/src/index.ts` reads `PORT` from
   env and calls a bare `listen(PORT)`, which binds all interfaces. That is what
   Render expects; no change needed there.
3. **Config is already env-driven.** `DATABASE_URL`, `PORT`, `CORS_ORIGINS`,
   `ASSET_DIR`, and the frontend's `VITE_SERVER_URL` are all environment
   variables. Cloud vs local is a config difference, not a code fork.

## Recommended topology: one same-origin web service

Serve the built frontend from the backend so the SPA, the REST API, and the
socket all live on **one origin**:

```
Browser ->  https://vttrpg.onrender.com
              |-- GET /            -> frontend/dist (SPA)
              |-- GET /api/...     -> Express (login, campaigns; see docs/09)
              |-- WS  /socket.io   -> Socket.io
Render web service  ->  Render Postgres (same region)
```

Why single-service over the obvious "Static Site for the frontend + Web Service
for the backend" split:

- **No CORS.** Same origin means the `CORS_ORIGINS` dance disappears, and
  Socket.io connects to its own origin with no configured allow-list.
- **`VITE_SERVER_URL` can be empty.** The client points the socket at the same
  origin, so there is no build-time backend URL to bake in per environment.
- **docs/09 auth gets simpler.** Same-origin makes the bearer-token flow trivial,
  and because Render serves HTTPS automatically, `Secure` cookies would even
  work if we ever wanted them (docs/09 still recommends bearer tokens).
- **One thing to turn on and off**, one URL to share, one bill.

The two-service split is viable (and lets the frontend ride Render's static CDN),
but it reintroduces cross-origin CORS and a per-environment `VITE_SERVER_URL`,
for no benefit at this scale.

## Code and config changes required

All small, and all gated so **local `npm run dev` is completely unaffected**:

1. **Postgres SSL (`backend/src/db.ts`).** Today the pool is
   `new Pool({ connectionString: DATABASE_URL })` with no `ssl`. Render's
   external Postgres connections require SSL. Two clean options: use Render's
   **internal** database URL (same-region service to DB, no SSL needed) for the
   running service, or add `ssl: { rejectUnauthorized: false }` behind an env
   flag for external connections (needed when running schema/seed from a laptop).
2. **Serve the SPA (`backend/src/index.ts`).** Add
   `express.static('frontend/dist')` plus an SPA catch-all fallback to
   `index.html`, alongside the existing `/health` and `/assets`. This is the
   single-origin move.
3. **Default socket URL to same-origin (`frontend/src/socket.ts`).** When
   `VITE_SERVER_URL` is unset, connect to the current origin (`io()` with no URL)
   instead of falling back to `http://localhost:4000`.
4. **Deploy artifacts.** Add a `render.yaml` blueprint (one web service + one
   Postgres, env wired from the DB resource), a `.node-version` to pin the exact
   Node (the repo only pins `>=20`), and the `db:reset` script already noted in
   docs/09. Build command is the existing root `npm run build` (shared, then
   backend, then frontend); start command is `npm run start -w backend`.

Estimated effort for the Render plumbing itself: roughly half a day, most of it
first-deploy fiddling (env wiring, running the schema against the cloud DB,
confirming the socket connects over TLS). The larger dependency is building the
docs/09 login, which was already planned.

## Database on Render

- Provision a Render Postgres, then run the schema and seed against it once. The
  existing scripts already take a URL: `db:init` and `db:seed` run
  `psql "$DATABASE_URL" -f ...`, so pointing `DATABASE_URL` at the Render
  database (external URL with `sslmode=require` from a laptop) sets it up.
- Add the missing `db:reset` (drop schema, re-run setup); pre-release we reset
  rather than migrate (see docs/09 §8).
- Free Postgres is 1 GB, which is plenty for JSONB sheets, fog arrays, and
  tokens. The catch is expiry, covered next.

## Turning it on and off: three cost options

The owner wants to switch it on for game nights and off otherwise. Here is the
tradeoff space with current numbers.

| Option | Monthly cost | On/off behavior | Main catch |
|--------|--------------|-----------------|------------|
| **A. All free** | $0 | Web service sleeps after 15 min idle and cold-starts (~1 min) on the next visit. Crude but automatic. | Free Postgres is **deleted ~30 days** after creation (14-day grace). Campaign data must be dumped/restored or re-seeded monthly. |
| **B. Free web + paid Postgres** (recommended) | ~$6-7/mo | Web still auto-sleeps ($0 idle compute); wake with a visit before game night. | ~1 min cold start on the night's first connection. DB persists, with backups. |
| **C. Paid web + paid Postgres** | ~$13-14/mo always-on | Cleanest control: manually **suspend/resume** the web service in the dashboard (compute billed to the second), or just leave it always-on (no cold start ever). | Costs the most; the DB keeps billing even while the web service is suspended. |

Notes that matter for "on/off":

- **Cold starts only bite the first connection.** During a live session there is
  constant socket traffic, so a free service will not sleep mid-game; the ~1 min
  spin-up only affects whoever opens the URL first that evening.
- **Manual suspend/resume** (Option C, or via Render's API) is the truest "turn
  it on when I want" control and avoids cold-start surprises, at a price.
- **Free instance hours:** 750 per workspace per month. Intermittent game-night
  use is nowhere near that; do not try to run a free service always-on all month.

Recommendation: **Option B.** It keeps compute at $0 when idle, gives a real
persistent database with backups, and the only downside is a one-minute wait at
the start of the evening. Start on the all-free Option A to prove the deploy, then
upgrade only the database once there is campaign data worth keeping.

## Gotchas

- **Free Postgres expires every ~30 days.** The single biggest annoyance of the
  all-free path. Option B (paid DB) removes it.
- **Ephemeral filesystem.** `ASSET_DIR=./uploads` does not survive a redeploy or
  restart on Render, and the free tier has no persistent disks at all. Committed
  seed assets are fine (they ship in the build), but the roadmap's **map-image
  upload** feature (docs/07 §1) will need a persistent disk (paid, $0.25/GB/mo,
  which also pins you to one instance/region) or external object storage. Design
  uploads with that in mind.
- **Single instance only.** No WebSocket sticky sessions on Render, so do not
  enable autoscaling. If we ever must scale, force the socket to the websocket
  transport (drop HTTP long-polling) and add a shared Socket.io adapter; not
  needed at this scale.
- **Auth is now load-bearing.** See below.

## The hard dependency: login must ship first

Going public flips the threat model. On LAN or an ephemeral ngrok URL the "any
client can claim any `userId`" hole (docs/09 §1) is low-exposure. A stable,
internet-reachable Render URL that is up whenever you are playing turns that into
a standing invitation to impersonate the GM. So **the docs/09 login system is a
precondition for hosting on Render**, not an optional follow-up. One upside: Render
serves HTTPS automatically, so the plain-HTTP LAN constraint that shaped docs/09's
"bearer token, not cookies" decision no longer applies in the cloud (bearer tokens
stay the recommendation regardless, and keep working unchanged).

## Suggested order of operations

1. Build the docs/09 login (name + PIN, sessions, socket handshake auth). Blocker.
2. Add the same-origin static-serve, the pg SSL handling, and the socket
   same-origin default (all env-gated).
3. Add `render.yaml`, `.node-version`, and `db:reset`.
4. Deploy on the all-free tier (Option A); provision + seed the DB; confirm the
   socket connects over TLS and a real login round-trips.
5. Once there is campaign data worth keeping, upgrade to Option B (paid Postgres).
6. Revisit persistent storage when/if map-image upload is built.

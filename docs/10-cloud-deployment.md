# 10 - Deployment (Docker: self-host + tunnel, or DigitalOcean)

**Status: built and verified locally.** One Docker stack runs in three modes
from the same image: a local test, self-hosting with a public tunnel (ngrok or
Tailscale), or a DigitalOcean droplet behind Caddy. This supersedes the earlier
Render plan (removed).

Why one build covers all of it: the production runtime is same-origin. The
backend serves the built SPA + REST + Socket.io on one port (`SERVE_CLIENT=1`,
`backend/src/index.ts`), and the SPA is built with an empty `VITE_SERVER_URL`,
so the client connects its socket to whatever URL it was loaded from. The same
image therefore works at `http://localhost:4000`, a `*.ngrok-free.app` URL, a
`*.ts.net` Funnel URL, or a real domain, with no rebuild and no CORS config. No
application code changes.

## Architecture

```
                 (public entry differs per mode)
   localhost:4000  |  ngrok/Tailscale URL  |  https://YOUR_DOMAIN (Caddy)
                    \         |            /
                     vtt-app (Node 22)  -- serves SPA + API + Socket.io same-origin :4000
                        |  DATABASE_URL -> postgres-db
                     postgres-db (postgres:16-alpine)  -- named volume pgdata
```

Compose services: **postgres-db** and **vtt-app** always run; **caddy** runs
only under the `edge` profile (DigitalOcean). The app port is published on
loopback (`127.0.0.1:4000`) so localhost and host-run tunnels reach it, while it
stays off a droplet's public interface. Named volumes persist across restarts:
`pgdata`, `uploads` (`/app/uploads`), and `caddy_data`/`caddy_config`.

## The three modes

| Mode | Command | Public entry | TLS |
|------|---------|--------------|-----|
| Local test | `npm run deploy:local` (`docker compose up -d --build`) | `http://localhost:4000` | none |
| Self-host + tunnel | `npm run deploy:local`, then a tunnel (below) | the tunnel URL | at the tunnel edge |
| DigitalOcean | `npm run deploy:cloud` (`docker compose --profile edge up -d --build`) | `https://YOUR_DOMAIN` | Let's Encrypt via Caddy |

`npm run deploy:down` stops the stack (add `-v` to also wipe the volumes).

## Config files (at repo root)

`Dockerfile` (multi-stage, Node 22 Alpine, non-root), `.dockerignore` (excludes
`.env` so the same-origin build is preserved and no dev secrets leak),
`docker-compose.yml` (the three services, `caddy` gated behind `profiles:
["edge"]`, app published as `${APP_BIND:-127.0.0.1}:4000:4000`), and `Caddyfile`
(`reverse_proxy vtt-app:4000` under `{$SITE_ADDRESS}`; Caddy handles the
WebSocket upgrade automatically). Environment lives in the root `.env` (compose
reads it); see `.env.example`. Key vars: `POSTGRES_PASSWORD` (required),
`POSTGRES_USER`/`POSTGRES_DB` (default `vtt`), `SITE_ADDRESS` (only used by the
`edge`/Caddy mode; `:80` locally, your domain in prod), and `APP_BIND` (set
`0.0.0.0` for direct LAN play). The database auto-applies `schema.sql` and
`seed.sql` on first init via `docker-entrypoint-initdb.d`.

## Run and test locally (Docker Desktop)

```bash
cp .env.example .env             # set POSTGRES_PASSWORD
npm run deploy:local             # build image + start postgres-db + vtt-app
curl http://localhost:4000/health   # {"ok":true,"db":true}
```
Open http://localhost:4000, log in as the seeded GM or player (docs/09 —
`Game Master`/`1234` or `Player One`/`4321`; role is server-derived from
login, no client toggle), and drive the demo (live map tabs, reveal/conceal
fog, drag a token). Data and uploads persist across
`deploy:down` / `deploy:local`; `docker compose down -v` wipes them. On the very
first boot Postgres runs its init scripts on a temporary socket, so the app may
log a couple of DB errors for a second before it connects; it self-heals.

## Self-host + tunnel (let remote players in without a server)

Keep the local stack running (`npm run deploy:local`), then expose port 4000
from your machine with a tunnel. Because the app is same-origin, players just
open the tunnel URL; nothing is rebuilt.

**ngrok** (public, no player install):
```bash
ngrok http 4000
```
Share the `https://…ngrok-free.app` URL. The free tier shows a one-time
click-through interstitial (harmless; the top-level page load clears it before
the socket opens) and issues a new URL each run.

**Tailscale Funnel** (public, no player install, stable URL, no interstitial):
enable HTTPS + Funnel for your tailnet in the admin console, then expose the
port (check `tailscale funnel --help` for your version's exact syntax, which has
changed across releases):
```bash
tailscale funnel 4000
```
Players open your stable `https://<machine>.<tailnet>.ts.net` URL.

**Tailscale Serve** (private, most secure): players install Tailscale and you
invite them to your tailnet; `tailscale serve 4000` exposes it inside the
tailnet only (valid `*.ts.net` cert, no public exposure). Best for a fixed group.

Caddy is not used in these modes; the tunnel terminates TLS and provides the
hostname. Tunnels support WebSockets, so Socket.io works unchanged.

## Deploy to a DigitalOcean droplet (Ubuntu)

Copy-paste guide; replace `YOUR_DOMAIN` and the Postgres password.

1. **Droplet:** Ubuntu 22.04/24.04, 2 GB+ RAM (the Vite build needs headroom; on
   1 GB add a swap file). Note the public IP.
2. **DNS:** point `YOUR_DOMAIN` (a custom domain or a free `duckdns.org`
   subdomain) at the droplet IP with an `A` record. Caddy needs a resolvable
   hostname to get a Let's Encrypt certificate.
3. **SSH in:** `ssh root@DROPLET_IP`.
4. **Install Docker:** `curl -fsSL https://get.docker.com | sh` then
   `docker compose version` to confirm the compose plugin.
5. **Firewall (if ufw):** `ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable`.
6. **Get the code:** `git clone <your-repo-url> /opt/vtt && cd /opt/vtt`.
7. **Env:** `cp .env.example .env`; set a strong `POSTGRES_PASSWORD` and
   `SITE_ADDRESS=YOUR_DOMAIN` (a bare hostname).
8. **Launch:** `npm run deploy:cloud` (or `docker compose --profile edge up -d
   --build`). First run builds the image, initializes the DB, and Caddy fetches
   the certificate automatically once DNS resolves.
9. **Verify:** open `https://YOUR_DOMAIN` (valid cert) and
   `https://YOUR_DOMAIN/health` returns `{"ok":true,"db":true}`; two browsers
   sync in real time.

### Operations

- **Logs:** `docker compose logs -f vtt-app` (or `caddy`, `postgres-db`).
- **Update:** `cd /opt/vtt && git pull && npm run deploy:cloud`.
- **Backups (cron):** Postgres is self-managed here, so dumps are your job:
  ```bash
  0 3 * * * cd /opt/vtt && docker compose exec -T postgres-db pg_dump -U vtt vtt > /opt/vtt-backups/vtt-$(date +\%F).sql
  ```
  If backups become a burden, a DigitalOcean Managed Database (automated backups,
  ~$15/mo) is a drop-in: drop the `postgres-db` service, point `DATABASE_URL` at
  the managed connection string, and set `DATABASE_SSL=1`.

## Notes and gotchas

- **Seeding.** The compose file auto-loads `seed.sql` so the first launch has the
  demo fixture to smoke-test. For a clean production DB, delete the `seed.sql`
  line from `postgres-db` volumes and `docker compose down -v` before first real
  launch. Moot once in-app content creation (docs/09, docs/07) ships.
- **Password changes after first init** do not take effect on the existing
  `pgdata` volume; `docker compose down -v` (destroys data) or change it in-DB.
- **Login is built** (docs/09) — display name + bcrypt-hashed PIN, per-campaign
  join codes. The residual risk is the small PIN space (4-6 digits), not an
  absence of auth. Keep any public tunnel/droplet within a trusted group
  regardless.
- **Scaling.** Single app instance, so no sticky-session config is needed. If you
  ever scale out, force the websocket transport and add a shared Socket.io
  adapter (Redis).

## What was verified

Locally on Docker Desktop: the image builds; `postgres-db` + `vtt-app` come up
healthy; `http://localhost:4000/health` returns `db:true`; the same-origin SPA
loads and its Socket.io handshake delivers `state_sync` in a real browser; a
browser token drag round-trips over the socket and persists to the containerized
DB; and with the `edge` profile, HTTP and the WebSocket both ride through Caddy
on :80. The tunnel URLs and the Let's Encrypt certificate on a real domain are
verified by you when you run those modes (the same-origin path they depend on is
proven).

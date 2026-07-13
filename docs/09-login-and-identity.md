# 09 - Login & Campaign Identity

**Status: design, not yet built.** This doc specifies the login system, session
model, and how a user's role (GM or player) is derived from the campaign they
join. It resolves the "Login / user-select screen" item in `docs/07-features.md`.
Docs 01-06 describe the current as-built system; nothing here is implemented yet.

## 1. Why

Today there is no identity at all:

- The frontend hardcodes two seeded UUIDs behind a HUD "view as GM/Player"
  toggle (`frontend/src/routes/MapView.tsx`).
- The socket layer trusts whatever `userId` the client puts in `join_map`. The
  server checks that the user *exists* (`getUserRole`) and then grants that
  user's role. **Any client can claim the GM's UUID and get GM powers.** On a
  public deployment (docs/10), which is internet-reachable whenever it is up,
  that is an open door.

The identity rule this design installs:

```
role = f(user, campaign)
```

Everyone logs in as a **user**. A user who **creates** a campaign is that
campaign's GM (`campaigns.gm_user_id`, which already exists). A user who
**joins** a campaign is a player in it. The same person can be the GM of one
campaign and a player in another. The fixed `users.role` column is dropped.

## 2. Threat model (honest framing)

Display name + 4-6 digit PIN, served over HTTPS. Play is always remote on a
public URL (cloud host, see docs/10), so transport is encrypted and the app is
internet-reachable whenever it is up. This stops **casual impersonation**: a
player typing the GM's ID, a stranger who finds the URL and clicks around. It
does not stop a determined attacker (a 6-digit PIN space is only 10^6). The
residual risk is that small PIN space, not the transport. Mitigations are sized
to that reality: bcrypt-hashed PINs, per-name rate limiting, and random 256-bit
session tokens.

## 3. Data model deltas

Four changes to `backend/db/schema.sql`. Pre-release rollout: edit the schema in
place and reset the database (section 8); no migrations.

**`users`** - drop `role` and the `user_role` enum entirely (role is now
derived per campaign). Replace `pin` with `pin_hash TEXT NOT NULL` (bcrypt). The
PIN is **required** at registration: an optional PIN would reintroduce the exact
impersonation hole this design closes. Add case-insensitive name uniqueness:

```sql
CREATE UNIQUE INDEX users_display_name_unique ON users (lower(display_name));
```

Login is by name, so names must be unique; lower() blocks "Bob"/"bob"
visual-spoof accounts.

**`sessions`** (new) - sessions survive server restarts:

```sql
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,          -- sha256(token); the raw token is never stored
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The token itself is `crypto.randomBytes(32).toString('base64url')`, returned to
the client once at login. Storing only its sha256 means a leaked DB dump or
backup does not yield live sessions, for one line of code.

**`campaign_members`** (new) - explicit membership:

```sql
CREATE TABLE campaign_members (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX campaign_members_user_idx ON campaign_members (user_id);
```

The GM gets a member row too (inserted at campaign creation), so "list this
campaign's members" is one uniform query. Role is never stored in this table; it
is always derived from `campaigns.gm_user_id`. This table also feeds the
per-audience fog design: the docs/08 audience selector is "this campaign's
members" (section 10).

**`campaigns`** - add `active_map_id UUID REFERENCES game_maps(id) ON DELETE
SET NULL`, added via `ALTER TABLE` at the end of the schema file because
`game_maps` is defined after `campaigns`. Nullable: a fresh campaign has no maps
yet.

## 4. Auth mechanics

- **PIN storage: bcrypt** (cost ~10). Compare latency (~50-100ms) is itself a
  mild brute-force brake.
- **Rate limiting:** in-memory fixed window keyed by `lower(display_name)`,
  **not** by IP, because behind the reverse proxy remote players share the
  proxy's IP unless the forwarded header is parsed.
  Five failures locks the name for 60 seconds; success resets. In-memory is
  fine at this trust level; a restart clearing counters is acceptable.
- **Generic failures:** login returns the same 401 ("wrong name or PIN") whether
  the name exists or not, so the endpoint cannot be used to enumerate users.
- **Session transport: a bearer token in localStorage, not cookies.** Production
  is same-origin over HTTPS (the backend serves the SPA; see docs/10), so
  `Secure` cookies would technically work. Bearer tokens are still preferred:
  they are origin-agnostic (identical behavior in cloud and in cross-origin local
  dev, where the Vite :5173 and backend :4000 origins differ) and CSRF-immune (no
  ambient credentials). The tradeoff is XSS token theft, acceptable with no
  third-party content.
- **Expiry: none.** Sessions live until logout (or PIN reset). Hygiene: bump
  `last_seen_at` on socket handshake; purge sessions idle more than 30 days at
  server boot.

## 5. REST contract

The backend currently exposes only `GET /health` and static `/assets`. Two
middleware additions to `backend/src/index.ts`: `express.json()` and
`cors({ origin: CORS_ORIGINS })`, reusing the **same parsed env list** Socket.io
already uses for its CORS (one constant, two consumers; they must never drift).
An auth middleware reads `Authorization: Bearer <token>`, sha256s it, looks up
`sessions`, and sets `req.userId`, else 401.

All endpoints under `/api`:

| Endpoint | Auth | Body -> Response | Notes |
|----------|------|------------------|-------|
| `POST /api/register` | no | `{displayName, pin}` -> 201 `{token, user}` | Auto-login on register. 409 on name collision. PIN validated 4-6 digits. |
| `POST /api/login` | no | `{displayName, pin}` -> `{token, user}` | Rate limited; generic 401. |
| `POST /api/logout` | yes | -> 204 | Deletes the session row. |
| `GET /api/me` | yes | -> `{user}` | Boot-time token validation. |
| `GET /api/campaigns` | yes | -> `[{id, name, gmName, memberCount, isMember, isGm}]` | Lobby list. Lists all campaigns (open join; see section 9). |
| `POST /api/campaigns` | yes | `{name}` -> 201 campaign | Sets `gm_user_id` = caller; inserts the GM's member row. |
| `POST /api/campaigns/:id/join` | yes | -> campaign detail | `ON CONFLICT DO NOTHING`; idempotent re-join. |
| `GET /api/campaigns/:id` | yes, member | -> `{id, name, gmUserId, activeMapId, members: [{id, displayName, isGm}]}` | Feeds the lobby detail, map entry, and later the docs/08 audience selector. |

New repo functions (`backend/src/repo.ts`): `createUser`, `getUserByName`,
`createSession` / `getSessionUser` / `deleteSession` / `touchSession`,
`listCampaigns`, `createCampaign`, `joinCampaign`, `getCampaignDetail`,
`getCampaignForMap(mapId)`, `isCampaignMember`. `getUserRole` is deleted along
with `users.role`.

## 6. Socket handshake and contract deltas

**Handshake middleware** (`io.use` in `backend/src/socket/index.ts`): read
`socket.handshake.auth.token`, validate against `sessions`, set
`socket.data.userId`; otherwise `next(new Error('unauthorized'))`, which the
client receives as `connect_error` and routes to `/login`. Identity is
established once per socket, before any event handler runs.

**`join_map` becomes `{ mapId }`.** The `userId` field leaves the wire contract
entirely; it was the impersonation hole. Server flow: map ->
`getCampaignForMap` -> membership check -> `role = (socket.data.userId ===
campaign.gmUserId) ? 'gm' : 'player'` -> set `socket.data.role/mapId` -> join
rooms exactly as today.

**`join_map` gains an ack.** Silent-ignore is right for anti-cheat gating of
in-game events, but wrong for a join flow, where a rejected join would hang a
player on a black screen. The ack is:

```ts
{ ok: true } | { ok: false, reason: 'not_found' | 'not_member' }
```

In-game events keep silent-ignore.

**`state_sync` gains the server-decided identity:**

```ts
role: 'gm' | 'player';   // derived server-side; replaces the HUD toggle
userId: string;          // "who am I" for the client (own-token styling etc.)
```

The client stops self-declaring `isGM`.

**Nothing replaces the HUD GM/Player toggle.** Roles are real now. Dev and
testing use two browser contexts logged in as the two seeded users, which
matches the existing Playwright verification culture. The docs/08 GM fog
preview ("view as player X") is the principled successor to the toggle's
utility; do not build a stopgap.

## 7. Frontend flow

**Routes** (code-based tree in `frontend/src/router.tsx`):

- `/login` - public, combined login/register form.
- An `_authed` layout route whose `beforeLoad` redirects to `/login` when the
  store has no session. Children:
  - `/lobby` - campaign list, create form, join buttons; "Enter" per campaign
    (disabled with "no active map yet" when `activeMapId` is null).
  - `/campaign/$campaignId` - MapView. The loader fetches
    `GET /api/campaigns/:id`, resolves `activeMapId`, connects the socket, and
    emits `join_map`. This replaces the hardcoded `/` MapView; `/` redirects to
    `/lobby`.

**Boot sequence** (`frontend/src/main.tsx`): read `localStorage['vtt.token']`;
if present, `GET /api/me` and hydrate the store before rendering the router, so
the route guard reads the hydrated store synchronously.

**Store** (`frontend/src/store.ts`): add `session: { token, user } | null` with
`setSession` / `clearSession`, mirrored to localStorage. `state.isGM` stays, but
`setIsGM` is only ever called from `state_sync.role`; the toggle path is
deleted, along with MapView's `MAP_ID` / `USERS` constants.

**Socket** (`frontend/src/socket.ts`): keep the singleton, switch to the
callback auth form so every (re)connect sends the *current* token:

```ts
io(SERVER_URL, { autoConnect: false, auth: (cb) => cb({ token: getToken() }) })
```

**Reconnect:** Socket.io auto-reconnect re-runs the handshake (re-auth from the
stored token); MapView listens for `connect` and re-emits `join_map`. Since
`state_sync` is a full idempotent snapshot, recovery is free. A
`connect_error` of `unauthorized` clears the session and routes to `/login`.

**Cold reload:** no magic redirect into the last map. Store `lastCampaignId` in
localStorage and let the lobby show an explicit "Resume <name>" affordance.
Explicit beats magic, and it avoids a redirect loop when the last campaign or
membership has changed. Live in-session reconnects (server restart, network
blip) do rejoin automatically because MapView is still mounted.

## 8. Seed and rollout

- Pre-release, so `schema.sql` is edited in place. **Gotcha:** `CREATE TABLE IF
  NOT EXISTS` will silently not apply column changes to an existing database.
  Add a `db:reset` npm script (`DROP SCHEMA public CASCADE; CREATE SCHEMA
  public;` then the existing setup) and state the rule plainly: pre-release
  schema changes always mean a reset, never a migration.
- `seed.sql`: keep the two demo users as the Playwright fixtures. Drop the
  `role` values, add precomputed bcrypt `pin_hash` constants with the PINs
  documented in a comment (for example GM `1234`, Player One `4321`), insert
  both into `campaign_members` for the demo campaign, and set
  `campaigns.active_map_id` to the demo map. End-to-end tests then exercise the
  real login UI with known credentials instead of hardcoded UUIDs.

## 9. Edge cases

- **Name collision:** 409 at register (case-insensitive unique index). No
  rename flow in scope.
- **Forgotten PIN:** host-level, not HTTP. There is deliberately no global
  admin role anymore (role is per-campaign), so an HTTP "reset PIN" endpoint
  has no principal to authorize it. The server operator (in practice the GM;
  it is their machine) runs `npm run pin:reset -- "Name" 1234`: a tiny script
  that bcrypts and UPDATEs, and deletes that user's sessions.
- **GM disconnects mid-session:** nothing breaks. State is server-authoritative
  in PostgreSQL; players keep moving their owned tokens; fog simply does not
  change until the GM reconnects and rejoins. A presence indicator is a noted
  future nicety, out of scope here.
- **Same user on a second device:** allowed. Each login creates its own session
  row, and rooms are role-keyed rather than user-unique, so two GM sockets
  coexist (GM laptop + tablet is a real use case). No "kick other session"
  semantics.
- **Open join over a public URL:** any registered user can see and join any campaign.
  Acceptable for a trust circle. The designated future hardening if a tunnel
  URL leaks is a per-campaign 6-character join code: one nullable column and
  one check in `/join`, nothing else changes.
- **Membership changes while the GM is in-map:** a player joining via the lobby
  is a REST insert, so their `join_map` succeeds immediately; the GM's member
  list (and later the docs/08 audience selector) is REST-fetched and therefore
  stale until refetched. The fix is a future `member_joined` broadcast; noted,
  not designed here.
- **Deleted user with a live socket:** sessions cascade-delete, so the next
  handshake fails; the current socket lives until disconnect. Acceptable; no
  delete-user surface exists in scope anyway.
- **Campaign with no maps:** `active_map_id` is null and the lobby's "Enter" is
  disabled. Map creation/selection belongs to the map-library work in
  `docs/07-features.md`, not here.

## 10. Synergy with docs/08 and open questions

- `campaign_members` is exactly the population the docs/08 per-audience fog
  selector needs ("reveal to: [members of this campaign]"). Build order
  therefore favors this doc first.
- The `state_sync.role/userId` change also gives docs/08 a trustworthy per-user
  identity to key overlays on: `map_visibility.user_id` references real,
  authenticated users.

Open questions (not blocking):

- Per-campaign join codes (see section 9): add when a real need appears.
- Presence (who is connected) and a `member_joined` broadcast: design when the
  lobby/GM UX needs them.
- Backend serving `frontend/dist` in production is settled: `SERVE_CLIENT=1`
  makes the SPA, API, and sockets same-origin behind Caddy (docs/10); bearer
  tokens keep working unchanged.

# 07 - Feature Backlog & Tracker

A living list of everything we might build into the VTT. We use it to vet
ideas, track status, and tick features off (or cut them) as we go. This is a
roadmap, not an as-built spec: for how shipped features actually work, see docs
01-06.

## How to use this

- Each category has a status table. Update the **Status** column as things move.
- **Status values:** Done · In progress · Proposed · Needs vetting · Candidate · Rejected · Future.
  - *Candidate* = an unvetted idea. Promote it to *Proposed* once we commit, or
    move it to *Rejected*.
  - *Needs vetting* = there is an open design question to resolve first (see the note).
- When a feature ships, set it to **Done** and link the doc that describes it.

---

## 1. Virtual Tabletop Experience

| Feature | Status | Notes |
|---------|--------|-------|
| Real-time token sync (move/add/remove deltas) | Done | Baseline. docs/03, docs/05 |
| Click-to-reveal fog of war + GM conceal (square & hex) | Done | Baseline. docs/05 |
| Drag-and-drop tokens that snap to the grid | Done | Baseline. docs/05 |
| Server-side anti-cheat (hidden tokens stripped for players) | Done | Baseline. docs/04 |
| Map library: GM browses saved maps and displays one to the table | Done | `campaign_live_maps` GM toolbar (docs/11 Phase 1): a **Map Library** drawer lists every campaign map with a thumbnail, GM adds any as a live tab. `LibraryDrawer.tsx`. |
| Map image upload + render real `asset_path` | Done | `POST /api/campaigns/:id/maps` (multer) + `PixiStage.drawMap` renders the real image via `Assets.load`/`Sprite`. docs/05. |
| Show a map to all players | Done, model changed | Not "one shared active map" anymore — each player auto-loads whichever live map their own token's `map_id` points at (docs/11 Phase 1, "a player is where their token is"). Different players can be on different live maps simultaneously. |
| Per-audience fog of war (solo peek, party split) | Proposed | **Direction settled, see docs/08 / docs/11 Phase 3.** Shared base layer + per-user overlays; effective view = base union overlay. Server-side change (per-socket emission); client barely changes. Not yet built — `map_visibility` table does not exist. |
| Breakout maps: different map per sub-party | Partially done | **Location half is done** (docs/11 Phase 1): the GM relocates a player to any live tab via `token_relocate`, and players load independently based on their own token. **Fog half is still Phase 3** (per docs/08): fog is still map-level, not per-user, so a player on their own breakout map still sees that map's fog the same way everyone else on it would. |
| GM toolbar visual redesign (cohesive layout, GM-authority accent) | Done | The GM HUD was four disconnected floating boxes; now one toolbar (`routes/ui.ts`: `surface`/`space`/`eyebrow`/`gmToggle`/`tabChip` tokens) with an amber accent reserved for GM-authority state (active tab, active fog tool), kept distinct from the green primary-action color. Not part of docs/11's original functional scope, done alongside it. |
| Audience presets (saved "parties" for reveal targeting) | Candidate | Named player sets so the GM targets a recurring group in one click. UI convenience over multi-select; storage TBD. See docs/08. |
| GM: view as player (preview a player's fog) | Candidate | GM previews a specific player's effective view to confirm who sees what during a split. See docs/08. |
| Build maps on the fly and save to the library | Proposed | In-app map editor: place/paint terrain, then persist to `game_maps`. Depends on the shape library below. |
| Prebuilt shape library (boulders, rooms, doors, corridors, etc.) | Proposed | Reusable stamps/assets the GM drops onto a map while building. Needs an asset catalog + a place/transform tool in the editor. |

**Open questions for this section**
- Map library / multi-map: resolved in `docs/11-gm-toolkit.md` (GM toolkit) - a
  tab-based live set of maps with per-player placement; players load the map
  their token is on. The map/token/fog/session/builder items in this section are
  designed holistically and phased there.
- Per-audience fog: design settled in docs/08 (shared base + per-user overlays,
  manual regroup, breakout maps phased). Open sub-questions (parties storage,
  conceal precedence) are tracked there.
- Shape library: bundled art vs user-importable assets? Grid-aligned stamps vs
  free placement?

---

## 2. Character & Monster Experience

*(Owner's section was empty. Candidates below are unvetted, accept or reject.)*

| Feature | Status | Notes |
|---------|--------|-------|
| System-agnostic character sheets (JSONB storage) | Done | Baseline storage + `sheet_update` handler. docs/02, docs/03 |
| Character sheet UI wired to `sheet_update` | Candidate | Contract + server handler exist; no screen yet. |
| Monster stat blocks / bestiary | Candidate | Reusable monster templates the GM spawns as tokens. |
| Token-linked HP / condition tracking | Candidate | Show/edit HP and status effects on or near a token. |
| Initiative / turn tracker | Candidate | Ordered turn list, current-turn marker, next/prev. |
| Dice roller (shared results in a log) | Candidate | System-agnostic dice expressions; broadcast rolls. |
| Player-owned vs GM-owned sheet permissions | Candidate | Extends existing owner-or-GM authz to the sheet UI. |

**Open questions for this section**
- Is the sheet system-specific (D&D 5e layout) or a generic key/value editor
  over the JSONB, matching the "system-agnostic" constraint?
- Do monsters and PCs share the same sheet model, or separate?

---

## 3. Game Rules & References

*(Owner's section was empty. Candidates below are unvetted, accept or reject.)*

| Feature | Status | Notes |
|---------|--------|-------|
| Rules reference / compendium (searchable) | Candidate | Static or GM-authored rules text the table can look up. |
| Homebrew rules notes per campaign | Candidate | Free-form GM notes attached to a `campaigns` row. |
| Automated rule helpers (e.g. condition effects, modifiers) | Candidate | System-specific; tension with the system-agnostic core. Vet scope. |
| Handouts / lore documents shared to players | Candidate | GM pushes a document or image to selected players (relates to the select-players view in section 1). |

**Open questions for this section**
- How much of this is generic content storage vs system-aware automation?
  System-aware helpers cut against the system-agnostic design constraint.

---

## 4. Platform & Access

| Feature | Status | Notes |
|---------|--------|-------|
| Login / user-select screen (drop hardcoded seeded IDs) | Done | **Built, see docs/09.** Name + PIN (bcryptjs), sessions table, socket handshake auth; `userId` left the wire contract; role derived per campaign (creator = GM). |
| Campaign lobby (create = GM, join = player, enter) | Done | Login lands on a lobby: create a campaign to GM it, join one to play. `campaign_members` table. "Enter" is always available now (no more "no active map yet" gating) — the campaign route resolves the GM's first live tab or the player's own token's map. See docs/09, docs/11. |
| Per-campaign join code (harden open join) | Done | `campaigns.join_code` gates join; enforced in `/api/campaigns/:id/join`. Shipped with login given public-tunnel exposure. See docs/09. |
| Player presence indicator (who is connected) | Candidate | Includes a `member_joined` broadcast so the GM's member list is not stale. See docs/09. |
| Deployment: Docker (self-host + tunnel) or DigitalOcean | Done (built, verified locally) | **One Docker stack, three run modes. See docs/10.** Self-host + an ngrok/Tailscale tunnel, or a DigitalOcean droplet with Caddy (auto-TLS); app serves SPA + API + sockets same-origin + Dockerized Postgres. Login (above) is still required before exposing publicly. |
| Pan / zoom camera | Proposed | Input math currently assumes stage coords == CSS pixels; a camera transform means converting through it. |
| Committed automated test suite | Done | Vitest (unit + integration) + Playwright (e2e) on a `vtt_test` DB, via `npm test`. See docs/06. CI wiring is the remaining follow-up. |

---

## 5. Future State

Deliberately deferred. Logged so we do not lose them.

| Feature | Status | Notes |
|---------|--------|-------|
| Voice & video inside the platform | Future | Currently external (Discord, etc.). Revisit only if external tooling becomes a real friction point. |
| 3D graphics | Future | The renderer is PixiJS 2D by design. A 3D mode is a separate rendering path, not an increment. |

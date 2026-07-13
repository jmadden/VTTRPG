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
| Map library: GM browses saved maps and displays one to the table | Proposed | GM-side list/gallery UI + a "set active map" broadcast to all players. Needs a map thumbnail and `game_maps` browse endpoint. |
| Map image upload + render real `asset_path` | Proposed | Currently the map layer is a placeholder grid; `game_maps.asset_path` is unused by the renderer. Prereq for a useful map library. |
| Show active map to **all** players | Proposed | Straightforward once "set active map" exists; this is the default. |
| Per-audience fog of war (solo peek, party split) | Proposed | **Direction settled, see docs/08.** Shared base layer + per-user overlays; effective view = base union overlay. Server-side change (per-socket emission); client barely changes. Phase 1. |
| Breakout maps: different active map per sub-party | Proposed | House-vs-dungeon case. Per-user active map on top of per-audience fog; `map_visibility` is already keyed per (map, user). Depends on the row above. Phase 2, see docs/08. |
| Audience presets (saved "parties" for reveal targeting) | Candidate | Named player sets so the GM targets a recurring group in one click. UI convenience over multi-select; storage TBD. See docs/08. |
| GM: view as player (preview a player's fog) | Candidate | GM previews a specific player's effective view to confirm who sees what during a split. See docs/08. |
| Build maps on the fly and save to the library | Proposed | In-app map editor: place/paint terrain, then persist to `game_maps`. Depends on the shape library below. |
| Prebuilt shape library (boulders, rooms, doors, corridors, etc.) | Proposed | Reusable stamps/assets the GM drops onto a map while building. Needs an asset catalog + a place/transform tool in the editor. |

**Open questions for this section**
- Map library: does "display to the table" replace the current map for everyone,
  or can multiple maps be open at once (tabs)?
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
| Login / user-select screen (drop hardcoded seeded IDs) | Proposed | **Design settled, see docs/09.** Name + PIN (bcrypt), sessions table, socket handshake auth; `userId` leaves the wire contract; role derived per campaign (creator = GM). |
| Campaign lobby (create = GM, join = player, enter active map) | Proposed | Login lands on a lobby: create a campaign to GM it, join one to play. New `campaign_members` table; `campaigns.active_map_id`. See docs/09. |
| Per-campaign join code (harden open join) | Candidate | Any registered user can join any campaign today by design; a 6-char code gates it if a tunnel URL leaks. See docs/09. |
| Player presence indicator (who is connected) | Candidate | Includes a `member_joined` broadcast so the GM's member list is not stale. See docs/09. |
| Deployment: Docker (self-host + tunnel) or DigitalOcean | Done (built, verified locally) | **One Docker stack, three run modes. See docs/10.** Self-host + an ngrok/Tailscale tunnel, or a DigitalOcean droplet with Caddy (auto-TLS); app serves SPA + API + sockets same-origin + Dockerized Postgres. Login (above) is still required before exposing publicly. |
| Pan / zoom camera | Proposed | Input math currently assumes stage coords == CSS pixels; a camera transform means converting through it. |
| Committed automated test suite | Proposed | Verification used throwaway scripts (docs/06). |

---

## 5. Future State

Deliberately deferred. Logged so we do not lose them.

| Feature | Status | Notes |
|---------|--------|-------|
| Voice & video inside the platform | Future | Currently external (Discord, etc.). Revisit only if external tooling becomes a real friction point. |
| 3D graphics | Future | The renderer is PixiJS 2D by design. A 3D mode is a separate rendering path, not an increment. |

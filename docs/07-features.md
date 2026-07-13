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
| Show a map to **only select** players (private/breakout view) | Needs vetting | **Conflicts with a locked decision:** fog is map-level and the only audience split is GM vs players (HANDOFF.md, docs/04). Per-player or per-group map views means per-audience state and a bigger visibility model. Decide scope before scheduling: is this per-player maps, or breakout "sub-tables"? |
| Build maps on the fly and save to the library | Proposed | In-app map editor: place/paint terrain, then persist to `game_maps`. Depends on the shape library below. |
| Prebuilt shape library (boulders, rooms, doors, corridors, etc.) | Proposed | Reusable stamps/assets the GM drops onto a map while building. Needs an asset catalog + a place/transform tool in the editor. |

**Open questions for this section**
- Map library: does "display to the table" replace the current map for everyone,
  or can multiple maps be open at once (tabs)?
- Select-players view: resolve the fog-model conflict above before design.
- Shape library: bundled art vs user-importable assets? Grid-aligned stamps vs
  free placement?

---

## 2. Character & Monster Experience

*(Owner's section was empty. Candidates below are unvetted, accept or reject.)*

| Feature | Status | Notes |
|---------|--------|-------|
| System-agnostic character sheets (JSONB storage) | Done | Baseline storage + `sheet_update` handler. docs/02, docs/03 |
| Character sheet UI wired to `sheet_update` | Candidate | Contract + server handler exist; no screen yet. Already in HANDOFF backlog. |
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
| Login / user-select screen (drop hardcoded seeded IDs) | Proposed | Frontend currently hardcodes GM/player IDs behind a HUD toggle. HANDOFF backlog #2. |
| Pan / zoom camera | Proposed | Input math currently assumes stage coords == CSS pixels; a camera transform means converting through it. HANDOFF backlog #6. |
| Committed automated test suite | Proposed | Verification used throwaway scripts (docs/06). HANDOFF backlog #5. |

---

## 5. Future State

Deliberately deferred. Logged so we do not lose them.

| Feature | Status | Notes |
|---------|--------|-------|
| Voice & video inside the platform | Future | Currently external (Discord, etc.). Revisit only if external tooling becomes a real friction point. |
| Move off a single local host to better infrastructure | Future | Would change the "local host" model and the LAN/ngrok connection assumptions. Large architectural shift. |
| 3D graphics | Future | The renderer is PixiJS 2D by design. A 3D mode is a separate rendering path, not an increment. |

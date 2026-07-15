# 03 - WebSocket Event & Data Contract Specification

Real-time sync over Socket.io. Design goals: **tiny JSON deltas** (never full
state), **server-authoritative** truth, and a **single visibility choke point**
so hidden tokens never leak. Types are defined once in `shared/src/contracts.ts`
(exported names live under the `EV` constant) and imported by both ends. This
doc reflects the shipped contract.

## Room model

Per map the server maintains two rooms:

- **`map:<id>:gm`** - the GM socket. Receives raw, unfiltered payloads.
- **`map:<id>:players`** - all player sockets. Receives gated payloads.

`revealed_tiles` is **map-level**, so every player shares one visibility view.
The only audience split is GM-vs-players (no per-player fog), which keeps delta
gating cheap. Every delta that can change what a player sees is computed for the
players room before it hits the wire, in `backend/src/lib/visibilityFilter.ts`
(doc 04).

On join the server also leaves any previously joined map's rooms, so switching
role/map on one socket does not linger in both rooms. Switching a GM's live
tab, or relocating a player to another live map, reuses this exact mechanism
(client just calls `join_map` again with a different `mapId`).

**`user:<userId>`** - joined once at connection time (right after the
handshake resolves identity), independent of any map. Lets `set_live_maps`
broadcasts and `map_relocated` pushes reach every open tab/device for that
user, and lets the server push to a specific player regardless of which map
room their socket currently happens to be in.

Cell keys are canonical strings from `shared/src/coords.ts`: `"col,row"` for
square, axial `"q,r"` for hex.

## Event summary

| Event | Direction | Restriction |
|-------|-----------|-------------|
| `join_map` | client -> server (ack) | any campaign member |
| `state_sync` | server -> client | on join |
| `token_move` | client -> server, server -> rooms | GM or token owner (same map only) |
| `token_relocate` | client -> server (ack) | GM only (cross-map move, doc 11) |
| `set_live_maps` | client -> server (ack), server -> `user:<gmId>` | GM only (doc 11) |
| `map_relocated` | server -> `user:<userId>` | pushed after a `token_relocate` |
| `reveal_tiles` | client -> server, server -> rooms | GM only |
| `conceal_tiles` | client -> server, server -> rooms | GM only |
| `token_add` / `token_remove` | server -> players | derived deltas |
| `sheet_update` | client -> server, server -> rooms | GM or sheet owner |

---

## `join_map`

**Client -> server** (with an ack callback)
```json
{ "mapId": "44444444-..." }
```
No `userId` in the payload — identity comes from the authenticated socket
handshake (`auth.token` -> session lookup), not the client's claim. This was a
deliberate anti-impersonation fix (doc 09): the server derives role by
comparing the handshake's `userId` against the campaign's `gm_user_id`, so a
client can no longer claim someone else's identity by passing their UUID.

**Ack**
```ts
{ ok: true } | { ok: false, reason: 'not_found' | 'not_member' | 'unauthorized' }
```
`not_found` - the map doesn't exist. `not_member` - authenticated, but not a
member of that map's campaign. `unauthorized` - no valid session. On success
the server also emits `state_sync` to that socket.

---

## `state_sync` (server -> client, on join)

The initial snapshot, already filtered for the client's role.

```json
{
  "mapId": "44444444-...",
  "gridType": "square",
  "gridSize": 70,
  "assetPath": "/assets/demo-map.png",
  "cols": 16,
  "rows": 12,
  "revealed": ["0,0", "1,0", "2,0"],
  "tokens": [
    { "id": "6666...", "mapId": "44444444-...", "characterSheetId": "5555...",
      "name": "Aria", "type": "player", "x": 105, "y": 105 }
  ],
  "movableTokenIds": ["6666..."],
  "role": "gm",
  "userId": "1111..."
}
```

- For players, hidden tokens on unrevealed cells are absent entirely and the
  `hidden` field is stripped from the rest (`ClientToken`).
- `assetPath`: the map image to render under the grid (`null` for a plain grid
  with no background), served from `ASSET_DIR`.
- `cols`/`rows` size the fog grid on the client (no guessing).
- `movableTokenIds`: ids this client may drag. GM = all tokens; player = tokens
  whose sheet they own. Point-in-time snapshot; the UI uses it to gate dragging
  so a player never optimistically drags a token the server would reject.
- `role` / `userId`: server-decided identity for this client (doc 09) — the
  frontend no longer has a GM/Player toggle; this is the only source of truth.

---

## `token_move`

A bare position delta. The server holds the authoritative prior position, so
the client sends only the new coordinates. (The client snaps to a cell center
before emitting, so all clients agree on the cell.)

**Client -> server**
```json
{ "tokenId": "6666...", "x": 385, "y": 385 }
```

**Server -> `gm` room** (always the plain move)
```json
{ "tokenId": "6666...", "x": 385, "y": 385, "actorId": "1111..." }
```

**Server -> `players` room** - depends on the token's visibility transition,
computed from its cell before/after against `revealed`:

| Token      | before -> after       | Player payload                       |
|------------|-----------------------|--------------------------------------|
| not hidden | any                   | `token_move` `{tokenId,x,y,actorId}` |
| hidden     | unrevealed->unrevealed| *(nothing, suppressed)*              |
| hidden     | revealed->revealed    | `token_move` `{tokenId,x,y,actorId}` |
| hidden     | unrevealed->revealed  | `token_add` `{token: ClientToken}`   |
| hidden     | revealed->unrevealed  | `token_remove` `{tokenId}`           |

This closes the leak where broadcasting a raw move would reveal a hidden
monster's existence and position to players.

---

## `token_relocate` - GM ONLY (doc 11)

Cross-map move of an existing token — distinct from `token_move`, which stays
"move within the map you're joined to" and is otherwise unchanged. Reassigns
the token's `map_id` and fans out to both maps' rooms plus the token owner's
`user:<userId>` room.

**GM client -> server** (with an ack callback)
```json
{ "tokenId": "6666...", "toMapId": "99999999-...", "x": 100, "y": 100 }
```

**Ack**
```ts
{ ok: true } | { ok: false, reason: 'unauthorized' | 'not_found' | 'not_live' }
```
`unauthorized` - not the GM, or not the GM of the token's source map's
campaign. `not_found` - token doesn't exist, or `toMapId` isn't in the same
campaign. `not_live` - `toMapId` isn't one of the campaign's current live tabs
(`campaign_live_maps`).

**Server, on success:**
- **Old map, both rooms** get `token_remove {tokenId}` — the token vanishes
  from the map it left entirely, not just for players.
- **New map's `gm` room** gets `token_add {token}` unconditionally.
- **New map's `players` room** gets `token_add {token}` only if
  `isVisibleToPlayers` says so against the *destination* map's own fog (the
  same anti-cheat rule as any other token, doc 04) — relocating a hidden
  monster onto an unrevealed cell does not leak it.
- **The token owner's `user:<userId>` room** gets `map_relocated` (below) —
  this is how the player's own client finds out it needs to switch maps.

---

## `set_live_maps` - GM ONLY (doc 11)

The GM's ordered live-map tabs. The client always sends the **full** ordered
list (not a single add/remove) — the server rewrites `campaign_live_maps` to
match it in one atomic statement, so this doubles as add, remove, reorder, and
rename in a single event.

**GM client -> server** (with an ack callback)
```json
{
  "campaignId": "33333333-...",
  "liveMaps": [
    { "mapId": "44444444-...", "title": "Demo Map", "position": 0 },
    { "mapId": "99999999-...", "title": "Tavern", "position": 1 }
  ]
}
```

**Ack**
```ts
{ ok: true, liveMaps: LiveMapEntry[] } | { ok: false, reason: 'unauthorized' | 'not_gm' }
```
The server normalizes positions (re-indexes to `0..n-1`, dedupes by `mapId`)
before saving, and silently drops any `mapId` that doesn't belong to
`campaignId`.

**Server -> the GM's own `user:<gmId>` room** (broadcast form, same shape as
the ack's `liveMaps`, so every open tab/device for that GM — including the
sender — stays in sync):
```json
{ "campaignId": "33333333-...", "liveMaps": [ /* the saved, normalized list */ ] }
```

---

## `map_relocated` - server push (doc 11)

Tells a relocated player's socket(s) to re-join a different map. Pushed to
`user:<userId>` (the token owner), so it reaches every device/tab that player
has open, not just whichever one happened to trigger something.

```json
{ "mapId": "99999999-..." }
```

The client's entire response is to call `join_map` again with this `mapId` —
the existing wholesale `state_sync` on join replaces the store, so there is no
separate incremental-relocation code path on the client.

---

## `reveal_tiles` - GM ONLY

The GM manually uncovers cells (click-to-reveal). The server validates the
sender is the GM, ignores otherwise, and persists the new cells into
`game_maps.revealed_tiles`. Only cells not already revealed are broadcast.

**GM client -> server**
```json
{ "mapId": "44444444-...", "add": ["10,5"] }
```

**Server -> `gm` room** (fog delta only)
```json
{ "mapId": "44444444-...", "revealed": ["10,5"] }
```

**Server -> `players` room** (fog delta plus just-uncovered tokens)
```json
{
  "mapId": "44444444-...",
  "revealed": ["10,5"],
  "newlyVisible": [
    { "id": "7777...", "mapId": "44444444-...", "characterSheetId": null,
      "name": "Lurking Orc", "type": "monster", "x": 735, "y": 385 }
  ]
}
```

`newlyVisible` lists hidden tokens whose cell falls inside `add`. Without it the
fog would lift but the monster standing there would stay invisible until a full
resync. The player payload omits `hidden`.

---

## `conceal_tiles` - GM ONLY

The inverse of `reveal_tiles`: the GM paints fog back over cells. GM-validated;
only currently-revealed cells are acted on. Removes them from
`game_maps.revealed_tiles`.

**GM client -> server**
```json
{ "mapId": "44444444-...", "remove": ["10,5"] }
```

**Server -> both rooms** (fog delta)
```json
{ "mapId": "44444444-...", "concealed": ["10,5"] }
```

**Additionally, server -> `players` room:** a `token_remove` for every **hidden**
token now back under fog (non-hidden tokens are never hidden by fog):
```json
{ "tokenId": "7777..." }
```

---

## `token_add` / `token_remove` (server -> players only)

The visibility-transition deltas emitted by `token_move`, `reveal_tiles`, and
`conceal_tiles`. Players never receive a hidden token they should not see.

```json
{ "token": { "id": "7777...", "mapId": "...", "characterSheetId": null,
             "name": "Lurking Orc", "type": "monster", "x": 735, "y": 385 } }
```
```json
{ "tokenId": "7777..." }
```

---

## `sheet_update`

Updates a single nested attribute path in a character sheet. Same shape
client -> server and server -> broadcast. `path` maps directly to a Postgres
`jsonb_set` `text[]` path (see doc 02).

```json
{ "sheetId": "5555...", "path": ["stats", "hp", "current"], "value": 27 }
```

No visibility gating is needed (sheets are not fog-dependent), but authorization
applies (below).

---

## Authorization (enforced server-side)

Delta contracts describe shape; the server also enforces who may send what:

- **`reveal_tiles` / `conceal_tiles`** - GM only. Rejected from player sockets.
- **`sheet_update`** - sender must own the sheet
  (`character_sheets.owner_user_id`) or be the GM.
- **`token_move`** - sender must be the GM or own the token (via its linked
  `character_sheet_id`); same-map only (the token must be on the map the
  sender is currently joined to).
- **`token_relocate`** - GM only, and specifically the GM of the token's
  source map's campaign; the destination map must belong to that same
  campaign and be one of its current live tabs.
- **`set_live_maps`** - GM only (`isCampaignGm`), checked against the
  `campaignId` in the payload, not tied to any single map.

`movableTokenIds` in `state_sync` is the client-side mirror of the `token_move`
rule, used only to decide draggability in the UI. The server is the authority;
the client flag is a convenience to avoid failed optimistic moves.

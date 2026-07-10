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
role/map on one socket does not linger in both rooms.

Cell keys are canonical strings from `shared/src/coords.ts`: `"col,row"` for
square, axial `"q,r"` for hex.

## Event summary

| Event | Direction | Restriction |
|-------|-----------|-------------|
| `join_map` | client -> server | any authenticated user |
| `state_sync` | server -> client | on join |
| `token_move` | client -> server, server -> rooms | GM or token owner |
| `reveal_tiles` | client -> server, server -> rooms | GM only |
| `conceal_tiles` | client -> server, server -> rooms | GM only |
| `token_add` / `token_remove` | server -> players | derived deltas |
| `sheet_update` | client -> server, server -> rooms | GM or sheet owner |

---

## `join_map`

**Client -> server**
```json
{ "mapId": "44444444-...", "userId": "11111111-..." }
```
Server looks up the user's role, joins the correct room, and replies with
`state_sync`.

---

## `state_sync` (server -> client, on join)

The initial snapshot, already filtered for the client's role.

```json
{
  "mapId": "44444444-...",
  "gridType": "square",
  "gridSize": 70,
  "cols": 16,
  "rows": 12,
  "revealed": ["0,0", "1,0", "2,0"],
  "tokens": [
    { "id": "6666...", "mapId": "44444444-...", "characterSheetId": "5555...",
      "name": "Aria", "type": "player", "x": 105, "y": 105 }
  ],
  "movableTokenIds": ["6666..."]
}
```

- For players, hidden tokens on unrevealed cells are absent entirely and the
  `hidden` field is stripped from the rest (`ClientToken`).
- `cols`/`rows` size the fog grid on the client (no guessing).
- `movableTokenIds`: ids this client may drag. GM = all tokens; player = tokens
  whose sheet they own. Point-in-time snapshot; the UI uses it to gate dragging
  so a player never optimistically drags a token the server would reject.

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
  `character_sheet_id`).

`movableTokenIds` in `state_sync` is the client-side mirror of the `token_move`
rule, used only to decide draggability in the UI. The server is the authority;
the client flag is a convenience to avoid failed optimistic moves.

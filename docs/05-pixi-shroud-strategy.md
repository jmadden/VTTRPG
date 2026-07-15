# 05 - PixiJS Rendering, Fog of War & Input

Target **PixiJS v8** (`frontend/src/game/PixiStage.ts`). The manual
click-to-reveal fog of war is drawn from the same `CellKey` set the backend
uses, no raycasting, just cell membership. This doc is as-built.

## Layer stack (bottom -> top)

```
Stage (app.stage)            // eventMode 'static', hitArea = app.screen
├─ mapLayer   : Container    // placeholder grid lines (Graphics); eventMode 'none'
├─ tokenLayer : Container    // one draggable Container per FILTERED token
└─ shroudLayer: Container    // fog Graphics on top; eventMode 'none'
```

- **Map layer** - a faint grid drawn with `Graphics` (square: lines; hex: a
  background fill), plus the real map image: `drawMap` loads
  `game_maps.assetPath` via `Assets.load(imageUrl)` and adds it as a `Sprite`
  under the grid lines once the texture resolves (the grid appears
  immediately; the image pops in when it loads). A `mapDrawSeq` counter guards
  against a stale async load finishing after a newer `drawMap` call (e.g. a
  fast tab switch) — if the sequence number no longer matches, the resolved
  texture is discarded. `assetPath: null` (or a load failure) falls back to
  the grid alone. Non-interactive.
- **Token layer** - one `Container` per token in local state, positioned at the
  token's world (pixel) coords, holding a colored circle (`Graphics`) plus a
  name `Text`. Local state only ever contains tokens the client may see, because
  the payload was already filtered server-side (doc 04). The renderer never
  needs to know a hidden token exists.
- **Shroud layer** - a `Graphics` covering unrevealed cells, drawn on top so
  fog hides both map and tokens beneath. Non-interactive so pointer events fall
  through to tokens and the stage.

## Fog rendering: draw the unrevealed cells

State is a `Set<CellKey>` of revealed cells (from `state_sync.revealed`, kept in
`store.ts`). Map `cols`/`rows` and `gridType`/`gridSize` also come from
`state_sync`.

Redraw clears the `Graphics`, then fills every cell NOT in the revealed set:

```ts
g.clear();
for (each cell not in revealed) g.poly(cellPolygon(key, grid));
g.fill({ color: 0x3b4a63, alpha: isGM ? 0.5 : 1.0 });
```

- Color is **slate blue-gray `0x3b4a63`**, chosen to read clearly over the dark
  map (the earlier near-black fog was invisible).
- `cellPolygon` (from `shared/src/coords.ts`) returns a square (4-point) or hex
  (6-point) corner array, so one loop handles both geometries. For hex it
  iterates the axial `q,r` range that covers the board.
- **GM vs player is one flag: alpha.** Players get opaque fog (`1.0`); the GM
  gets translucent fog (`0.5`) so they can see the whole map and plan reveals
  while still seeing what players can and cannot see.

### Why redraw the whole shroud

Per manual reveal the changed-cell count is small and total cells are bounded (a
battle map is rarely more than a few thousand cells), so a full `clear()` +
refill is simple and fast enough. Optimize later only if profiling shows a hot
path (cache to a `RenderTexture`, or a full-cover rect with revealed cells
erased via a mask).

## Input model (unified at the stage)

All pointer input is handled by Pixi, not DOM handlers, so a drag can never also
fire a fog action. `app.stage.eventMode = 'static'` and
`app.stage.hitArea = app.screen` so the stage receives events over empty space.

- **pointerdown on a token** -> start a drag (the handler calls
  `stopPropagation`, so the stage does not also treat it as a cell click).
- **pointerdown on empty space** -> a cell action at
  `worldToCell(event.global, grid)`; the active fog tool (reveal or conceal)
  decides which.
- **pointermove while dragging** -> move the token container to `event.global`.
- **pointerup** -> snap the token to the center of the cell under the drop
  (`cellToWorld(worldToCell(...))`), then emit one `token_move` with the snapped
  coords.

Coordinates use `event.global` throughout (not DOM `getBoundingClientRect`), so
they stay correct under retina / `autoDensity`.

### Pixi v8 gotcha: token hit area (real bug we hit)

A `Container` has no geometry of its own, and a child `Graphics` is
**passive by default**, so a token container set to `eventMode: 'static'` still
never received `pointerdown`: hit-testing found nothing and the drag silently
failed. Fix: give each draggable token an explicit
`container.hitArea = new Circle(0, 0, radius)`. Likewise the large map-grid and
shroud `Graphics` are set to `eventMode: 'none'` so they do not intercept clicks
meant for tokens or the stage (setting `eventMode` on the parent container was
not enough).

Draggable = GM (any token) or a token in `movableTokenIds` (a player's own).

## State -> redraw flow (decoupled from the socket)

Socket handlers mutate the store; a `useSyncExternalStore` subscription in
`MapView.tsx` triggers the redraw. The renderer never reads the socket directly.

```
state_sync    -> replace revealed set, tokens, grid dims, movable set
reveal_tiles  -> add cells to revealed set (+ append newlyVisible tokens)
conceal_tiles -> remove cells from revealed set
token_add     -> add token
token_remove  -> remove token
token_move    -> update token x/y
```

A **map switch** (the GM clicking a different live tab, or a `map_relocated`
push telling a player's client to follow — doc 11) is not an incremental
delta: the client just re-emits `join_map` with the new `mapId`, and the
resulting `state_sync` replaces the store wholesale exactly like the initial
join. The Pixi stage itself is torn down and recreated per joined `mapId`
(`MapView.tsx` keys that effect on `mapId`), so a tab switch also means a
fresh canvas, not a patched one.

Optimistic local echo: when the GM reveals/conceals or anyone drags a token, the
client updates its own store immediately and emits; the server broadcast keeps
everyone else in sync.

### Drag guard (important)

The redraw rebuilds the token layer (`removeChildren().forEach(destroy)` + full
rebuild). If an external delta (another client's move, an incoming reveal)
landed mid-drag, the rebuild would destroy the very container being dragged.
So the redraw effect early-returns while `stage.isDragging` is true; on drop the
normal redraw reconciles everything.

## HUD controls (`MapView.tsx` + `routes/gm/*`, doc 11)

No GM/Player toggle exists anymore — role is server-derived from login (doc
09), not a client switch. What's rendered differs by role:

- **GM**: a single full-width toolbar (DOM overlay, not Pixi) spanning the top
  of the screen, built from shared style tokens in `routes/ui.ts` (`surface`,
  `space`, `eyebrow`, plus an amber `accentGm`/`gmToggle`/`tabChip` reserved
  for "GM-authority" state, kept visually distinct from the green
  primary-action color used elsewhere). Left to right: an identity/status
  block (brand, connection dot, token count, Lobby button); the live-map
  **TabBar** (`routes/gm/TabBar.tsx`, filling the remaining width, one tab per
  `campaign_live_maps` row, active tab underlined in `accentGm`); a
  **Reveal/Conceal** fog-tool toggle (`gmToggle`, amber when active); and the
  **Map Library** drawer toggle (`routes/gm/LibraryDrawer.tsx`, opens a panel
  anchored under the button listing every campaign map with a thumbnail —
  already-live maps ghosted "Added" rather than hidden, others get an "add"
  button; also has an upload-straight-into-the-live-set form). Separately, a
  floating **Players panel** (`routes/gm/PlayersPanel.tsx`, bottom-left) lists
  non-GM members; dragging a player's row onto a TabBar tab emits
  `token_relocate`.
- **Player**: a small floating DOM box (top-left, unchanged in spirit from
  before login shipped) showing connection status, visible token count, a
  Lobby button, and a "drag your own token" hint. No fog tool, no tabs.
- **Empty state**: if `mapId` is `null` (GM has no live tabs yet, or a player
  hasn't been placed on a map), the canvas doesn't mount at all — a plain
  centered message is shown instead ("No live maps yet — add one from the
  library drawer" for the GM; "Your GM hasn't placed you on a map yet" for the
  player).

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

- **Map layer** - currently a faint grid drawn with `Graphics` (square: lines;
  hex: a background fill). A real map image `Sprite` from `game_maps.asset_path`
  is a future drop-in. Non-interactive.
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

Optimistic local echo: when the GM reveals/conceals or anyone drags a token, the
client updates its own store immediately and emits; the server broadcast keeps
everyone else in sync.

### Drag guard (important)

The redraw rebuilds the token layer (`removeChildren().forEach(destroy)` + full
rebuild). If an external delta (another client's move, an incoming reveal)
landed mid-drag, the rebuild would destroy the very container being dragged.
So the redraw effect early-returns while `stage.isDragging` is true; on drop the
normal redraw reconciles everything.

## HUD controls (`MapView.tsx`)

A small DOM overlay provides: a **GM / Player** view toggle (rejoins as the
seeded GM or player user), and, for the GM, a **Reveal / Conceal** fog-tool
toggle. It also shows connection status and the visible token count.

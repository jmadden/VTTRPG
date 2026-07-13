# Brainstorming: Adding 3D to the VTT

*Status: exploratory assessment — nothing here is committed work. Related backlog entry: docs/07-features.md §5 "3D graphics" (Future).*

## The question

What would it take to add 3D to this system — hardware and software, for the GM and for players — and could it stay local-hosted, or would it have to move?

Follow-up scope: not just 3D rendering but **3D animations and 3D gameplay**. The game is sci-fi; in spaceship combat, ships attack from any angle (top, bottom, oblique). That is covered as **Tier 4** below, and it changes several conclusions — see "How 3D gameplay changes the picture."

## The short answer

It can stay local-hosted at every tier. In this architecture the server is a state authority that syncs tiny JSON deltas; all rendering happens in the players' browsers. The server does not care whether the client draws flat sprites with PixiJS or meshes with Three.js. What actually changes with 3D is:

1. **The frontend renderer** — the size of that change depends entirely on which tier of "3D" we mean.
2. **Asset delivery** — 3D scenes are 10–50× more bytes than a 2D map image, which matters for remote players connecting through the GM's home upload link, not for LAN players.
3. **Client hardware minimums** — only at the full-3D tiers, and only modestly.
4. **The game-state model** — only at Tier 4 (full 3D gameplay). Positions gain a `z` and an orientation, and the fog-of-war model is *replaced* (not extended) for open space. Same delta/server-authority architecture, different predicates.

Four tiers, from cheapest to most expensive:

| | Tier 1: 3D flavor on the 2D board | Tier 2: 2.5D / isometric | Tier 3: Full 3D tabletop (TaleSpire-style) | Tier 4: Full 3D gameplay (space combat) |
|---|---|---|---|---|
| What it looks like | Today's top-down map, plus 3D dice rolls and mini figures that read as 3D | Fixed-angle isometric view with real elevation (platforms, pits, floors) | Free-orbit camera over sculpted 3D terrain, buildings, 3D minis | Ships maneuvering in a volume with pitch/roll/yaw; attacks from any angle; animated weapons fire |
| Renderer change | None (PixiJS stays; small overlay for dice) | Moderate (Pixi isometric projection, or locked-camera Three.js) | Total (new renderer, new map format, new editor) | Same as Tier 3, plus animation system and 3D maneuver UI |
| Backend change | ~Nothing (one `dice_roll` event) | Small (elevation fields) | Small-moderate (scene schema; filter logic unchanged) | Moderate (x/y/z + orientation state; new visibility predicate; combat events) |
| Player hardware floor | Anything that runs the current app | Same | Integrated GPU from the last ~8 years, 8 GB RAM; old tablets drop off | Same as Tier 3 — or *lower* (space scenes are lighter than terrain) |
| GM hardware floor | Same as today | Same as today | 16 GB RAM; Apple silicon or a modest discrete GPU recommended | Same as Tier 3 |
| Local hosting | Unaffected | Unaffected | Works; asset delivery to ngrok players needs caching or a static-asset CDN | Works, more comfortably than Tier 3 (smaller assets) |
| Effort | Days–2 weeks | 2–6 weeks | Multi-month; effectively a second product | Tier 3 + 1–3 months; the maneuver UX is the long pole |

## Why the server barely changes (all tiers)

The core design decisions already made are exactly the right shape for 3D:

- **State sync stays tiny.** A token move in 3D is `{ id, x, y, z }` instead of `{ id, x, y }`. The delta protocol, Socket.io events, and shared contract types in `shared/src/contracts.ts` extend naturally.
- **The anti-cheat visibility filter survives intact.** `backend/src/lib/visibilityFilter.ts` strips tokens by *grid cell coordinate* against `revealed_tiles`. That logic is renderer-agnostic. A 3D client hides/shows the same cells; the server keeps stripping hidden monsters from the payload before broadcast. No raycasting is introduced server-side at any tier.
- **Manual click-to-reveal fog also survives.** In 3D the "shroud" becomes hiding the *contents* of unrevealed cells (terrain chunks fade in per cell or region) rather than a black overlay — TaleSpire works this way. The GM's reveal interaction and the `reveal_tiles` event are unchanged.
- **PostgreSQL JSONB absorbs the data-model growth.** Elevation per cell (Tier 2) or a full scene description (Tier 3) are JSONB documents on `game_maps`; no exotic storage needed.

*Tier 4 caveat:* the two fog-of-war bullets above hold for ground/dungeon maps at every tier, but open space has no walls, so the cell-reveal *model* (not the architecture) gets replaced for space maps — see Tier 4. The server-authority pattern of "strip what a player may not see before broadcast" is unchanged; only the visibility predicate differs per map kind.

What grows is the *frontend* and the *asset pipeline*. Detail per tier below.

---

## Tier 1 — 3D flavor on the 2D board

Keep the flat top-down map as the game surface. Add the two things that deliver most of the "3D feel" per unit of effort:

**3D dice.** An overlay canvas using an off-the-shelf physics-dice library (e.g. `@3d-dice/dice-box`, which bundles Babylon.js + a physics engine) or a small hand-rolled Three.js + Rapier scene. The standard trick for multiplayer fairness: the *server* generates the roll result and broadcasts it; each client plays a physics animation rigged to land on that number. Physics stays cosmetic, results stay authoritative — consistent with the existing anti-cheat philosophy. Adds one `dice_roll` event to `contracts.ts`.

**3D-looking minis.** Two options:
- *Pre-rendered sprites* (recommended): render 3D models to sprite sheets offline (or use existing top-down/isometric token art). Zero runtime cost, works on every device, no new renderer.
- *Live 3D layer*: a Three.js canvas composited over the Pixi canvas with an orthographic camera matched to the grid. Real 3D minis that rotate and animate, at the cost of maintaining two renderers in sync (camera pan/zoom must drive both).

**Hardware/software impact:** none worth naming. Anything that runs the current app runs this. GM machine load is unchanged. Asset sizes grow by megabytes, not hundreds. LAN and ngrok both fine.

## Tier 2 — 2.5D / isometric with elevation

The map gains height: raised platforms, pits, multiple floors. Camera stays at a fixed angle.

**Renderer choice** (the main design decision at this tier):
- *Stay in PixiJS* with isometric projection: elevation is 2D math (y-offset per height level, depth-sorted draw order). No new engine, but iso math and z-sorting around tall objects is fiddly, and true multi-floor gets awkward.
- *Move to Three.js with a locked orthographic camera*: real geometry makes elevation, occlusion, and floors natural, and it is a stepping stone to Tier 3. Cost: the renderer rewrite starts now.

**Data model:** tokens gain `z`/elevation; `game_maps` gains per-cell height data (JSONB grid). Fog stays cell-based — the shroud tiles become iso diamonds; reveal semantics unchanged. The visibility filter needs at most an elevation dimension if we ever want "players on floor 1 don't see floor 2," which is still cell math, not raycasting.

**Hardware/software impact:** still negligible. Isometric scenes with sprite or low-poly art are a light GPU load; every device that runs the current app is fine. Local hosting unaffected.

## Tier 3 — Full 3D tabletop

Maps become 3D scenes: sculpted or tile-built terrain, buildings with interiors, free-orbit camera, animated 3D minis. This is the "separate rendering path, not an increment" the backlog already warns about. Honest framing: it is a second product sharing the same server.

### Software — frontend

- **Engine:** Three.js via `react-three-fiber` + `drei` (recommended — the app is already React, and r3f keeps scene code declarative and testable), or Babylon.js (more batteries included: built-in scene inspector, GUI, physics). Both run in every modern browser over WebGL 2, with WebGPU as a progressive upgrade, so players still just open a URL — no installs, which preserves the current connection model.
- **Map format rewrite:** today a map is `asset_path` (an image) + `revealed_tiles`. A 3D map is a *scene description* — tile/prop placements with transforms, terrain data, lighting. New JSONB scene schema on `game_maps` (or a `map_objects` table). The map editor already proposed in the backlog (§1 "Build maps on the fly") would have to be a 3D editor — that editor is plausibly *more* work than the renderer itself.
- **Asset pipeline** (the real recurring cost): glTF/GLB models compressed with Draco or meshopt, KTX2-compressed textures, instanced rendering for repeated tiles, LODs. And a content question that is bigger than the code: where do models come from? Realistic answer: CC0 low-poly packs (Kenney, Quaternius), purchased packs, HeroForge-style exports for minis. Budgeting assets (low-poly, baked lighting) is what keeps the hardware floor low.
- **Reused as-is:** Socket.io sync, the store, TanStack Router, auth/roles, character sheets, the entire backend event layer.

### Software — backend (GM's machine)

- Express already serves static assets; it now serves model/texture packs. Add cache headers.
- Scene CRUD endpoints and the extended schema. The visibility filter keeps operating on cell coordinates.
- No rendering, no GPU work, no meaningful CPU/RAM growth server-side. Postgres is indifferent.

### Hardware

- **Players:** a browser with WebGL 2 and roughly an integrated GPU from the last 8 years — Apple silicon, Intel Iris Xe, AMD APUs all comfortably render a budgeted low-poly tabletop scene at 1080p/60. 8 GB RAM. The devices that drop off are old tablets and low-end Chromebooks that today handle the 2D map fine. (For calibration, TaleSpire's minimum is a ~2012 i5 with a GTX 660-class GPU — and browser scenes should be budgeted lighter than that.)
- **GM:** the GM machine runs the server *plus* a client, and the GM view is the heaviest (whole scene visible, editor mode, no fog). Recommended: 16 GB RAM and Apple silicon or a modest discrete GPU. Still ordinary consumer hardware — nothing exotic, no server-grade anything.

### Network — where local hosting is actually tested

State sync stays tiny (same JSON deltas). The change is **first-load asset delivery**: a 2D map is a 2–10 MB image; a textured 3D scene plus minis is realistically 50–300 MB before caching.

- **LAN players:** a non-issue. Gigabit/WiFi LAN moves that in seconds.
- **Remote players via ngrok:** the pinch point. Two limits stack — the GM's residential *upload* speed (commonly 10–40 Mbps) and ngrok free-tier bandwidth caps. Four players pulling 150 MB each through the tunnel at session start is a bad evening.

Mitigations, in order of preference:
1. **Cache hard on the client** — service worker / IndexedDB so each player downloads a given asset pack exactly once, ever.
2. **Shared asset packs** — curated packs players can pre-download before session day, rather than per-map ad-hoc assets.
3. **Hybrid hosting** — static assets on a free/cheap CDN or object store (Cloudflare R2 / Pages), while the *game server stays on the GM's machine*. This keeps the local-host model for everything stateful and moves only immutable files. This is the recommended shape if remote players are common.

### Verdict on local hosting

**No tier forces a move off local hosting.** The reasons to ever move remain the ones already logged in the backlog (uptime, no ngrok friction) — 3D does not add a new one, provided static assets are cached or CDN-offloaded for remote players.

## Tier 4 — Full 3D gameplay: space combat from any angle

Tier 3 makes the *picture* 3D; Tier 4 makes the *game state* 3D. Ships occupy a volume, have an attitude (pitch/roll/yaw), and can attack from above, below, or any oblique vector. Animations stop being decoration and start communicating gameplay (who fired at whom, from where). Everything in Tier 3 applies; this section covers only what changes on top of it.

### How 3D gameplay changes the picture

Three conclusions from the earlier tiers get revised:

1. **Tiers 1–2 stop being stepping stones.** A Pixi-isometric investment builds toward nothing here — attacks from below cannot be faked with y-offsets. If space combat is the destination, the ladder is: Tier 1 (still worthwhile, independent) → straight to a Tier 3/4 renderer spike.
2. **Fog of war is replaced, not extended.** `revealed_tiles` models walls and corridors; open space has neither. The replacement is *cheaper*, and the anti-cheat filter keeps its shape (details below).
3. **The hard problem moves from rendering to input.** Rendering ships in a volume is well-trodden; letting a GM and players *place* ships in a volume with a 2D mouse, precisely and quickly, is the genuinely hard part. Budget real design iteration there.

### State model

- **Position:** `{ x, y, z }` in map units. **Orientation:** a quaternion (or yaw/pitch/roll) per token — required, because "attack from any angle" implies facing, firing arcs, and shield/armor facings are directional. A token-move delta becomes ~7 numbers instead of 2; the delta protocol and `shared/src/contracts.ts` extend naturally, and JSONB absorbs it.
- **No physics engine needed.** Tabletop space combat is plotted/turn-based: the server stores poses, clients tween between them. Weapon fire, engine burns, and explosions are cosmetic client-side animation. (Real-time Newtonian simulation would be a different product — flagged in open questions.)
- **Grid choice:** a 3D cube lattice keeps snap-to-grid and cell math, but most tabletop space systems play gridless with a tape-measure. Recommended: gridless space maps with a 3D distance/vector measurement tool, keeping cells as a per-map-kind concept rather than deleting them.

### Visibility & anti-cheat in open space

The good news: this gets *simpler* than dungeon fog. With no terrain occlusion, visibility is about sensors and stealth, not revealed floor. Two predicates, both raycast-free and both running in the same server-side choke point (`visibilityFilter.ts`):

- **Manual (GM-controlled):** a per-token `hidden` flag — the cloaked ship, the undetected ambusher. The GM toggles it exactly like today's conceal.
- **Sensor range (optional):** a token is visible if within radius *R* of any player ship — one 3D distance check per pair. Same spirit as the cell filter: cheap math, server-side, stripped before broadcast.

`game_maps` gains a `kind` (`surface` | `space`) and space maps use these predicates while surface maps keep `revealed_tiles`. Ship *interiors* (boarding actions, deck plans) remain surface maps with the existing cell fog — which is an argument for keeping the 2D path alive (see dual-mode below).

### 3D animations

- **Tech:** glTF animation clips played through the engine's mixer (Three.js `AnimationMixer` / r3f `useAnimations`) for ship-level motion — turret tracking, engine glow, bay doors — plus a particle system for weapons fire, impacts, and explosions.
- **Sync pattern:** the server broadcasts small *semantic events* (`attack_declared { attackerId, targetId, weaponId, result }`); every client plays the corresponding animation locally. This is the same trick as the Tier 1 dice: authoritative result over the wire, cosmetic spectacle rendered locally, deltas stay tiny. No animation data ever crosses the network.
- **Asset note:** animated ship models cost more to source or build than static minis — animation-ready rigs are rarer in CC0 packs. Sourcing is again a bigger constraint than code.

### The genuinely hard part: 3D maneuver UX

Placing an object at an arbitrary point in a volume using a 2D screen and mouse is a classic hard interaction problem, and no library solves it off the shelf. The proven mitigations (worth prototyping early):

- **Drop-line + shadow disc:** every ship projects a line and marker onto a reference plane, so depth is readable at a glance.
- **Two-step move:** drag on the reference plane for x/y, then a dedicated elevation handle or scroll for z; ghost preview of the final pose before commit.
- **Attitude widget:** a rotation gizmo (or bearing + inclination dial) for facing, since arcs make orientation gameplay-relevant.
- **Camera bookmarks:** one-key top/side/behind-ship views, because judging 3D positions requires changing viewpoints.
- **Arc/range visualization:** translucent cones and spheres for firing arcs, sensor bubbles, and weapon ranges — this is where "attack from any angle" becomes legible to players.

### Dual-mode architecture

A system-agnostic VTT almost certainly still needs flat play — dungeon crawls, ship deck plans, ground missions. Rather than forcing everything through the 3D renderer, keep two rendering paths behind one contract: `kind: 'surface'` maps use the existing PixiJS path and cell fog; `kind: 'space'` maps use the Three.js path and sensor visibility. The store, socket layer, and server stay shared. This also de-risks delivery: space mode can ship while 2D play continues untouched.

### Hardware & network — easier than Tier 3, not harder

Counterintuitive but true: a space battle is a *lighter* scene than a 3D terrain tabletop. It is a skybox, a dozen ship models, and particles — far fewer draw calls than terrain, buildings, and props. Particle effects are the only new GPU cost and are easily budgeted.

- **Hardware floors:** unchanged from Tier 3 for the GM; for players, if anything slightly lower.
- **Assets:** a compressed ship model is ~1–10 MB, a skybox 5–20 MB. A full battle plausibly fits under 50 MB, cached once — versus 50–300 MB for a terrain scene. The ngrok pinch point shrinks accordingly.
- **Local hosting:** unaffected; Tier 4 is the *most* comfortable full-3D tier for the local-host model.

### Effort

Tier 3's multi-month base, plus: the orientation/state extension (small), the space visibility model (small — it is simpler than fog), the animation event system (moderate), and the maneuver UX (large, and iterative — the long pole). Rough add: 1–3 months on top of Tier 3, dominated by UX iteration.

---

## Recommendation

With space combat as the stated destination, the staging changes: skip Tier 2 entirely (isometric work builds toward nothing you need) and aim the first spike at the hard problem.

1. **Tier 1 remains worthwhile and independent** — 3D dice and better mini art are days-to-weeks, zero hosting impact, and deliver early "wow" while the big work proceeds.
2. **Skip Tier 2.** Pixi-isometric is a dead end on the road to attacks-from-below. Only do it if flat ground play with elevation is valuable *on its own*.
3. **Spike the maneuver UX first, not the renderer.** A `react-three-fiber` branch that renders ships at `{x, y, z}` with an orbit camera, drop-lines to a reference plane, and a two-step move tool — driven by the existing Socket.io deltas extended with `z` + orientation. That one spike validates the hardest UX problem *and* proves the server architecture carries 3D state, before any asset-pipeline or editor investment.
4. **Build space mode as a dual-mode addition, not a replacement** — `surface` maps keep the shipped PixiJS path and cell fog (deck plans, boarding actions, ground missions); `space` maps get the 3D path and sensor visibility. De-risks delivery and preserves everything already built.

## Open questions (for future vetting)

- **Turn-based/plotted movement or real-time?** Everything above assumes plotted (tabletop-style) movement. Real-time continuous simulation is a different product: server tick loop, client prediction, physics — a much larger lift.
- **Gridded 3D lattice or gridless space with a measurement tool?** (Recommended: gridless + 3D tape-measure; keep cells for surface maps.)
- **How much does the tool enforce vs visualize?** Firing arcs, ranges, and facings can be GM-adjudicated with visual aids (system-agnostic, recommended) or rules-enforced (system-specific, cuts against the core constraint).
- Do ship interiors / ground scenes stay on the 2D PixiJS path (dual-mode, recommended) or does everything eventually move to the 3D renderer?
- Content sourcing: animation-ready ship models are scarcer than static minis — CC0 packs vs purchased vs commissioned?
- Remote-player mix: mostly LAN, or mostly ngrok? Determines whether the CDN hybrid is needed at all (less pressing at Tier 4 than Tier 3, since space assets are smaller).

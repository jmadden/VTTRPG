# 08 - Per-Audience Visibility (per-player fog of war)

**Status: design, not yet built.** This doc specifies how we move from one
shared, map-level fog set to per-player visibility. It is the resolution of the
"show a map to only select players" item in `docs/07-features.md`. Docs 01-06
describe the current as-built system; this describes where the fog model is
going. Nothing here is implemented yet.

## 1. Why

Today fog is map-level: `game_maps.revealed_tiles` is one set shared by all
players, and the only audience split is GM vs players (see docs 02, 03, 04).
That cannot express the moments that matter at the table:

1. **Solo peek.** Six players stand in a dungeon hall; one opens a door and
   looks into a room. Only that player should see inside; the other five should
   not.
2. **Party split.** At a junction, half the party goes left and half goes
   right. Players who are together share what they see; the two groups do not
   see each other's area.
3. **Breakout (different maps).** Three players enter a house in town while the
   rest descend into a dungeon. The house group sees only the house; the
   dungeon group sees only the dungeon, on a different map entirely.

The GM always sees everything.

## 2. The model: shared base + per-user overlay

Each player's fog is computed from two layers:

- **Base layer** - the shared reveal every player on the map inherits. This is
  the existing `game_maps.revealed_tiles`, unchanged in meaning. "Reveal to
  everyone" / "conceal from everyone" write here, exactly as today.
- **Per-user overlay** - tiles revealed to one specific player. "Reveal to a
  subset" writes overlays for the selected players only.

```
effective(player U) = base UNION overlay[U]
GM sees the union of base and all overlays (in practice: all cells, alpha 0.5).
```

Worked through the use cases:

- **Solo peek.** GM reveals the room to `overlay[p1]` only. p1 already has the
  hallway via base, so p1 now sees hallway + room; the other five see the base
  (hallway) and nothing of the room.
- **Party split.** Before the split everyone shares the base. The GM reveals the
  left corridor to the left players' overlays and the right corridor to the
  right players' overlays. Neither group sees the other's corridor.
- **Regroup is manual.** When groups reunite, nobody automatically gains the
  other group's discoveries. Overlaid tiles stay with whoever saw them until the
  GM explicitly shares them (see "share to everyone" in section 7). This mirrors
  the table: to learn what the other party found, you walk over and look, or
  they tell you and the GM reveals it.

Why this shape: the common case (the whole party together) never touches
overlays at all, so it stays as cheap and simple as today. Divergence only
appears when the GM deliberately targets a subset. And with zero overlay rows,
behavior is identical to the current system, so there is no migration and no
regression risk for existing tables.

## 3. Data model

Add one table; reframe (do not change) one column.

```sql
-- New: per-user overlay. Absence of a row means "no overlay" (base only).
CREATE TABLE map_visibility (
  map_id        UUID NOT NULL REFERENCES game_maps(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  revealed_tiles JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (map_id, user_id),
  CONSTRAINT map_visibility_is_array CHECK (jsonb_typeof(revealed_tiles) = 'array')
);
```

- `game_maps.revealed_tiles` keeps its type and CHECK; it is now understood as
  the **base layer**. No data migration.
- `map_visibility.revealed_tiles` uses the same JSONB array of `CellKey` strings
  (`"col,row"` for square, axial `"q,r"` for hex; see `shared/src/coords.ts`).
  Keying by `(map_id, user_id)` means each player already carries independent
  fog per map, which is what phase 2 (section 8) needs.

## 4. Wire contract deltas

Reveal and conceal gain an audience target. The client's own view stays a single
flat set, so most of the contract and all of the client rendering are untouched.

```ts
// Audience is GM-authored and validated server-side.
type Audience = 'everyone' | { userIds: string[] };

interface RevealTilesRequest  { mapId: string; add: CellKey[];    audience: Audience }
interface ConcealTilesRequest { mapId: string; remove: CellKey[]; audience: Audience }
```

- `audience: 'everyone'` writes the base layer (today's behavior).
- `audience: { userIds }` writes each listed user's overlay.
- **`state_sync.revealed` is unchanged in shape.** It already means "the joining
  client's view"; it now carries `effective(U)` for that user. The client still
  holds one `revealed: Set<CellKey>`.
- Reveal/conceal broadcasts become **per recipient** (section 5): the
  `newlyVisible` token list and the `token_remove` deltas are computed against
  each recipient's effective set, not a single players-room payload.

## 5. Server changes (where the work lands)

Almost all the work is server-side. The anti-cheat choke point does not change
shape; it just runs per user.

### Storage / repo (`backend/src/repo.ts`)

- Add an effective-set read: `base UNION overlay[user]` for a given
  `(map_id, user_id)`.
- `addRevealedTiles` / `removeRevealedTiles` gain an audience target. Reuse the
  existing SQL (`jsonb_agg(DISTINCT ...)` union for add, `#>> '{}' <> ALL(...)`
  rebuild for remove); apply it to `game_maps.revealed_tiles` when the audience
  is everyone, or upsert into `map_visibility` rows when it is a subset.

### Emission model (`backend/src/socket/index.ts`)

- Today there are two rooms per map (`map:<id>:gm`, `map:<id>:players`) and each
  visibility event picks one or both. That binary split cannot express N
  distinct player views.
- Replace it, for visibility-dependent events, with **per-socket emission**:
  compute each connected client's payload against its own effective set and emit
  to that socket. Dedupe by identical effective set so players who currently see
  the same thing are computed once. For a local host with roughly six players
  this is trivial.
- The GM still receives the full view. Keep a per-map room only as a convenience
  for enumerating sockets to fan out to.
- `token_move` gating, `token_add` / `token_remove`, `reveal_tiles`, and
  `conceal_tiles` all compute per user under this model.

### Filter reuse (`backend/src/lib/visibilityFilter.ts`)

No signature changes. `isVisibleToPlayers`, `gatePlayerTokenMove`,
`tokensNewlyVisible`, and `tokensNewlyHidden` already take a
`revealed: Set<CellKey>` and a `Grid`; they are now called once per distinct
effective set. `filterTokensForClient`'s `isGM` flag becomes "GM full view, or
filter against this supplied effective set." See section 9 for why the
anti-cheat guarantee still holds.

## 6. Client changes (minimal in phase 1)

Because every client only needs its own effective set:

- `frontend/src/store.ts` keeps its single `revealed: Set<CellKey>`; the
  `applyStateSync` / `applyReveal` / `applyConceal` mutators are unchanged.
- `frontend/src/game/PixiStage.ts` `redrawShroud` is unchanged, including the
  `isGM ? 0.5 : 1.0` fog alpha.
- The only additive client work is the GM's audience selector UI (section 7).

## 7. GM experience

- **Audience selector** on the fog tool: default "Everyone," or a multi-select
  of players. Reveal/conceal apply to the chosen audience.
- **Parties (audience presets):** a saved, named set of players (for example
  "Left party") so the GM can target a recurring group in one click. Presets are
  a convenience over the multi-select, not a storage primitive; where they live
  (a small table vs client-only) is deferred (section 10).
- **View as player:** let the GM preview a specific player's effective fog. This
  is how the GM confirms who can see what during a split. Optional in phase 1.
- **Share to everyone:** promote a set of overlay tiles into the base so all
  players gain them at once. This is the manual regroup path. Optional.

## 8. Phasing

**Phase 1 - per-audience fog on one shared active map.** Covers the solo peek
and the party split (use cases 1 and 2). Everything in sections 2-7.

**Phase 2 - breakout maps (different active map per sub-party).** Covers use
case 3. `map_visibility` is already keyed by `(map_id, user_id)`, so a player
carries separate fog per map for free. Phase 2 adds a **per-user active map**
(for example `user_active_map(campaign_id, user_id, map_id)` or session state):
the GM assigns players to maps, and each player loads the map they are assigned.
Per-socket emission (section 5) already sends each socket its own payload, so
routing different players to different maps is additive rather than a rewrite.
This also fully delivers the "show a map to only select players" tracker item.
Tokens already belong to a map, so token sync scopes to each player's map
naturally.

## 9. Anti-cheat correctness

The guarantee is unchanged and, if anything, cleaner: a `hidden` token on a cell
outside a recipient's effective set is stripped **entirely** from that
recipient's payload, so its existence and position never reach that client.
Under per-socket emission the payload is built from exactly the recipient's
effective set, so there is no shared players-room payload that could leak a
token to someone who has not revealed its cell. `visibilityFilter.ts` remains
the single module every non-GM payload passes through; it now runs per user.

## 10. Open questions (not blocking)

- **Parties storage:** a `parties` / audience-preset table vs client-only
  persistence. Decide when we build the selector.
- **Conceal precedence:** define that "conceal from everyone" clears the base
  (and, if we want a hard hide, the matching overlay tiles too), while "conceal
  from a subset" clears only those users' overlays. Spell this out before coding
  conceal.
- **Per-socket dedupe:** group recipients by identical effective set to compute
  each payload once; confirm the approach and its (generous) ceiling for a local
  host.
- **GM visual cue** for cells revealed to some-but-not-all players (for example
  a distinct tint in the GM view). Phase-2 polish.

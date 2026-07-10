# 04 - Server-Side Visibility Filter (Anti-Cheat)

`backend/src/lib/visibilityFilter.ts` is the single module every non-GM outbound
payload passes through. Its job: a `hidden` token on an unrevealed cell must be
stripped **entirely** from what players receive, so its existence and position
never reach the wire. Because fog is map-level, visibility is identical for all
players; these functions take one `revealed` set and a `Grid`, not a per-player
view.

## The rule

A token is visible to players when it is **not** `hidden`, OR it is `hidden`
but sits on a revealed cell:

```ts
isVisibleToPlayers(token, revealed, grid) =
  !token.hidden || revealed.has(worldToCell(token.x, token.y, grid))
```

GM-only fields (currently `hidden`) are removed from every token sent to
players, yielding the `ClientToken` shape (`stripGMFields`).

## Why it is not just one array filter

An initial snapshot filter is not enough: `token_move`, `reveal_tiles`, and
`conceal_tiles` are deltas that can each flip a token's visibility. Every such
delta is gated per audience before broadcast. The module exports one function
per case:

| Export | Used by | Purpose |
|--------|---------|---------|
| `filterTokensForClient(tokens, revealed, grid, isGM)` | `state_sync` | Initial array. GM: all (stripped to `ClientToken`); player: only visible tokens. |
| `gatePlayerTokenMove(token, prevX, prevY, revealed, grid)` | `token_move` | Returns `{kind: 'move' \| 'add' \| 'remove' \| 'none', ...}` for the players room. |
| `tokensNewlyVisible(tokens, addedCells, grid)` | `reveal_tiles` | Hidden tokens on just-revealed cells (the `newlyVisible` list). |
| `tokensNewlyHidden(tokens, concealedCells, grid)` | `conceal_tiles` | Hidden tokens on just-concealed cells (each becomes a `token_remove`). |
| `stripGMFields(token)` | all | Removes GM-only fields. |

## The token_move gating table

`gatePlayerTokenMove` compares the token's cell before and after against
`revealed` (see the table in doc 03):

- not hidden -> `move` (players always see non-hidden tokens)
- hidden, unrevealed -> unrevealed -> `none` (never existed to the player)
- hidden, revealed -> revealed -> `move`
- hidden, unrevealed -> revealed -> `add` (send the full `ClientToken`)
- hidden, revealed -> unrevealed -> `remove` (send just the id)

The GM room always receives the raw move; only the players room is gated.

## How the socket layer uses it

In `backend/src/socket/index.ts`:

- **join** -> `filterTokensForClient` builds the `state_sync` token array.
- **token_move** -> raw move to the GM room; `gatePlayerTokenMove` decides the
  players-room delta (`token_move` / `token_add` / `token_remove` / nothing).
- **reveal_tiles** -> `tokensNewlyVisible` builds the `newlyVisible` list.
- **conceal_tiles** -> `tokensNewlyHidden` yields a `token_remove` per token.

## Authorization vs visibility

Visibility filtering (this module) decides **what a client may receive**.
Separately, the socket handlers enforce **what a client may send** (GM-only
reveal/conceal; owner-or-GM for `sheet_update` and `token_move`). The
`movableTokenIds` list in `state_sync` mirrors the `token_move` authorization
rule so the UI only offers draggable tokens the client is actually allowed to
move; the server remains the authority.

## Verified

The pipeline is exercised end-to-end over real sockets against the live DB
(player vs GM visibility, reveal push, conceal re-hide, and GM-only
enforcement). See doc 06.

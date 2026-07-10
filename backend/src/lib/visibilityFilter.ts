// ============================================================================
// visibilityFilter.ts — server-side anti-cheat choke point.
//
// EVERY non-GM outbound payload (initial array OR delta) passes through this
// module. Hidden tokens on unrevealed cells are stripped ENTIRELY from what
// players receive, so their existence and position never reach the wire.
//
// Because fog is map-level, visibility is the same for all players; these
// functions take a single `revealed` Set and a `Grid`, not a per-player view.
// ============================================================================

import {
  worldToCell,
  type CellKey,
  type Grid,
  type Token,
  type ClientToken,
} from '@vtt/shared';

/** Remove GM-only fields, yielding a token safe to send to players. */
export function stripGMFields(token: Token): ClientToken {
  const { hidden: _hidden, ...clientSafe } = token;
  return clientSafe;
}

/** Is this token currently visible to players? A token is hidden from players
 *  only when it is flagged `hidden` AND sits on an unrevealed cell. */
export function isVisibleToPlayers(
  token: Token,
  revealed: Set<CellKey>,
  grid: Grid,
): boolean {
  if (!token.hidden) return true;
  return revealed.has(worldToCell(token.x, token.y, grid));
}

/**
 * Initial `state_sync`. GM gets everything (cast to ClientToken shape);
 * players get only visible tokens with GM fields stripped.
 */
export function filterTokensForClient(
  tokens: readonly Token[],
  revealed: Set<CellKey>,
  grid: Grid,
  isGM: boolean,
): ClientToken[] {
  if (isGM) return tokens.map(stripGMFields);
  return tokens
    .filter((t) => isVisibleToPlayers(t, revealed, grid))
    .map(stripGMFields);
}

/** Discriminated action the server emits to the players room after a move. */
export type PlayerMoveAction =
  | { kind: 'move'; tokenId: string; x: number; y: number }
  | { kind: 'add'; token: ClientToken }
  | { kind: 'remove'; tokenId: string }
  | { kind: 'none' };

/**
 * Gate a `token_move` for the players room. Compares the token's cell before
 * (prevX, prevY) and after (token.x, token.y) against `revealed` and returns
 * the correct delta — implementing the transition table in the WS contract.
 *
 * The caller supplies the token in its POST-move state (token.x/y already
 * updated) plus its prior coordinates.
 */
export function gatePlayerTokenMove(
  token: Token,
  prevX: number,
  prevY: number,
  revealed: Set<CellKey>,
  grid: Grid,
): PlayerMoveAction {
  // Non-hidden tokens are always fully visible: just relay the move.
  if (!token.hidden) {
    return { kind: 'move', tokenId: token.id, x: token.x, y: token.y };
  }

  const wasVisible = revealed.has(worldToCell(prevX, prevY, grid));
  const nowVisible = revealed.has(worldToCell(token.x, token.y, grid));

  if (!wasVisible && !nowVisible) return { kind: 'none' };
  if (wasVisible && nowVisible) {
    return { kind: 'move', tokenId: token.id, x: token.x, y: token.y };
  }
  if (!wasVisible && nowVisible) {
    return { kind: 'add', token: stripGMFields(token) };
  }
  // wasVisible && !nowVisible
  return { kind: 'remove', tokenId: token.id };
}

/**
 * Tokens that a `reveal_tiles` action just uncovered for players: hidden
 * tokens whose cell falls within the newly added cells. Returned as the
 * `newlyVisible` list in the players-room broadcast.
 */
export function tokensNewlyVisible(
  tokens: readonly Token[],
  addedCells: Set<CellKey>,
  grid: Grid,
): ClientToken[] {
  return tokens
    .filter((t) => t.hidden && addedCells.has(worldToCell(t.x, t.y, grid)))
    .map(stripGMFields);
}

/**
 * Tokens that a `conceal_tiles` action just re-hid from players: hidden tokens
 * whose cell falls within the concealed cells. The server emits a token_remove
 * for each so they vanish from the players' view. Non-hidden tokens are never
 * hidden by fog, so they are excluded.
 */
export function tokensNewlyHidden(
  tokens: readonly Token[],
  concealedCells: Set<CellKey>,
  grid: Grid,
): Token[] {
  return tokens.filter(
    (t) => t.hidden && concealedCells.has(worldToCell(t.x, t.y, grid)),
  );
}

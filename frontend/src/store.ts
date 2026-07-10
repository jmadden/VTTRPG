// ============================================================================
// store.ts: tiny vanilla store (no external deps).
//
// Mutable collections (Set / Map) are mutated in place; a monotonically
// increasing `version` primitive is the useSyncExternalStore snapshot, so
// React re-renders on every notify() without needing new object identities.
// ============================================================================

import {
  revealedSet,
  type CellKey,
  type ClientToken,
  type Grid,
  type RevealTilesBroadcastPlayers,
  type StateSyncPayload,
} from '@vtt/shared';

export interface GridDims {
  cols: number;
  rows: number;
}

export const state = {
  revealed: new Set<CellKey>(),
  tokens: new Map<string, ClientToken>(),
  grid: { type: 'square', size: 70 } as Grid,
  gridDims: { cols: 16, rows: 12 } as GridDims,
  isGM: false,
  // Token ids this client may drag (from state_sync).
  movable: new Set<string>(),
};

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

function notify(): void {
  version += 1;
  for (const l of listeners) l();
}

/** useSyncExternalStore subscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore getSnapshot: a primitive that changes on every mutation. */
export function getVersion(): number {
  return version;
}

// ── Mutators ────────────────────────────────────────────────────────────────

export function setGrid(grid: Grid, dims: GridDims): void {
  state.grid = grid;
  state.gridDims = dims;
  notify();
}

export function setIsGM(isGM: boolean): void {
  state.isGM = isGM;
  notify();
}

/** Replace all state from an initial server snapshot. */
export function applyStateSync(p: StateSyncPayload): void {
  state.grid = { type: p.gridType, size: p.gridSize };
  state.gridDims = { cols: p.cols, rows: p.rows };
  state.revealed = revealedSet(p.revealed);
  state.tokens = new Map(p.tokens.map((t) => [t.id, t]));
  state.movable = new Set(p.movableTokenIds);
  notify();
}

/** Add revealed cells and merge any tokens they just uncovered. */
export function applyReveal(cells: CellKey[], newlyVisible?: ClientToken[]): void {
  for (const c of cells) state.revealed.add(c);
  if (newlyVisible) {
    for (const t of newlyVisible) state.tokens.set(t.id, t);
  }
  notify();
}

/** Remove revealed cells (fog painted back over them). */
export function applyConceal(cells: CellKey[]): void {
  for (const c of cells) state.revealed.delete(c);
  notify();
}

export function addToken(token: ClientToken): void {
  state.tokens.set(token.id, token);
  notify();
}

export function removeToken(tokenId: string): void {
  state.tokens.delete(tokenId);
  notify();
}

export function moveToken(id: string, x: number, y: number): void {
  const t = state.tokens.get(id);
  if (!t) return;
  state.tokens.set(id, { ...t, x, y });
  notify();
}

/** Convenience for a players-room reveal broadcast. */
export function applyRevealBroadcast(p: RevealTilesBroadcastPlayers): void {
  applyReveal(p.revealed, p.newlyVisible);
}

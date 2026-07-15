// ============================================================================
// liveMaps.ts — pure helper for the set_live_maps pipeline. Kept DB-free so
// it's directly unit-testable; the socket handler calls this before
// repo.setLiveMaps to normalize whatever the client sent.
// ============================================================================

import type { LiveMapEntry } from '@vtt/shared';

export interface LiveMapEntryInput {
  mapId: string;
  title: string;
  position: number;
}

/**
 * Re-index an incoming ordered tab list to 0..n-1 and dedupe by `mapId`
 * (last write for a given mapId wins, but its slot keeps the position of
 * that mapId's first appearance in the array).
 */
export function normalizePositions(entries: readonly LiveMapEntryInput[]): LiveMapEntry[] {
  const byId = new Map<string, LiveMapEntryInput>();
  for (const e of entries) byId.set(e.mapId, e); // Map preserves first-seen key order; value is overwritten
  return Array.from(byId.values()).map((e, i) => ({
    mapId: e.mapId,
    title: e.title,
    position: i,
  }));
}

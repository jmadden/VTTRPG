// Unit spec (no DB): the pure set_live_maps normalization helper.
import { describe, it, expect } from 'vitest';
import { normalizePositions } from '../../backend/src/lib/liveMaps';

describe('normalizePositions', () => {
  it('re-indexes positions to 0..n-1 regardless of the incoming order', () => {
    const out = normalizePositions([
      { mapId: 'a', title: 'A', position: 5 },
      { mapId: 'b', title: 'B', position: 1 },
    ]);
    expect(out).toEqual([
      { mapId: 'a', title: 'A', position: 0 },
      { mapId: 'b', title: 'B', position: 1 },
    ]);
  });

  it('dedupes by mapId, last write wins, keeping the first-seen slot', () => {
    const out = normalizePositions([
      { mapId: 'a', title: 'A (old)', position: 0 },
      { mapId: 'b', title: 'B', position: 1 },
      { mapId: 'a', title: 'A (new)', position: 2 },
    ]);
    expect(out).toEqual([
      { mapId: 'a', title: 'A (new)', position: 0 },
      { mapId: 'b', title: 'B', position: 1 },
    ]);
  });

  it('returns an empty list unchanged', () => {
    expect(normalizePositions([])).toEqual([]);
  });
});

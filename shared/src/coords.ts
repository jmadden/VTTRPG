// ============================================================================
// coords.ts — geometry-agnostic cell math for the fog-of-war grid.
//
// A *cell* is identified by a canonical string key (`CellKey`):
//   - square grid: "col,row"   (integers)
//   - hex grid:    "q,r"        (axial integers, pointy-top)
//
// Both the backend visibility filter and the frontend shroud renderer key off
// these strings, so reveal state stays a flat Set<CellKey> regardless of
// geometry. `revealed_tiles` in the DB is a JSONB array of these keys.
// ============================================================================

export type GridType = 'square' | 'hex';
export type CellKey = string;

/** Grid geometry for a given map. `size` is world px: square side length, or
 *  hex center-to-corner distance (circumradius) for pointy-top hexes. */
export interface Grid {
  type: GridType;
  size: number;
}

// ── World (pixel) → cell key ────────────────────────────────────────────────

/** Convert a world-space (pixel) position to its canonical cell key. */
export function worldToCell(x: number, y: number, grid: Grid): CellKey {
  if (grid.type === 'square') {
    const col = Math.floor(x / grid.size);
    const row = Math.floor(y / grid.size);
    return `${col},${row}`;
  }
  // Pointy-top hex: pixel → fractional axial → cube-round to nearest hex.
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / grid.size;
  const r = ((2 / 3) * y) / grid.size;
  const [rq, rr] = axialRound(q, r);
  return `${rq},${rr}`;
}

// ── Cell key → world (pixel) center ─────────────────────────────────────────

/** Center point (world px) of a cell, for placing tokens / drawing the shroud. */
export function cellToWorld(key: CellKey, grid: Grid): { x: number; y: number } {
  const [a, b] = parseCell(key);
  if (grid.type === 'square') {
    return { x: (a + 0.5) * grid.size, y: (b + 0.5) * grid.size };
  }
  // Pointy-top hex axial → pixel center.
  const x = grid.size * (Math.sqrt(3) * a + (Math.sqrt(3) / 2) * b);
  const y = grid.size * ((3 / 2) * b);
  return { x, y };
}

/** Corner polygon (world px) of a cell — square = 4 pts, hex = 6 pts. */
export function cellPolygon(key: CellKey, grid: Grid): number[] {
  if (grid.type === 'square') {
    const [col, row] = parseCell(key);
    const s = grid.size;
    const x = col * s;
    const y = row * s;
    return [x, y, x + s, y, x + s, y + s, x, y + s];
  }
  const { x: cx, y: cy } = cellToWorld(key, grid);
  const pts: number[] = [];
  // Pointy-top: corners at 30°, 90°, ... (offset by 30° from flat-top).
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(cx + grid.size * Math.cos(angle), cy + grid.size * Math.sin(angle));
  }
  return pts;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fast-membership Set from a `revealed_tiles` array. */
export function revealedSet(keys: readonly CellKey[]): Set<CellKey> {
  return new Set(keys);
}

/** Parse "a,b" into a numeric tuple. */
export function parseCell(key: CellKey): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

/** Round fractional axial (q, r) to the nearest hex using cube rounding. */
function axialRound(q: number, r: number): [number, number] {
  // axial → cube: x=q, z=r, y=-x-z
  let x = q;
  let z = r;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  // Reset the coordinate with the largest rounding delta to preserve x+y+z=0.
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return [rx, rz]; // cube → axial: q=x, r=z
}

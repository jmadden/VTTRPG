// Unit specs (no DB): coordinate math + the anti-cheat visibility filter.
// Formalizes the throwaway coords/filter checks from docs/06.
import { describe, it, expect } from 'vitest';
import { worldToCell, cellToWorld, type Grid, type Token } from '@vtt/shared';
import {
  filterTokensForClient,
  gatePlayerTokenMove,
} from '../../backend/src/lib/visibilityFilter';

const square: Grid = { type: 'square', size: 70 };
const hex: Grid = { type: 'hex', size: 40 };

describe('coords', () => {
  it('square cell centers round-trip', () => {
    for (let col = -3; col <= 5; col++) {
      for (let row = -3; row <= 5; row++) {
        const key = `${col},${row}`;
        const c = cellToWorld(key, square);
        expect(worldToCell(c.x, c.y, square)).toBe(key);
      }
    }
  });

  it('hex cell centers round-trip', () => {
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        const key = `${q},${r}`;
        const c = cellToWorld(key, hex);
        expect(worldToCell(c.x, c.y, hex)).toBe(key);
      }
    }
  });

  it('square floors correctly at boundaries and negatives', () => {
    expect(worldToCell(0, 0, square)).toBe('0,0');
    expect(worldToCell(69.9, 0, square)).toBe('0,0');
    expect(worldToCell(70, 0, square)).toBe('1,0');
    expect(worldToCell(-1, 0, square)).toBe('-1,0');
  });
});

function token(over: Partial<Token>): Token {
  return {
    id: 't',
    mapId: 'm',
    characterSheetId: null,
    name: 'T',
    type: 'monster',
    x: 0,
    y: 0,
    hidden: false,
    ...over,
  };
}

describe('visibility filter', () => {
  const revealed = new Set(['0,0']); // cell 0,0 is x/y in [0,70)

  it('strips a hidden token on an unrevealed cell and removes the hidden field', () => {
    const orc = token({ id: 'orc', hidden: true, x: 150, y: 10 }); // cell 2,0 (unrevealed)
    const pc = token({ id: 'pc', type: 'player', hidden: false, x: 150, y: 10 });
    const out = filterTokensForClient([orc, pc], revealed, square, false);
    expect(out.map((t) => t.id)).toEqual(['pc']);
    expect(out[0] && 'hidden' in out[0]).toBe(false);
  });

  it('GM sees everything', () => {
    const orc = token({ id: 'orc', hidden: true, x: 150, y: 10 });
    expect(filterTokensForClient([orc], revealed, square, true)).toHaveLength(1);
  });

  it('gates hidden-token moves by visibility transition', () => {
    const orc = token({ id: 'orc', hidden: true });
    expect(gatePlayerTokenMove({ ...orc, x: 10, y: 10 }, 150, 10, revealed, square).kind).toBe('add');
    expect(gatePlayerTokenMove({ ...orc, x: 150, y: 10 }, 10, 10, revealed, square).kind).toBe('remove');
    expect(gatePlayerTokenMove({ ...orc, x: 200, y: 10 }, 150, 10, revealed, square).kind).toBe('none');
    expect(gatePlayerTokenMove({ ...orc, x: 30, y: 10 }, 10, 10, revealed, square).kind).toBe('move');
    const pc = token({ id: 'pc', type: 'player', hidden: false });
    expect(gatePlayerTokenMove({ ...pc, x: 500, y: 500 }, 10, 10, revealed, square).kind).toBe('move');
  });
});

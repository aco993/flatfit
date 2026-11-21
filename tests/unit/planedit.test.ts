import { describe, expect, it } from 'vitest';
import type { Room } from '../../src/types';
import { dragRoom, edgeSnap, extensionSpot, nearestWall, placeOpening, snap, touches, uid } from '../../src/domain/planedit';
import { openingProblems } from '../../src/domain/geometry';

const A: Room = { id: 'a', type: 'living', x: 0, z: 0, w: 4, d: 3 };
const B: Room = { id: 'b', type: 'bedroom', x: 4, z: 0, w: 3, d: 3 };

describe('editing a plan by hand', () => {
  it('snaps to the 5 cm grid, or to a room edge within 20 cm', () => {
    expect(snap(1.234)).toBeCloseTo(1.25, 5);
    expect(edgeSnap([A], 3.86, 'x')).toBe(4);
    expect(edgeSnap([A], 3.7, 'x')).toBeCloseTo(3.7, 5);
    expect(edgeSnap([A], 2.93, 'z')).toBe(3);
  });
  it('finds the wall nearest to a click, preferring the room the click is in', () => {
    // on the shared wall between A and B, a click just inside B picks B's west wall
    const hit = nearestWall([A, B], { x: 4.05, z: 1.5 })!;
    expect(hit.r.id).toBe('b');
    expect(hit.side).toBe('w');
    expect(hit.along).toBeCloseTo(1.5, 5);
    expect(nearestWall([A], { x: 2, z: 1.5 })).toBeNull();
  });
  it('knows which rooms share a wall', () => {
    expect(touches(A, B)).toBe(true);
    expect(touches(A, { ...B, x: 4.5 })).toBe(false);
    expect(touches(A, { ...B, x: 4, z: 3 })).toBe(false);
  });
  it('drags and resizes on the grid, never below 50 cm', () => {
    expect(dragRoom(A, 'move', 0.52, -0.21)).toEqual({ x: 0.5, z: -0.2, w: 4, d: 3 });
    expect(dragRoom(A, 'br', -3.9, 0.11)).toEqual({ x: 0, z: 0, w: 0.5, d: 3.1 });
    const tl = dragRoom(A, 'tl', 1, 1);
    expect(tl).toEqual({ x: 1, z: 1, w: 3, d: 2 });
  });
  it('makes the next free id', () => {
    expect(uid('r', [{ id: 'r1' }, { id: 'r3' }])).toBe('r4');
    expect(uid('r', [{ id: 'r3' }, { id: 'r2' }])).toBe('r4');
    expect(uid('o', [])).toBe('o1');
  });
});

describe('where an extension goes', () => {
  it('takes the first free side of the room, right first', () => {
    const r: Room = { id: 'a', type: 'living', x: 0, z: 0, w: 4, d: 3 };
    expect(extensionSpot([r], r)).toEqual({ x: 4, z: 1.5, w: 1.5, d: 1.5 });
    const right: Room = { id: 'b', type: 'kitchen', x: 4, z: 0, w: 2, d: 3 };
    // the right side is taken: below the room, flush with its right edge
    expect(extensionSpot([r, right], r)).toEqual({ x: 2.5, z: 3, w: 1.5, d: 1.5 });
  });
});

describe('a door clicked on a wall', () => {
  // a dining room open to the kitchen niche and to a short hall below it; one straight west wall from the niche down
  const rooms = [
    { id: 'kitchen', type: 'kitchen' as const, x: 0, z: 0, w: 1.2, d: 2.65 },
    { id: 'dining', type: 'dining' as const, x: 1.2, z: 0, w: 2.4, d: 3.4 },
    { id: 'hall', type: 'hall' as const, x: 1.2, z: 3.4, w: 1.58, d: 0.87 },
  ];
  const plan = {
    rooms,
    open: [
      ['kitchen', 'dining'],
      ['dining', 'hall'],
    ] as [string, string][],
  };
  it('may run past the corner of a short hall along the same wall, and belongs to the room where it starts', () => {
    const o = placeOpening(plan, { r: rooms[2], side: 'w', along: 0.3 }, 0.9);
    expect(o.width).toBe(0.9);
    expect(o.room).toBe('dining');
    expect(o.side).toBe('w');
    expect(o.at).toBeCloseTo(3.25, 2);
    const p = { id: 'p', name: 'p', country: 'rs', wallHeight: 2.6, ...plan, openings: [{ id: 'e1', kind: 'entry' as const, ...o }] };
    expect(openingProblems(p)).toEqual([]);
  });
  it('stays on the wall: not into the open side towards the kitchen, not past the end', () => {
    const top = placeOpening(plan, { r: rooms[1], side: 'w', along: 2.7 }, 0.9);
    expect(top.room).toBe('dining');
    expect(top.at).toBeGreaterThanOrEqual(2.65 + 0.05 - 1e-9);
    const bottom = placeOpening(plan, { r: rooms[2], side: 'w', along: 0.85 }, 0.9);
    const e = bottom.room === 'hall' ? 3.4 : 0;
    expect(e + bottom.at + bottom.width).toBeLessThanOrEqual(4.27 - 0.05 + 1e-9);
  });
});

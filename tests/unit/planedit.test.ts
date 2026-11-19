import { describe, expect, it } from 'vitest';
import type { Room } from '../../src/types';
import { dragRoom, edgeSnap, extensionSpot, nearestWall, snap, touches, uid } from '../../src/domain/planedit';

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

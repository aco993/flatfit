import { describe, expect, it } from 'vitest';
import type { Product, Project, SlotId } from '../../src/types';
import { deriveWalls, mainId, mainRooms, roomParts, spaceArea } from '../../src/domain/geometry';
import { autoLayout } from '../../src/domain/layout';
import { dimsOf } from '../../src/domain/selection';
import { surfaces } from '../../src/domain/surfaces';
import { isProject } from '../../src/store';

// an L-shaped living room: a 4 × 3 m main rectangle and a 2 × 2 m extension on its right, flush with the bottom
const L: Project = {
  id: 'l',
  name: 'L',
  country: 'rs',
  wallHeight: 2.5,
  rooms: [
    { id: 'a', type: 'living', x: 0, z: 0, w: 4, d: 3 },
    { id: 'b', type: 'living', x: 4, z: 1, w: 2, d: 2, part: 'a' },
    { id: 'c', type: 'bedroom', x: 6, z: 0, w: 3, d: 3 },
  ],
  open: [],
  openings: [{ id: 'd', kind: 'door', room: 'c', side: 'w', at: 0.2, width: 0.8 }],
};

describe('L- and U-shaped rooms', () => {
  it('know which rectangles make one room, and its whole area', () => {
    expect(mainId(L, 'b')).toBe('a');
    expect(mainRooms(L).map(r => r.id)).toEqual(['a', 'c']);
    expect(roomParts(L, 'a').map(r => r.id)).toEqual(['a', 'b']);
    expect(spaceArea(L, 'a')).toBe(16);
  });
  it('have no wall between the main rectangle and its extension', () => {
    const walls = deriveWalls(L).filter(w => w.axis === 'z' && Math.abs(w.c - 4) < 1e-6);
    // on the line x = 4 only the stretch above the extension (z 0..1) is a wall
    expect(walls.map(w => [w.a1, w.a2])).toEqual([[0, 1]]);
  });
  it('are furnished as one room: one sofa, nothing placed in the extension itself', () => {
    const p = (s: SlotId): Product => ({ id: s, slot: s, store: 't', name: s, url: '', price: 1, color: '' });
    const layout = autoLayout(L, s => dimsOf(p(s), s));
    expect(layout.placements.filter(pl => pl.slot === 'sofa')).toHaveLength(1);
    expect(layout.placements.some(pl => pl.room === 'b')).toBe(false);
  });
  it('count as one row of walls and floor, and as one room in a saved plan', () => {
    const s = surfaces(L);
    expect(s.rooms.map(r => r.room)).toEqual(['a', 'c']);
    expect(s.rooms[0].floor).toBe(16);
    expect(isProject(L)).toBe(true);
    expect(isProject({ ...L, rooms: [{ ...L.rooms[0], part: 7 }] })).toBe(false);
  });
  it('treat an extension whose main room is gone as a room of its own', () => {
    const orphan: Project = { ...L, rooms: [L.rooms[1], L.rooms[2]] };
    expect(mainId(orphan, 'b')).toBe('b');
    expect(mainRooms(orphan).map(r => r.id)).toEqual(['b', 'c']);
  });
});

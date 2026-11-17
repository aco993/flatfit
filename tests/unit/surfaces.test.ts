import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { packs, surfaces } from '../../src/domain/surfaces';

// one 4 × 3 m room, 2.5 m high, a 0.9 m door to the outside and a 1.2 × 1.3 m window
const ROOM: Project = {
  id: 't',
  name: 't',
  country: 'rs',
  wallHeight: 2.5,
  rooms: [{ id: 'a', type: 'living', x: 0, z: 0, w: 4, d: 3 }],
  open: [],
  openings: [
    { id: 'd', kind: 'entry', room: 'a', side: 's', at: 0.5, width: 0.9 },
    { id: 'w', kind: 'window', room: 'a', side: 'n', at: 1, width: 1.2, sill: 0.9, head: 2.2 },
  ],
};

describe('walls and floors', () => {
  it('measures paint, laminate and skirting of one room, openings taken out', () => {
    const s = surfaces(ROOM);
    // perimeter 14 m × 2.5 m = 35 m², minus the door 0.9 × 2.1 and the window 1.2 × 1.3
    expect(s.walls).toBeCloseTo(35 - 1.89 - 1.56, 2);
    expect(s.ceiling).toBe(12);
    expect(s.floor).toBe(12);
    expect(s.laminate).toBeCloseTo(13.2, 2);
    // skirting stops at the door only (the window is above the floor)
    expect(s.skirting).toBeCloseTo(14 - 0.9, 2);
    expect(s.paintLitres).toBe(Math.ceil((s.walls + 12) * 0.18 * 2));
  });
  it('paints a wall between two rooms on both faces and leaves open-plan edges and bathrooms out', () => {
    const two: Project = {
      ...ROOM,
      rooms: [
        { id: 'a', type: 'living', x: 0, z: 0, w: 4, d: 3 },
        { id: 'b', type: 'bedroom', x: 4, z: 0, w: 3, d: 3 },
        { id: 'c', type: 'bathroom', x: 0, z: 3, w: 2, d: 2 },
      ],
      openings: [],
    };
    const s = surfaces(two);
    const a = s.rooms.find(r => r.room === 'a')!,
      b = s.rooms.find(r => r.room === 'b')!;
    expect(a.walls).toBeCloseTo(14 * 2.5, 2);
    expect(b.walls).toBeCloseTo(12 * 2.5, 2);
    expect(s.rooms.find(r => r.room === 'c')).toMatchObject({ walls: 0, floor: 0, skirting: 0 });
    const open = surfaces({ ...two, open: [['a', 'b']] });
    expect(open.rooms.find(r => r.room === 'a')!.walls).toBeCloseTo(11 * 2.5, 2);
  });
  it('gives sensible figures for the demo flat', () => {
    const s = surfaces(DEMO);
    expect(s.walls).toBeGreaterThan(60);
    expect(s.walls).toBeLessThan(150);
    expect(s.floor).toBeGreaterThan(25);
    expect(s.paintLitres).toBeGreaterThan(20);
  });
  it('rounds packs up', () => {
    expect(packs(13.2, 2.22)).toBe(6);
    expect(packs(30, 15)).toBe(2);
    expect(packs(30.01, 15)).toBe(3);
    expect(packs(5, 0)).toBe(0);
  });
});

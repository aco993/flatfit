import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { deriveWalls, openingProblems, overlaps, roomArea } from '../../src/domain/geometry';

describe('demo apartment', () => {
  it('matches the official areas (living + kitchen + dining 26.36 m², room 9.6, bath 4.0, terrace 4.6)', () => {
    const area = (id: string) => roomArea(DEMO.rooms.find(r => r.id === id)!);
    expect(area('living') + area('dining') + area('kitchen')).toBeCloseTo(26.36, 2);
    expect(area('bedroom')).toBeCloseTo(9.6, 1);
    expect(area('bath')).toBeCloseTo(4.03, 2);
    expect(area('terrace')).toBeCloseTo(4.59, 2);
  });
  it('has no overlapping rooms and every opening sits on a wall', () => {
    expect(overlaps(DEMO.rooms)).toEqual([]);
    expect(openingProblems(DEMO)).toEqual([]);
  });
});

describe('deriveWalls', () => {
  const walls = deriveWalls(DEMO);
  it('removes the wall between open-plan rooms', () => {
    // living (z 0–3.9) and dining (z 3.9–6.2) are open: no wall along z = 3.9 between x 0 and 4
    expect(walls.some(w => w.axis === 'x' && Math.abs(w.c - 3.9) < 1e-6 && w.a1 < 3.9 && w.a2 > 0.1)).toBe(false);
  });
  it('keeps one shared wall between bedroom and living room, with the bedroom door in it', () => {
    const w = walls.find(w => w.axis === 'z' && Math.abs(w.c - 4) < 1e-6 && w.a1 <= 2.35 && w.a2 >= 3.1)!;
    expect(w).toBeTruthy();
    expect(w.openings.some(o => o.kind === 'door' && Math.abs(o.a - 2.35) < 1e-6)).toBe(true);
  });
  it('turns terrace edges into low parapets, but the facade next to the flat stays a full wall', () => {
    const parapets = walls.filter(w => w.kind === 'parapet');
    expect(parapets.length).toBeGreaterThan(0);
    const facade = walls.find(w => w.axis === 'x' && Math.abs(w.c) < 1e-6 && w.a1 <= 3.2 && w.a2 >= 3.8)!;
    expect(facade.kind).toBe('full');
    expect(facade.openings.some(o => o.kind === 'balcony')).toBe(true);
  });
  it('makes exterior walls for edges touched by one room', () => {
    expect(walls.filter(w => w.exterior).length).toBeGreaterThan(3);
  });
});

describe('templates', () => {
  for (const t of ['empty', 'studio', 'tworoom', 'demo'] as const) {
    it(`${t}: valid plan`, () => {
      const p = fromTemplate(t, 'x', 'de');
      expect(p.rooms.length).toBeGreaterThan(0);
      expect(overlaps(p.rooms)).toEqual([]);
      expect(openingProblems(p)).toEqual([]);
      expect(p.demo).toBeFalsy();
    });
  }
});

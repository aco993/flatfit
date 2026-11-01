import { describe, expect, it } from 'vitest';
import type { Project, SlotId, WallItem } from '../../src/types';
import { fromTemplate } from '../../src/data/templates';
import { autoLayout } from '../../src/domain/layout';
import { dimsOf } from '../../src/domain/selection';
import { applyMoves, footprints, moveIssues } from '../../src/domain/moves';
import { edgeOf } from '../../src/domain/geometry';
import { isProject } from '../../src/store';

const D = (s: SlotId) => dimsOf(undefined, s);
const has = () => true;
const pl = (p: Project, s: SlotId) => autoLayout(p, D).placements.find(x => x.slot === s)!;
/** Floor strip a radiator keeps free (15 cm deep), like the planner sees it. */
function strip(p: Project, w: WallItem) {
  const r = p.rooms.find(x => x.id === w.room)!, e = edgeOf(r, w.side), a = e.a1 + w.at, b = a + w.width;
  const inward = w.side === 'n' || w.side === 'w' ? 1 : -1, c1 = e.c + inward * 0.06, c2 = c1 + inward * 0.15;
  return e.axis === 'x' ? { x1: a, x2: b, z1: Math.min(c1, c2), z2: Math.max(c1, c2) } : { z1: a, z2: b, x1: Math.min(c1, c2), x2: Math.max(c1, c2) };
}
const hits = (a: { x1: number; x2: number; z1: number; z2: number }, b: typeof a) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.02 && Math.min(a.z2, b.z2) - Math.max(a.z1, b.z1) > 0.02;

describe('radiators and TV socket', () => {
  it('the TV bench goes to the wall with the TV socket, centred on it, and the sofa faces it', () => {
    const p = fromTemplate('tworoom', 't', 'rs');
    const tv = pl(p, 'tvunit'), sofa = pl(p, 'sofa');
    const sock = p.wallItems!.find(w => w.kind === 'tv')!;
    expect(tv.rot).toBeCloseTo(Math.PI / 2); // west wall, facing east
    expect(sofa.rot).toBeCloseTo(-Math.PI / 2); // east wall, facing west
    expect(Math.abs(tv.z - (sock.at + sock.width / 2))).toBeLessThan(0.05);
  });

  it('moving the socket to another wall moves the TV with it', () => {
    const p = fromTemplate('tworoom', 't', 'rs');
    const sock = p.wallItems!.find(w => w.kind === 'tv')!;
    sock.side = 'e'; sock.at = 2.0;
    expect(pl(p, 'tvunit').rot).toBeCloseTo(-Math.PI / 2);
  });

  it('a wardrobe is never planned in front of a radiator', () => {
    const p = fromTemplate('tworoom', 't', 'rs');
    p.wallItems = [];
    const w0 = pl(p, 'wardrobe');
    // put a radiator exactly behind where the wardrobe stood
    const r = p.rooms.find(x => x.id === w0.room)!;
    const side = (['n', 's', 'w', 'e'] as const).find(s => Math.abs(s === 'n' || s === 's' ? w0.z - (s === 'n' ? r.z : r.z + r.d) : w0.x - (s === 'w' ? r.x : r.x + r.w)) < 0.1)!;
    const along = side === 'n' || side === 's' ? w0.x - r.x : w0.z - r.z;
    const rad: WallItem = { id: 'h', kind: 'radiator', room: r.id, side, at: along - 0.4, width: 0.8 };
    p.wallItems = [rad];
    const w1 = pl(p, 'wardrobe');
    if (w1) for (const f of footprints(w1, D)) expect(hits(f, strip(p, rad))).toBe(false);
  });

  it('a wardrobe dragged in front of a radiator is reported', () => {
    const p = fromTemplate('tworoom', 't', 'rs');
    const rad = p.wallItems!.find(w => w.kind === 'radiator' && w.room === 'bedroom')!;
    const base = autoLayout(p, D), r = p.rooms.find(x => x.id === 'bedroom')!;
    // bedroom west wall: anchor on its inner face at the radiator's middle, facing east
    const L = applyMoves(base, { wardrobe: { x: r.x + 0.06, z: r.z + rad.at + rad.width / 2, rot: Math.PI / 2 } });
    expect(moveIssues(p, L, D, has)).toContainEqual({ slot: 'wardrobe', code: 'radiator' });
  });

  it('shared plans are checked: bad wall items are rejected', () => {
    const p = fromTemplate('tworoom', 't', 'rs');
    expect(isProject(p)).toBe(true);
    expect(isProject({ ...p, wallItems: [{ id: 'x', kind: 'fireplace', room: 'living', side: 'n', at: 0, width: 1 }] })).toBe(false);
    expect(isProject({ ...p, wallItems: undefined })).toBe(true);
  });
});

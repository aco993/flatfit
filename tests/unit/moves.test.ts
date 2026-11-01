import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import type { Catalog, Project, SlotId } from '../../src/types';
import { DEMO, RS_PRESETS } from '../../src/data/demo';
import { autoLayout } from '../../src/domain/layout';
import { dimsOf, fitIssues, fixDeps, indexCatalog, type Selection } from '../../src/domain/selection';
import { applyMoves, footprints, moveIssues, moveKey, snapPose, turnPose } from '../../src/domain/moves';

const ix = indexCatalog(rs as Catalog);
const sel = fixDeps(RS_PRESETS.scandi as Selection, ix);
const D = (s: SlotId) => dimsOf(sel[s] ? ix.byId.get(sel[s]!) : undefined, s);
const has = (s: SlotId) => !!sel[s];
const base = autoLayout(DEMO, D);
const pl = (L: typeof base, s: SlotId) => L.placements.find(p => p.slot === s)!;
const withMoves = (moves: Project['moves']): Project => ({ ...DEMO, moves });

describe('moving furniture', () => {
  it('maps attached pieces to the piece that is dragged', () => {
    expect(moveKey('tv')).toBe('tvunit');
    expect(moveKey('night')).toBe('bed');
    expect(moveKey('chairs')).toBe('table');
    expect(moveKey('sofa')).toBe('sofa');
    expect(moveKey('kitchen')).toBeNull();
    expect(moveKey('curtains')).toBeNull();
  });

  it('moves attached pieces rigidly with their anchor', () => {
    const b = pl(base, 'bed'), n = pl(base, 'night');
    const L = applyMoves(base, { bed: { x: b.x + 0.5, z: b.z, rot: b.rot } });
    expect(pl(L, 'bed').x).toBeCloseTo(b.x + 0.5);
    expect(pl(L, 'night').extra![0].x).toBeCloseTo(n.extra![0].x + 0.5);
    expect(pl(L, 'mattress').x).toBeCloseTo(b.x + 0.5);
    expect(pl(L, 'bed').moved).toBe(true);
    // pieces that were not moved keep their wall-based limits
    expect(pl(L, 'wardrobe').maxW).toBe(pl(base, 'wardrobe').maxW);
  });

  it('keeps the original layout untouched', () => {
    const b = pl(base, 'bed');
    applyMoves(base, { bed: { x: b.x + 1, z: b.z, rot: b.rot } });
    expect(pl(base, 'bed').x).toBe(b.x);
  });

  it('turning by 90° keeps the piece around its middle', () => {
    const p = { x: 1, z: 0.06, rot: 0 };
    const t = turnPose('bed', p, D);
    const d = D('bed').d;
    // middle before: (1, 0.06 + d/2); middle after: anchor + (sin, cos)(rot) * d/2
    expect(t.x + Math.sin(t.rot) * d / 2).toBeCloseTo(1);
    expect(t.z + Math.cos(t.rot) * d / 2).toBeCloseTo(0.06 + d / 2);
    expect(Math.abs(t.rot - Math.PI / 2)).toBeLessThan(1e-9);
  });
});

describe('snapping', () => {
  it('turns a sofa dragged near a wall to stand flush against it', () => {
    // living room is x 0–4, z 0–3.9; drag the sofa close to the west wall
    const s = snapPose(DEMO, 'sofa', 0.28, 2.03, 0, D);
    expect(s.x).toBeCloseTo(0.06);
    expect(s.rot).toBeCloseTo(Math.PI / 2);
    expect(Math.round(s.z * 100) % 5).toBe(0);
  });
  it('lets go of the wall once the piece is dragged well into the room', () => {
    const s = snapPose(DEMO, 'sofa', 0.9, 2.03, Math.PI / 2, D);
    expect(s.x).toBeCloseTo(0.9);
  });
  it('leaves free-standing pieces on the 5 cm grid where they are dropped', () => {
    const s = snapPose(DEMO, 'coffee', 2.02, 2.11, 0.3, D);
    expect(s).toEqual({ x: 2, z: 2.1, rot: 0.3 });
  });
});

describe('collisions of moved pieces', () => {
  it('reports nothing for the planner layout', () => {
    expect(moveIssues(DEMO, base, D, has)).toEqual([]);
  });
  it('a sofa pushed into the TV bench overlaps it', () => {
    const tv = pl(base, 'tvunit');
    const L = applyMoves(base, { sofa: { x: tv.x, z: tv.z, rot: tv.rot } });
    const iss = moveIssues(DEMO, L, D, has);
    expect(iss.some(i => i.slot === 'sofa' && i.code === 'overlap' && i.other === 'slot.tvunit')).toBe(true);
  });
  it('a coffee table outside the flat is reported', () => {
    const L = applyMoves(base, { coffee: { x: -2, z: 2, rot: 0 } });
    expect(moveIssues(DEMO, L, D, has)).toContainEqual({ slot: 'coffee', code: 'outside' });
  });
  it('an armchair put in front of the bedroom door is in the way', () => {
    const door = DEMO.openings.find(o => o.kind === 'door' && DEMO.rooms.find(r => r.id === o.room)?.type === 'bedroom') || DEMO.openings.find(o => o.kind === 'door')!;
    const r = DEMO.rooms.find(x => x.id === door.room)!;
    // middle of the door's swing square inside its room
    const along = door.side === 'n' || door.side === 's';
    const mid = (along ? r.x : r.z) + door.at + door.width / 2;
    const inset = door.side === 'n' ? r.z + 0.06 + door.width / 2 : door.side === 's' ? r.z + r.d - 0.06 - door.width / 2 : door.side === 'w' ? r.x + 0.06 + door.width / 2 : r.x + r.w - 0.06 - door.width / 2;
    const [x, z] = along ? [mid, inset] : [inset, mid];
    const L = applyMoves(base, { armchair: { x, z, rot: 0 } });
    expect(moveIssues(DEMO, L, D, has).some(i => i.slot === 'armchair' && i.code === 'door')).toBe(true);
  });
  it('fit checks include them, and drop the wall-length checks of the moved piece', () => {
    const tv = pl(base, 'tvunit');
    const proj = withMoves({ sofa: { x: tv.x, z: tv.z, rot: tv.rot } });
    const iss = fitIssues(proj, sel, ix);
    expect(iss.some(i => i.slot === 'sofa' && i.code === 'overlap' && i.hard)).toBe(true);
    expect(iss.some(i => i.slot === 'sofa' && i.code === 'wall')).toBe(false);
  });
  it('every footprint of the planner layout lies inside the flat', () => {
    for (const p of base.placements) for (const r of footprints(p, D)) {
      expect(r.x2 - r.x1).toBeGreaterThan(0);
      expect(r.x1).toBeGreaterThan(-0.2); expect(r.z1).toBeGreaterThan(-1.7);
    }
  });
});

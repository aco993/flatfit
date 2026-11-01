import type { Moves, Placement, Project, Room, Side, SlotId } from '../types';
import { WALL_T, deriveWalls, edgeOf, inward, openingSpan } from './geometry';
import { rotOf, sideInfo, type DimsFn, type Layout } from './layout';

/**
 * Moving furniture by hand. A move stores where the anchor of one movable piece ends up; pieces that
 * belong to it (TV on its bench, chairs at the table, bedside tables at the bed) follow rigidly.
 * Pure functions, so the snapping and collision rules are unit-tested.
 */

/** Pieces that can be dragged, and what moves with each one. */
export const MOVABLE: Partial<Record<SlotId, SlotId[]>> = {
  sofa: [], armchair: [], coffee: [], rug: [], floorlamp: [], wardrobe: [], washer: [], terrace: [],
  tvunit: ['tv'], table: ['chairs'], bed: ['mattress', 'base', 'night', 'lamps'], hall: ['hooks'],
};
/** Pieces whose anchor is the middle of their back, standing against a wall (the others are anchored at their centre). */
const AGAINST_WALL = new Set<SlotId>(['sofa', 'tvunit', 'bed', 'wardrobe', 'hall', 'washer']);
const HALF = WALL_T / 2, GRID = 0.05;

/** The movable piece a slot belongs to: clicking the TV drags the TV bench. */
export function moveKey(slot: SlotId): SlotId | null {
  if (MOVABLE[slot]) return slot;
  for (const [k, deps] of Object.entries(MOVABLE)) if (deps!.includes(slot)) return k as SlotId;
  return null;
}

const rotate = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
/** Turn (x, z) by the same rule three.js uses for rotation.y, so the 3D view and the plan agree. */
function transformer(from: { x: number; z: number; rot: number }, to: { x: number; z: number; rot: number }) {
  const dr = to.rot - from.rot;
  return (x: number, z: number): [number, number] => { const [rx, rz] = rotate(x - from.x, z - from.z, dr); return [to.x + rx, to.z + rz]; };
}

/** Layout with the user's moves applied. Moved placements lose the wall-based limits (maxW/maxD/gap); collisions are checked instead. */
export function applyMoves(L: Layout, moves: Moves | undefined): Layout {
  if (!moves || !Object.keys(moves).length) return L;
  const placements = L.placements.map(p => ({ ...p, extra: p.extra?.map(e => ({ ...e })) }));
  for (const [key, m] of Object.entries(moves) as [SlotId, NonNullable<Moves[SlotId]>][]) {
    const base = L.placements.find(p => p.slot === key); if (!base || !m) continue;
    const f = transformer(base, m), dr = m.rot - base.rot, group = [key, ...(MOVABLE[key] || [])];
    for (const p of placements) {
      if (!group.includes(p.slot)) continue;
      [p.x, p.z] = f(p.x, p.z); p.rot += dr;
      p.extra = p.extra?.map(e => { const [x, z] = f(e.x, e.z); return { ...e, x, z, rot: e.rot + dr }; });
      p.moved = true; p.maxW = Infinity; p.maxD = Infinity; delete p.gap;
    }
  }
  return { ...L, placements };
}

export interface Rect { x1: number; z1: number; x2: number; z2: number }
/** Axis-aligned box of a w×d piece centred at (cx, cz), turned by rot. */
function box(cx: number, cz: number, w: number, d: number, rot: number): Rect {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), hx = (c * w + s * d) / 2, hz = (s * w + c * d) / 2;
  return { x1: cx - hx, x2: cx + hx, z1: cz - hz, z2: cz + hz };
}
const front = (x: number, z: number, rot: number, d: number): [number, number] => [x + Math.sin(rot) * d / 2, z + Math.cos(rot) * d / 2];

/** Floor footprints of a placed piece (several for bedside tables). Rugs lie under things and have none. */
export function footprints(p: Placement, D: DimsFn): Rect[] {
  const s = p.slot, d = D(s);
  if (s === 'night') return (p.extra || []).map(e => box(...front(e.x, e.z, e.rot, d.d), d.w, d.d, e.rot));
  if (AGAINST_WALL.has(s)) return [box(...front(p.x, p.z, p.rot, d.d), d.w, d.d, p.rot)];
  if (s === 'floorlamp') return [box(p.x, p.z, 0.3, 0.3, 0)];
  if (s === 'table') return [box(p.x, p.z, d.w, d.d, p.rot)];
  if (s === 'armchair' || s === 'coffee' || s === 'terrace') return [box(p.x, p.z, d.w, d.d, p.rot)];
  if (s === 'kitchen' && p.extra?.[0]) return [box(...front(p.x, p.z, p.rot, 0.6), p.extra[0].w!, 0.6, p.rot)];
  return [];
}

const overlap = (a: Rect, b: Rect) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0 && Math.min(a.z2, b.z2) - Math.max(a.z1, b.z1) > 0
  ? Math.min(Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), Math.min(a.z2, b.z2) - Math.max(a.z1, b.z1)) : 0;
const FIXTURE_SIZE = { wc: [0.4, 0.65], vanity: [0.52, 0.45], shower: [0.92, 0.92] } as const;

export interface MoveIssue { slot: SlotId; code: 'outside' | 'overlap' | 'door'; other?: string; over?: number }

/** Is a floor point inside the flat and not inside a wall? */
function onFloor(p: Project, walls: ReturnType<typeof deriveWalls>, x: number, z: number) {
  if (!p.rooms.some(r => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d)) return false;
  return !walls.some(w => {
    const [c, a] = w.axis === 'x' ? [z, x] : [x, z];
    if (Math.abs(c - w.c) >= HALF - 0.005 || a < w.a1 || a > w.a2) return false;
    return !w.openings.some(o => a > o.a && a < o.b && o.lo < 0.05);
  });
}

/** Problems caused by moved pieces: out of the flat or into a wall, on top of another piece, in a door's way. */
export function moveIssues(p: Project, L: Layout, D: DimsFn, has: (s: SlotId) => boolean): MoveIssue[] {
  const moved = L.placements.filter(x => x.moved && MOVABLE[x.slot] && has(x.slot));
  if (!moved.length) return [];
  const walls = deriveWalls(p), out: MoveIssue[] = [];
  const solid = L.placements.filter(x => has(x.slot) && x.slot !== 'rug').flatMap(x => footprints(x, D).map(r => ({ slot: x.slot as string, key: moveKey(x.slot) || x.slot, r })));
  for (const f of L.fixtures) { const [w, d] = FIXTURE_SIZE[f.kind]; solid.push({ slot: 'fixture.' + f.kind, key: f.kind as SlotId, r: box(...front(f.x, f.z, f.rot, d), w, d, f.rot) }); }
  const doors = p.openings.filter(o => o.kind === 'door' || o.kind === 'entry' || o.kind === 'balcony').map(o => {
    const s = openingSpan(o, p.rooms)!, [nx, nz] = inward(o.side), depth = o.kind === 'balcony' ? 0.6 : o.width;
    const c1 = s.c + (s.axis === 'x' ? nz : nx) * HALF, c2 = c1 + (s.axis === 'x' ? nz : nx) * depth;
    return s.axis === 'x' ? { x1: s.a, x2: s.b, z1: Math.min(c1, c2), z2: Math.max(c1, c2) } : { z1: s.a, z2: s.b, x1: Math.min(c1, c2), x2: Math.max(c1, c2) };
  });
  const done = new Set<string>();
  for (const m of moved) {
    const key = moveKey(m.slot)!, mine = footprints(m, D);
    for (const r of mine) {
      if (!done.has(key + ':outside')) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push([r.x1 + 0.01 + (r.x2 - r.x1 - 0.02) * i / 4, r.z1 + 0.01 + (r.z2 - r.z1 - 0.02) * j / 4]);
        if (pts.some(([x, z]) => !onFloor(p, walls, x, z))) { out.push({ slot: key, code: 'outside' }); done.add(key + ':outside'); }
      }
      for (const o of solid) {
        if (o.key === key || done.has(key + ':' + o.key) || done.has(o.key + ':' + key)) continue;
        const ov = overlap(r, o.r);
        if (ov > 0.02) { out.push({ slot: key, code: 'overlap', other: o.slot.startsWith('fixture.') ? o.slot : 'slot.' + (moveKey(o.slot as SlotId) || o.slot), over: Math.round(ov * 100) }); done.add(key + ':' + o.key); }
      }
      if (!done.has(key + ':door') && doors.some(d => overlap(r, d) > 0.02)) { out.push({ slot: key, code: 'door' }); done.add(key + ':door'); }
    }
  }
  return out;
}

export interface Pose { x: number; z: number; rot: number }
const snapGrid = (v: number) => Math.round(v / GRID) * GRID;
const roomAtPoint = (p: Project, x: number, z: number): Room | undefined => p.rooms.find(r => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);

/**
 * Where a dragged piece lands. Everything snaps to a 5 cm grid. A piece that belongs against a wall turns
 * its back to the nearest wall and sits flush when dragged within reach of it.
 */
export function snapPose(p: Project, slot: SlotId, x: number, z: number, rot: number, D: DimsFn): Pose {
  const r = roomAtPoint(p, x, z);
  if (r && AGAINST_WALL.has(slot)) {
    const d = D(slot).d, si = sideInfo(p, r);
    let best: { side: Side; dist: number } | null = null;
    for (const s of si) {
      if (!s.wall) continue;
      const e = edgeOf(r, s.side), [nx, nz] = inward(s.side), face = e.c + (e.axis === 'x' ? nz : nx) * HALF;
      const dist = Math.abs((e.axis === 'x' ? z : x) - face);
      if (dist < Math.max(0.25, Math.min(0.45, d * 0.4)) && (!best || dist < best.dist)) best = { side: s.side, dist };
    }
    if (best) {
      const e = edgeOf(r, best.side), [nx, nz] = inward(best.side), face = e.c + (e.axis === 'x' ? nz : nx) * HALF;
      return e.axis === 'x' ? { x: snapGrid(x), z: face, rot: rotOf(best.side) } : { x: face, z: snapGrid(z), rot: rotOf(best.side) };
    }
  }
  return { x: snapGrid(x), z: snapGrid(z), rot };
}

/** Turn a pose by 90° about the piece's middle (not its back edge), so turning feels natural. */
export function turnPose(slot: SlotId, pose: Pose, D: DimsFn, by = Math.PI / 2): Pose {
  const off = AGAINST_WALL.has(slot) ? D(slot).d / 2 : 0;
  const [cx, cz] = front(pose.x, pose.z, pose.rot, 2 * off);
  let rot = pose.rot + by; while (rot > Math.PI + 1e-6) rot -= 2 * Math.PI; while (rot <= -Math.PI + 1e-6) rot += 2 * Math.PI;
  return { x: cx - Math.sin(rot) * off, z: cz - Math.cos(rot) * off, rot };
}

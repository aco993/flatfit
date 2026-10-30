import type { Opening, OpeningKind, Project, Room, Side, Wall, WallOpening } from '../types';

export const WALL_T = 0.12;
const EPS = 1e-3;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const roomArea = (r: Room) => r.w * r.d;

export function bounds(rooms: Room[]) {
  if (!rooms.length) return { x1: 0, z1: 0, x2: 1, z2: 1 };
  return {
    x1: Math.min(...rooms.map(r => r.x)), z1: Math.min(...rooms.map(r => r.z)),
    x2: Math.max(...rooms.map(r => r.x + r.w)), z2: Math.max(...rooms.map(r => r.z + r.d)),
  };
}

/** Edge of a room as a segment: axis 'x' runs along x at constant z. */
export function edgeOf(r: Room, side: Side) {
  switch (side) {
    case 'n': return { axis: 'x' as const, c: r.z, a1: r.x, a2: r.x + r.w };
    case 's': return { axis: 'x' as const, c: r.z + r.d, a1: r.x, a2: r.x + r.w };
    case 'w': return { axis: 'z' as const, c: r.x, a1: r.z, a2: r.z + r.d };
    case 'e': return { axis: 'z' as const, c: r.x + r.w, a1: r.z, a2: r.z + r.d };
  }
}

/** Inward normal of a room side, as [dx, dz]. */
export const inward = (side: Side): [number, number] => ({ n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] } as const)[side] as [number, number];

export function openingSpan(o: Opening, rooms: Room[]) {
  const r = rooms.find(x => x.id === o.room);
  if (!r) return null;
  const e = edgeOf(r, o.side);
  return { axis: e.axis, c: e.c, a: e.a1 + o.at, b: e.a1 + o.at + o.width };
}

export function openingHeights(kind: OpeningKind, o?: Partial<Opening>) {
  switch (kind) {
    case 'window': return { lo: o?.sill ?? 0.9, hi: o?.head ?? 2.2, glass: true };
    case 'balcony': return { lo: 0, hi: o?.head ?? 2.3, glass: true };
    default: return { lo: 0, hi: o?.head ?? 2.1, glass: false };
  }
}

const isOpen = (p: Project, a: string, b: string) => p.open.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Turns room rectangles into wall segments. Edges shared by two rooms become one wall,
 * edges between open-plan rooms disappear, edges of a terrace alone become a low parapet.
 */
export function deriveWalls(p: Project): Wall[] {
  type E = { axis: 'x' | 'z'; c: number; a1: number; a2: number; room: Room };
  const edges: E[] = [];
  for (const r of p.rooms) for (const s of ['n', 's', 'w', 'e'] as Side[]) { const e = edgeOf(r, s); edges.push({ ...e, c: r3(e.c), room: r }); }
  const groups = new Map<string, E[]>();
  for (const e of edges) { const k = e.axis + ':' + e.c; (groups.get(k) || groups.set(k, []).get(k)!).push(e); }

  const out: Wall[] = [];
  for (const list of groups.values()) {
    const { axis, c } = list[0];
    const cuts = [...new Set(list.flatMap(e => [r3(e.a1), r3(e.a2)]))].sort((a, b) => a - b);
    let cur: Wall | null = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
      const touching = list.filter(e => e.a1 < mid && e.a2 > mid).map(e => e.room);
      let kind: Wall['kind'] | null = 'full', exterior = touching.length === 1;
      if (touching.length === 0) kind = null;
      else if (touching.length >= 2 && isOpen(p, touching[0].id, touching[1].id)) kind = null;
      else if (touching.every(r => r.type === 'terrace')) kind = 'parapet';
      else if (touching.length >= 2 && touching.some(r => r.type === 'terrace')) exterior = true;
      if (kind && cur && cur.kind === kind && cur.exterior === exterior && Math.abs(cur.a2 - a) < EPS) { cur.a2 = b; continue; }
      if (kind) { cur = { axis, c, a1: a, a2: b, kind, exterior, openings: [] }; out.push(cur); } else cur = null;
    }
  }
  for (const o of p.openings) {
    const s = openingSpan(o, p.rooms); if (!s) continue;
    const w = out.find(w => w.axis === s.axis && Math.abs(w.c - s.c) < EPS && s.a >= w.a1 - EPS && s.b <= w.a2 + EPS);
    if (!w) continue;
    const h = openingHeights(o.kind, o);
    w.openings.push({ a: s.a, b: s.b, lo: h.lo, hi: h.hi, glass: h.glass, kind: o.kind, side: o.side } as WallOpening);
  }
  out.forEach(w => w.openings.sort((x, y) => x.a - y.a));
  return out;
}

/** Openings that are not on any wall (e.g. a door drawn on an open-plan edge) or that overlap each other. */
export function openingProblems(p: Project): string[] {
  const walls = deriveWalls(p), probs: string[] = [];
  for (const o of p.openings) {
    const s = openingSpan(o, p.rooms);
    if (!s) { probs.push(o.id + ':room'); continue; }
    if (!walls.some(w => w.openings.some(x => Math.abs(x.a - s.a) < EPS && Math.abs(x.b - s.b) < EPS))) probs.push(o.id + ':nowall');
  }
  for (const w of walls) for (let i = 1; i < w.openings.length; i++) if (w.openings[i].a < w.openings[i - 1].b - EPS) probs.push('overlap@' + w.c);
  return probs;
}

/** Rooms that overlap each other (more than 1 cm). */
export function overlaps(rooms: Room[]): [string, string][] {
  const res: [string, string][] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
    if (ox > 0.01 && oz > 0.01) res.push([a.id, b.id]);
  }
  return res;
}

export const roomAt = (rooms: Room[], x: number, z: number) => rooms.find(r => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);

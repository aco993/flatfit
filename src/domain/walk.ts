import type { Project } from '../types';
import { mainId, openingSpan } from './geometry';

/**
 * Walking through the flat in the 3D view. Where one can go from a room comes from the plan alone: a door or a
 * balcony door between two rooms, or the seam between two open-plan rooms. The camera never crosses a wall
 * anywhere else and never stands inside furniture.
 */
export interface Passage {
  /** the two rooms (main ids: an L-shaped room is one room) */
  a: string;
  b: string;
  kind: 'door' | 'balcony' | 'open';
  /** the wall line it sits on: along x at z = c (axis 'x'), or along z at x = c, from lo to hi */
  axis: 'x' | 'z';
  c: number;
  lo: number;
  hi: number;
}

export const EYE = 1.6;
/** how far from a wall the camera keeps, except while passing through a doorway */
const MARGIN = 0.25;

/** The room (main id) a floor point is in, or null outside the flat. */
export function roomAt(p: Project, x: number, z: number): string | null {
  const r = p.rooms.find(r => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);
  return r ? mainId(p, r.id) : null;
}

export function passages(p: Project): Passage[] {
  const out: Passage[] = [];
  for (const o of p.openings) {
    if (o.kind !== 'door' && o.kind !== 'balcony' && o.kind !== 'entry') continue;
    const s = openingSpan(o, p.rooms);
    if (!s) continue;
    const mid = (s.a + s.b) / 2;
    const [p1, p2] =
      s.axis === 'x'
        ? [
            [mid, s.c - 0.1],
            [mid, s.c + 0.1],
          ]
        : [
            [s.c - 0.1, mid],
            [s.c + 0.1, mid],
          ];
    const a = roomAt(p, p1[0], p1[1]),
      b = roomAt(p, p2[0], p2[1]);
    // the entrance from the stairwell leads nowhere inside the flat
    if (!a || !b || a === b) continue;
    out.push({ a, b, kind: o.kind === 'balcony' ? 'balcony' : 'door', axis: s.axis, c: s.c, lo: s.a, hi: s.b });
  }
  for (const [ia, ib] of p.open) {
    const A = p.rooms.find(r => r.id === ia),
      B = p.rooms.find(r => r.id === ib);
    if (!A || !B) continue;
    const near = (u: number, v: number) => Math.abs(u - v) < 1e-3;
    let seam: Omit<Passage, 'a' | 'b' | 'kind'> | null = null;
    if (near(A.x + A.w, B.x) || near(B.x + B.w, A.x))
      seam = { axis: 'z', c: near(A.x + A.w, B.x) ? B.x : A.x, lo: Math.max(A.z, B.z), hi: Math.min(A.z + A.d, B.z + B.d) };
    else if (near(A.z + A.d, B.z) || near(B.z + B.d, A.z))
      seam = { axis: 'x', c: near(A.z + A.d, B.z) ? B.z : A.z, lo: Math.max(A.x, B.x), hi: Math.min(A.x + A.w, B.x + B.w) };
    if (seam && seam.hi - seam.lo > 0.3) out.push({ a: mainId(p, ia), b: mainId(p, ib), kind: 'open', ...seam });
  }
  return out;
}

const other = (ps: Passage, room: string) => (ps.a === room ? ps.b : ps.a);
/** Unit normal of a passage pointing into `room`. */
function into(p: Project, ps: Passage, room: string): [number, number] {
  const m = (ps.lo + ps.hi) / 2;
  const [x, z] = ps.axis === 'x' ? [m, ps.c + 0.1] : [ps.c + 0.1, m];
  const plus = roomAt(p, x, z) === room;
  return ps.axis === 'x' ? [0, plus ? 1 : -1] : [plus ? 1 : -1, 0];
}
const at = (ps: Passage, t: number, off: number, n: [number, number]): [number, number] =>
  ps.axis === 'x' ? [t + n[0] * off, ps.c + n[1] * off] : [ps.c + n[0] * off, t + n[1] * off];

/** Whether the camera may stand here: inside the flat, off the walls (or in a doorway), not in furniture. */
export function standable(p: Project, x: number, z: number, blocked: (x: number, z: number) => boolean) {
  if (blocked(x, z)) return false;
  if (passages(p).some(ps => inDoorway(ps, x, z))) return true;
  const r = roomAt(p, x, z);
  if (!r) return false;
  // a wall within MARGIN shows as a neighbouring point outside this room (an L-shaped room is one room)
  const clear = [
    [x - MARGIN, z],
    [x + MARGIN, z],
    [x, z - MARGIN],
    [x, z + MARGIN],
  ].every(([u, v]) => roomAt(p, u, v) === r);
  return clear;
}
const inDoorway = (ps: Passage, x: number, z: number) => {
  const [along, across] = ps.axis === 'x' ? [x, z] : [z, x];
  return along > ps.lo + 0.15 && along < ps.hi - 0.15 && Math.abs(across - ps.c) < MARGIN + 0.05;
};

/** Whether a straight step from one point to another stays inside: the same room, or through a doorway. */
export function canStep(p: Project, from: [number, number], to: [number, number]) {
  const ra = roomAt(p, ...from),
    rb = roomAt(p, ...to);
  if (!rb) return false;
  if (ra === rb) return true;
  return passages(p).some(ps => {
    if (!((ps.a === ra && ps.b === rb) || (ps.a === rb && ps.b === ra))) return false;
    const [u0, v0, u1, v1] = ps.axis === 'x' ? [from[0], from[1], to[0], to[1]] : [from[1], from[0], to[1], to[0]];
    if ((v0 - ps.c) * (v1 - ps.c) > 0) return false;
    const t = v1 === v0 ? 0 : (ps.c - v0) / (v1 - v0),
      u = u0 + (u1 - u0) * t;
    return u > ps.lo + 0.15 && u < ps.hi - 0.15;
  });
}

export interface WalkSpot {
  /** the room it leads to */
  room: string;
  /** the ring on the floor, just inside the current room */
  x: number;
  z: number;
  /** the walk after the ring: through the doorway, and on to a free spot in the next room */
  path: [number, number][];
  /** the middle of the next room, to look at on arrival */
  look: [number, number];
  /** the middle of the doorway, where its label floats */
  door: [number, number];
}

/** Rings on the floor of a room, one for each way into another room. */
export function walkSpots(p: Project, room: string, blocked: (x: number, z: number) => boolean): WalkSpot[] {
  const out: WalkSpot[] = [];
  for (const ps of passages(p)) {
    if (ps.a !== room && ps.b !== room) continue;
    const next = other(ps, room),
      mid = (ps.lo + ps.hi) / 2,
      nin = into(p, ps, room),
      nout: [number, number] = [-nin[0], -nin[1]];
    const ok = (c: [number, number]) => roomAt(p, ...c) === next && standable(p, ...c, blocked);
    // where to cross: the middle of the passage, or along it (a dining table can stand behind an open seam)
    const ts = [0];
    for (let k = 0.3; k < (ps.hi - ps.lo) / 2; k += 0.3) ts.push(-k, k);
    let found: { t: number; path: [number, number][] } | null = null;
    for (const dt of ts) {
      const t = mid + dt;
      if (t < ps.lo + 0.2 || t > ps.hi - 0.2) continue;
      // straight on, then, if furniture stands right behind the door, a turn to the side
      for (const off of [0.9, 1.3, 0.6, 1.7]) {
        const c = at(ps, t, off, nout);
        if (ok(c)) {
          found = { t, path: [c] };
          break;
        }
      }
      if (found) break;
      const inside = at(ps, t, 0.45, nout);
      if (!ok(inside)) continue;
      for (const lat of [0.4, -0.4, 0.7, -0.7, 1.0, -1.0])
        for (const off of [0.45, 0.8]) {
          const c = at(ps, t + lat, off, nout);
          if (!found && ok(c)) found = { t, path: [inside, c] };
        }
      if (found) break;
    }
    if (!found) continue;
    const [x, z] = at(ps, found.t, 0.45, nin);
    const nr = p.rooms.find(r => r.id === next) || p.rooms.find(r => mainId(p, r.id) === next)!;
    out.push({ room: next, x, z, path: found.path, look: [nr.x + nr.w / 2, nr.z + nr.d / 2], door: at(ps, found.t, 0, nin) });
  }
  return out;
}

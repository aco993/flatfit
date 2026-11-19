import type { Room, Side } from '../types';
import { edgeOf } from './geometry';

/**
 * Geometry of editing a floor plan by hand: grid and edge snapping, the wall nearest to a click, rooms that touch.
 * Pure functions, so the editor's feel (what snaps where) is unit-tested without a browser.
 */
export const SNAP = 0.05;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;
export const r2 = (v: number) => Math.round(v * 100) / 100;
const SIDES: Side[] = ['n', 'e', 's', 'w'];

/** The next free id with a prefix: r1, r2, … */
export function uid(prefix: string, list: { id: string }[]) {
  let i = list.length + 1;
  while (list.some(x => x.id === prefix + i)) i++;
  return prefix + i;
}

/** Snap to the edge of a nearby room (within 20 cm), otherwise to the 5 cm grid. */
export function edgeSnap(rooms: Room[], v: number, axis: 'x' | 'z') {
  let best = snap(v),
    dist = 0.2;
  for (const r of rooms)
    for (const e of axis === 'x' ? [r.x, r.x + r.w] : [r.z, r.z + r.d])
      if (Math.abs(e - v) < dist) {
        dist = Math.abs(e - v);
        best = r2(e);
      }
  return best;
}

/** The room wall nearest to a point (within 35 cm); a room the point is inside wins ties, so doors open into it. */
export function nearestWall(rooms: Room[], p: { x: number; z: number }) {
  let best: { r: Room; side: Side; along: number; len: number } | null = null,
    bestD = 0.35;
  for (const r of rooms) {
    const inside = p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d ? 0.02 : 0;
    for (const side of SIDES) {
      const e = edgeOf(r, side),
        [u, v] = e.axis === 'x' ? [p.x, p.z] : [p.z, p.x];
      if (u < e.a1 || u > e.a2) continue;
      const d = Math.abs(v - e.c) - inside;
      if (d < bestD) {
        bestD = d;
        best = { r, side, along: u - e.a1, len: e.a2 - e.a1 };
      }
    }
  }
  return best;
}

/** Two rooms share a stretch of wall (more than 5 cm), so they can be joined as open plan. */
export function touches(a: Room, b: Room) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return (Math.abs(ox) < 0.01 && oz > 0.05) || (Math.abs(oz) < 0.01 && ox > 0.05);
}

/** A room dragged by its body ('move') or a corner handle ('br' bottom right, 'tl' top left), on the grid. */
export function dragRoom(r0: Room, mode: 'move' | 'br' | 'tl', dx: number, dz: number): Pick<Room, 'x' | 'z' | 'w' | 'd'> {
  if (mode === 'move') return { x: snap(r0.x + dx), z: snap(r0.z + dz), w: r0.w, d: r0.d };
  if (mode === 'br') return { x: r0.x, z: r0.z, w: Math.max(0.5, snap(r0.w + dx)), d: Math.max(0.5, snap(r0.d + dz)) };
  const nx = snap(r0.x + dx),
    nz = snap(r0.z + dz);
  const w = Math.max(0.5, r2(r0.x + r0.w - nx)),
    d = Math.max(0.5, r2(r0.z + r0.d - nz));
  return { x: r2(r0.x + r0.w - w), z: r2(r0.z + r0.d - d), w, d };
}

/**
 * Where a new extension of a room can go: a size-by-size rectangle against one of its sides, flush with a corner,
 * at the first place that overlaps no other room (right, bottom, left, top). Null when every side is taken.
 */
export function extensionSpot(rooms: Room[], r: Room, size = 1.5) {
  const w = Math.min(size, r.w),
    d = Math.min(size, r.d);
  const spots = [
    { x: r.x + r.w, z: r.z + r.d - d, w: size, d },
    { x: r.x + r.w, z: r.z, w: size, d },
    { x: r.x + r.w - w, z: r.z + r.d, w, d: size },
    { x: r.x, z: r.z + r.d, w, d: size },
    { x: r.x - size, z: r.z + r.d - d, w: size, d },
    { x: r.x - size, z: r.z, w: size, d },
    { x: r.x + r.w - w, z: r.z - size, w, d: size },
    { x: r.x, z: r.z - size, w, d: size },
  ].map(s => ({ x: r2(s.x), z: r2(s.z), w: r2(s.w), d: r2(s.d) }));
  const free = (s: { x: number; z: number; w: number; d: number }) =>
    rooms.every(o => {
      const ox = Math.min(s.x + s.w, o.x + o.w) - Math.max(s.x, o.x),
        oz = Math.min(s.z + s.d, o.z + o.d) - Math.max(s.z, o.z);
      return !(ox > 0.01 && oz > 0.01);
    });
  return spots.find(free) || null;
}

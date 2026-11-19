import type { Project, RoomType } from '../types';
import { deriveWalls, edgeOf, mainId, roomArea } from './geometry';

/**
 * Walls, ceilings and floors as quantities to buy: paint by the litre, laminate by the square metre with cutting
 * waste, skirting board by the metre. Everything comes from the plan the user already drew.
 *
 * A wall between two rooms is painted on both faces; walls on open-plan edges do not exist; door, window and
 * balcony openings are not painted; skirting stops at every opening that reaches the floor.
 */
const EPS = 1e-3;

/** rooms that are usually tiled (bathroom) or outside (terrace) are left out of paint and laminate */
const NO_PAINT: RoomType[] = ['bathroom', 'terrace'];
const NO_LAMINATE: RoomType[] = ['bathroom', 'terrace', 'kitchen'];

/** paint for interior walls, litres per m² for one coat (a typical dispersion paint: 0.15–0.20 l/m²) */
export const PAINT_L_PER_M2 = 0.18;
export const COATS = 2;
/** extra laminate for cutting */
export const LAMINATE_WASTE = 0.1;

export interface RoomSurface {
  room: string;
  type: RoomType;
  /** wall area to paint (m²), openings taken out */
  walls: number;
  ceiling: number;
  /** floor area for laminate (0 when the room type is usually tiled) */
  floor: number;
  /** skirting board length (m) */
  skirting: number;
}

export interface Surfaces {
  rooms: RoomSurface[];
  walls: number;
  ceiling: number;
  floor: number;
  skirting: number;
  /** litres for COATS coats on walls and ceilings */
  paintLitres: number;
  /** laminate with cutting waste (m²) */
  laminate: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function surfaces(p: Project): Surfaces {
  const H = p.wallHeight;
  const walls = deriveWalls(p).filter(w => w.kind === 'full');
  const rooms: RoomSurface[] = [];
  for (const r of p.rooms) {
    let wallArea = 0,
      skirting = 0;
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const e = edgeOf(r, side);
      for (const w of walls) {
        if (w.axis !== e.axis || Math.abs(w.c - e.c) > EPS) continue;
        const a = Math.max(e.a1, w.a1),
          b = Math.min(e.a2, w.a2);
        if (b - a <= EPS) continue;
        let area = (b - a) * H,
          floorRun = b - a;
        for (const o of w.openings) {
          const oa = Math.max(a, o.a),
            ob = Math.min(b, o.b);
          if (ob - oa <= EPS) continue;
          area -= (ob - oa) * Math.max(0, Math.min(H, o.hi) - Math.max(0, o.lo));
          if (o.lo <= EPS) floorRun -= ob - oa;
        }
        wallArea += Math.max(0, area);
        skirting += Math.max(0, floorRun);
      }
    }
    const paint = !NO_PAINT.includes(r.type),
      lam = !NO_LAMINATE.includes(r.type);
    rooms.push({
      room: r.id,
      type: r.type,
      walls: paint ? r2(wallArea) : 0,
      ceiling: paint ? r2(roomArea(r)) : 0,
      floor: lam ? r2(roomArea(r)) : 0,
      skirting: lam ? r2(skirting) : 0,
    });
  }
  // an L- or U-shaped room is one row: its extensions are added to the main rectangle
  for (let i = rooms.length - 1; i >= 0; i--) {
    const id = mainId(p, rooms[i].room);
    if (id === rooms[i].room) continue;
    const main = rooms.find(x => x.room === id)!;
    for (const k of ['walls', 'ceiling', 'floor', 'skirting'] as const) main[k] = r2(main[k] + rooms[i][k]);
    rooms.splice(i, 1);
  }
  const sum = (k: keyof Pick<RoomSurface, 'walls' | 'ceiling' | 'floor' | 'skirting'>) => r2(rooms.reduce((s, x) => s + x[k], 0));
  const w = sum('walls'),
    c = sum('ceiling'),
    f = sum('floor');
  return {
    rooms,
    walls: w,
    ceiling: c,
    floor: f,
    skirting: sum('skirting'),
    paintLitres: Math.ceil((w + c) * PAINT_L_PER_M2 * COATS),
    laminate: r2(f * (1 + LAMINATE_WASTE)),
  };
}

/** How many packs of a given size cover a quantity (buckets of paint, packs of laminate). */
export const packs = (need: number, perPack: number) => (perPack > 0 ? Math.ceil(need / perPack - 1e-9) : 0);

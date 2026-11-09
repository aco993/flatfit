import type { Opening, OpeningKind, Room, RoomType, Side } from '../types';

/**
 * Turning a picture of a floor plan into FlatFit rooms.
 *
 * Claude reads the picture and answers in the shape of PLAN_SCHEMA; everything it says is
 * treated as a suggestion: numbers are clamped, walls that almost meet are made to meet,
 * and anything that does not fit the model (unknown room type, a door on no wall) is dropped.
 * The user then corrects the result in the editor, on top of the same picture.
 */

const TYPES: RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'terrace'];
const KINDS: OpeningKind[] = ['door', 'entry', 'window', 'balcony'];
const SIDES: Side[] = ['n', 's', 'e', 'w'];

const num = { type: 'number' } as const;
/** JSON schema for structured output: every object closed, every field required (the API's rules). */
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'plan_box', 'rooms', 'openings', 'notes'],
  properties: {
    found: { type: 'boolean', description: 'false if the picture is not a floor plan of a flat' },
    plan_box: {
      type: 'object',
      additionalProperties: false,
      required: ['left', 'top', 'right', 'bottom'],
      description: 'pixel box, in the picture as sent, around the outer wall centrelines of the chosen flat',
      properties: { left: num, top: num, right: num, bottom: num },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'name', 'x', 'z', 'w', 'd', 'open_to'],
        properties: {
          type: { type: 'string', enum: TYPES },
          name: { type: 'string' },
          x: num,
          z: num,
          w: num,
          d: num,
          open_to: { type: 'integer', description: 'index of a room this one continues without a wall, or -1' },
        },
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'room', 'side', 'at', 'width'],
        properties: {
          kind: { type: 'string', enum: KINDS },
          room: { type: 'integer', description: 'index into rooms' },
          side: { type: 'string', enum: SIDES },
          at: num,
          width: num,
        },
      },
    },
    notes: { type: 'string', description: 'one or two sentences for the user: what was unclear or guessed' },
  },
} as const;

export interface PlanReading {
  found: boolean;
  plan_box: { left: number; top: number; right: number; bottom: number };
  rooms: { type: string; name: string; x: number; z: number; w: number; d: number; open_to: number }[];
  openings: { kind: string; room: number; side: string; at: number; width: number }[];
  notes: string;
}

/** What we ask. Plain English: the model reads plans in any language, the answer is data. */
export function planPrompt(imgW: number, imgH: number, hint: string) {
  return `This picture is an architectural floor plan or a hand sketch of a flat. It is ${imgW} × ${imgH} pixels.
Read it into rectangles for a furnishing app.

Rules:
- Coordinates are metres. x grows to the right, z grows down the picture. The origin (0,0) is the top-left corner of the flat's outer wall centrelines.
- Each room is an axis-aligned rectangle measured between wall centrelines, so neighbouring rooms share an edge exactly, with no gaps and no overlaps.
- Use the written dimensions (often centimetres on dimension lines, e.g. 382 = 3.82 m) and the room areas (m²) where given; estimate from the drawing scale only where nothing is written.
- An L-shaped or open-plan space becomes two or more rectangles; set open_to on the second to the index of the first so no wall is drawn between them.
- type: living, kitchen, dining, bedroom, bathroom (also WC), hall (entrance, corridor, storage, wardrobe room), terrace (balcony, loggia). name: the label written on the plan, if any, else "".
- openings: entry = the flat's front door, door = an inner door, window, balcony = a glazed door to a terrace or balcony. side is the wall of that room (n = top, s = bottom, w = left, e = right). at = distance in metres from the left end (n/s) or top end (w/e) of that wall to the start of the opening; width in metres. Put a door between two rooms only once.
- plan_box: the pixel coordinates (in this ${imgW} × ${imgH} picture) of the same outer outline, so the drawing can be laid under the rooms.
- If the picture shows several flats or a whole floor, read only one flat${hint ? ': ' + hint.slice(0, 200) : ': the most complete one, and say in notes which one you chose'}.
- Do not copy names of people, addresses or other personal details into name or notes.
- If it is not a floor plan, return found = false with empty lists.`;
}

const fin = (v: unknown, lo: number, hi: number, d = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const s05 = (v: number) => Math.round(v * 20) / 20;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Values closer than `tol` become one (their mean, on the 5 cm grid): walls that almost meet are made to meet. */
export function cluster(values: number[], tol = 0.15) {
  const sorted = [...new Set(values)].sort((a, b) => a - b),
    map = new Map<number, number>();
  let group: number[] = [];
  const flush = () => {
    const m = s05(group.reduce((s, v) => s + v, 0) / group.length);
    for (const v of group) map.set(v, m);
    group = [];
  };
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > tol) flush();
    group.push(v);
  }
  if (group.length) flush();
  return map;
}

/** Rooms with their edges lined up; rooms that collapse below 0.5 m are dropped. Returns kept indices too. */
export function tidyRooms(rooms: Omit<Room, 'id'>[]) {
  const xs = cluster(rooms.flatMap(r => [r.x, r.x + r.w])),
    zs = cluster(rooms.flatMap(r => [r.z, r.z + r.d]));
  const out: { room: Omit<Room, 'id'>; from: number }[] = [];
  rooms.forEach((r, i) => {
    const x1 = xs.get(r.x)!,
      x2 = xs.get(r.x + r.w)!,
      z1 = zs.get(r.z)!,
      z2 = zs.get(r.z + r.d)!;
    if (x2 - x1 < 0.5 || z2 - z1 < 0.5) return;
    out.push({ room: { ...r, x: x1, z: z1, w: r2(x2 - x1), d: r2(z2 - z1) }, from: i });
  });
  return out;
}

export interface ReadPlan {
  rooms: Room[];
  openings: Opening[];
  open: [string, string][];
  /** where the flat's outline sits in the picture, as fractions of its width and height */
  box: { x1: number; z1: number; x2: number; z2: number };
  notes: string;
}

/** Checks and cleans what came back; null if there is nothing usable. */
export function fromReading(raw: unknown, imgW: number, imgH: number): ReadPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PlanReading>;
  if (p.found === false || !Array.isArray(p.rooms)) return null;
  const rooms0 = p.rooms.slice(0, 40).map(r => ({
    type: (TYPES.includes(r?.type as RoomType) ? r.type : 'bedroom') as RoomType,
    name: typeof r?.name === 'string' ? r.name.trim().slice(0, 40) : '',
    x: fin(r?.x, -5, 60),
    z: fin(r?.z, -5, 60),
    w: fin(r?.w, 0, 40),
    d: fin(r?.d, 0, 40),
  }));
  const tidy = tidyRooms(rooms0);
  if (!tidy.length) return null;
  // shift so the flat starts at 0,0
  const ox = Math.min(...tidy.map(t => t.room.x)),
    oz = Math.min(...tidy.map(t => t.room.z));
  const idOf = new Map<number, string>();
  const rooms: Room[] = tidy.map((t, k) => {
    const id = 'r' + (k + 1);
    idOf.set(t.from, id);
    const { name, ...rest } = t.room as Omit<Room, 'id'> & { name: string };
    return { id, ...rest, x: r2(rest.x - ox), z: r2(rest.z - oz), ...(name ? { name } : {}) };
  });
  const open: [string, string][] = [];
  tidy.forEach(t => {
    const to = p.rooms![t.from]?.open_to;
    const a = idOf.get(t.from),
      b = typeof to === 'number' ? idOf.get(to) : undefined;
    if (a && b && a !== b && !open.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) open.push([b, a]);
  });
  const openings: Opening[] = [];
  for (const o of (Array.isArray(p.openings) ? p.openings : []).slice(0, 80)) {
    const id = idOf.get(o?.room as number),
      r = rooms.find(x => x.id === id);
    if (!r || !KINDS.includes(o.kind as OpeningKind) || !SIDES.includes(o.side as Side)) continue;
    const side = o.side as Side,
      len = side === 'n' || side === 's' ? r.w : r.d;
    if (len < 0.6) continue;
    const width = s05(Math.min(fin(o.width, 0.4, 6, 0.8), len - 0.1)),
      at = s05(fin(o.at, 0.05, Math.max(0.05, len - width - 0.05)));
    openings.push({ id: 'o' + (openings.length + 1), kind: o.kind as OpeningKind, room: r.id, side, at, width });
  }
  const b = p.plan_box,
    box =
      b && b.right > b.left && b.bottom > b.top
        ? { x1: fin(b.left / imgW, -1, 2), z1: fin(b.top / imgH, -1, 2), x2: fin(b.right / imgW, -1, 2), z2: fin(b.bottom / imgH, -1, 2) }
        : { x1: 0, z1: 0, x2: 1, z2: 1 };
  return { rooms, openings, open, box, notes: typeof p.notes === 'string' ? p.notes.slice(0, 400) : '' };
}

/**
 * Lays the picture under the rooms: the outline found in it (`box`, fractions of the picture)
 * should cover the rooms' extent. Uses the width; the height follows from the picture's aspect.
 */
export function placeBackdrop(plan: ReadPlan, ar: number) {
  const width = Math.max(...plan.rooms.map(r => r.x + r.w)),
    frac = plan.box.x2 - plan.box.x1;
  const w = frac > 0.05 ? width / frac : width;
  return { x: r2(-plan.box.x1 * w), z: r2(-plan.box.z1 * w * ar), w: Math.round(w * 1000) / 1000 };
}

import type { Placement, Project, Room, Side, SlotId, View } from '../types';
import { WALL_T, deriveWalls, edgeOf, inward, openingSpan } from './geometry';

export interface Dims {
  w: number;
  d: number;
  h: number;
}
/** Size in metres of the product chosen for a slot (or a sensible default). */
export type DimsFn = (slot: SlotId) => Dims;

const HALF = WALL_T / 2;
const SIDES: Side[] = ['n', 'e', 's', 'w'];
export const rotOf = (s: Side) => ({ n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 })[s];
const opposite = (s: Side): Side => (({ n: 's', s: 'n', e: 'w', w: 'e' }) as const)[s];
const perpendicular = (a: Side, b: Side) => (a === 'n' || a === 's') !== (b === 'n' || b === 's');

type Span = [number, number];
function subtract(spans: Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans) {
    if (cut[1] <= a || cut[0] >= b) {
      out.push([a, b]);
      continue;
    }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out.filter(([a, b]) => b - a > 0.05);
}
const len = (s: Span) => s[1] - s[0];
const longest = (spans: Span[]) => spans.reduce<Span | null>((best, s) => (!best || len(s) > len(best) ? s : best), null);

interface SideInfo {
  side: Side;
  wall: boolean;
  low: Span[];
  tall: Span[];
  windows: number;
  edge: ReturnType<typeof edgeOf> /** position of a TV socket on this side */;
  tvAt?: number;
}

/** Free stretches along each side of a room: "low" ignores windows (sofa, bed), "tall" avoids them (wardrobe, fridge). */
export function sideInfo(p: Project, r: Room, walls = deriveWalls(p)): SideInfo[] {
  return SIDES.map(side => {
    const e = edgeOf(r, side);
    const onLine = walls.filter(w => w.axis === e.axis && Math.abs(w.c - e.c) < 1e-3);
    let low: Span[] = [];
    for (const w of onLine) {
      const a = Math.max(w.a1, e.a1),
        b = Math.min(w.a2, e.a2);
      if (b - a > 0.05) low.push([a, b]);
    }
    const wall = low.length > 0;
    // keep clear of the corners where perpendicular walls stand
    low = low.map(([a, b]) => [a + (Math.abs(a - e.a1) < 1e-3 ? HALF : 0), b - (Math.abs(b - e.a2) < 1e-3 ? HALF : 0)] as Span);
    let tall = low.slice();
    let windows = 0;
    for (const o of p.openings) {
      const s = openingSpan(o, p.rooms);
      if (!s || s.axis !== e.axis || Math.abs(s.c - e.c) > 1e-3) continue;
      if (s.b <= e.a1 || s.a >= e.a2) continue;
      if (o.kind === 'window') {
        tall = subtract(tall, [s.a - 0.05, s.b + 0.05]);
        windows++;
        continue;
      }
      const pad = o.kind === 'entry' ? 0.25 : 0.1;
      // a door swings into the room that owns it: keep its whole width clear on that side plus the swing radius
      low = subtract(low, [s.a - pad, s.b + pad]);
      tall = subtract(tall, [s.a - pad, s.b + pad]);
    }
    // radiators: nothing tall in front of them; a TV socket marks where the TV wants to be
    let tvAt: number | undefined;
    for (const it of p.wallItems || []) {
      if (it.room !== r.id || it.side !== side) continue;
      const a = e.a1 + it.at,
        b = a + it.width;
      if (it.kind === 'radiator') tall = subtract(tall, [a - 0.05, b + 0.05]);
      else tvAt = (a + b) / 2;
    }
    return { side, wall, low, tall, windows, edge: e, tvAt };
  });
}

/** Point on the inner face of a side at position t along it. */
function facePoint(r: Room, side: Side, t: number): [number, number] {
  const e = edgeOf(r, side),
    [nx, nz] = inward(side);
  return e.axis === 'x' ? [t, e.c + nz * HALF] : [e.c + nx * HALF, t];
}

function wallItem(slot: SlotId, r: Room, side: Side, t: number, span: Span, depthRoom: number): Placement {
  const [x, z] = facePoint(r, side, t);
  return { slot, room: r.id, x, z, rot: rotOf(side), maxW: len(span), maxD: depthRoom };
}

const roomDepth = (r: Room, side: Side) => (side === 'n' || side === 's' ? r.d : r.w) - WALL_T;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Centre position for an item of width w inside span, as close to `want` as fits. */
const fitIn = (span: Span, w: number, want: number) =>
  len(span) <= w ? (span[0] + span[1]) / 2 : clamp(want, span[0] + w / 2, span[1] - w / 2);

function living(_p: Project, r: Room, si: SideInfo[], D: DimsFn, out: Placement[]) {
  const walls = si.filter(s => s.wall && s.low.length);
  if (!walls.length) return;
  const byLen = (list: SideInfo[]) => list.slice().sort((a, b) => len(longest(b.low)!) - len(longest(a.low)!));
  // a TV socket decides the TV wall and the sofa faces it; otherwise the sofa takes the longest wall
  const sock = walls.find(s => s.tvAt !== undefined);
  let sofaSide = byLen(walls)[0];
  if (sock) sofaSide = walls.find(s => s.side === opposite(sock.side)) || byLen(walls.filter(s => s !== sock))[0] || sofaSide;
  const opp = si.find(s => s.side === opposite(sofaSide.side))!;
  const tvSide =
    sock && sock !== sofaSide
      ? sock
      : opp.wall && opp.low.length && len(longest(opp.low)!) >= 1
        ? opp
        : byLen(walls.filter(s => s !== sofaSide))[0];
  const sofa = D('sofa'),
    sSpan = longest(sofaSide.low)!;
  const tvSpan = tvSide
    ? (tvSide.tvAt !== undefined && tvSide.low.find(([a, b]) => tvSide.tvAt! >= a && tvSide.tvAt! <= b)) || longest(tvSide.low)!
    : null;
  const tvWant = tvSide?.tvAt ?? (tvSpan ? (tvSpan[0] + tvSpan[1]) / 2 : 0);
  const along = sofaSide.side === 'n' || sofaSide.side === 's';
  let center = (sSpan[0] + sSpan[1]) / 2;
  if (tvSide && tvSide.side === opposite(sofaSide.side) && tvSpan) center = fitIn(sSpan, sofa.w, tvWant);
  else center = fitIn(sSpan, sofa.w, center);
  out.push(wallItem('sofa', r, sofaSide.side, center, sSpan, roomDepth(r, sofaSide.side)));
  const [nx, nz] = inward(sofaSide.side),
    depth = roomDepth(r, sofaSide.side);
  const [fx, fz] = facePoint(r, sofaSide.side, center);
  if (tvSide && tvSpan) {
    const tv = D('tvunit');
    const tvT = tvSide.side === opposite(sofaSide.side) ? fitIn(tvSpan, tv.w, tvSide.tvAt ?? center) : fitIn(tvSpan, tv.w, tvWant);
    out.push(wallItem('tvunit', r, tvSide.side, tvT, tvSpan, roomDepth(r, tvSide.side)));
    const t = out[out.length - 1];
    out.push({ ...t, slot: 'tv' });
  }
  // coffee table and rug in front of the sofa, toward the TV
  const cof = D('coffee'),
    gap = Math.min(0.45, Math.max(0.3, (depth - sofa.d - cof.d - 0.5) / 3));
  const cofOff = sofa.d + gap + cof.d / 2;
  const cx = fx + nx * cofOff,
    cz = fz + nz * cofOff;
  const cofRot = rotOf(sofaSide.side) + Math.PI / 2;
  out.push({ slot: 'coffee', room: r.id, x: cx, z: cz, rot: rotOf(sofaSide.side), maxW: sofa.w + 0.4, maxD: depth - sofa.d - 0.9 });
  const tvD = tvSide === opp ? D('tvunit').d : 0;
  const rugOff = (sofa.d - 0.15 + (depth - tvD - 0.3)) / 2;
  out.push({
    slot: 'rug',
    room: r.id,
    x: fx + nx * rugOff,
    z: fz + nz * rugOff,
    rot: cofRot,
    maxW: depth - sofa.d - tvD,
    maxD: len(sSpan),
  });
  // armchair diagonally beside the coffee table, on the window side if there is one (that end is a wall, not the open plan or the camera)
  const tAxis: [number, number] = along ? [1, 0] : [0, 1];
  const lo = along ? r.x : r.z,
    hi = along ? r.x + r.w : r.z + r.d;
  const sideRoom = [center - sofa.w / 2 - lo, hi - (center + sofa.w / 2)];
  const endSide = (k: number): SideInfo | undefined => si.find(x => x.side === (along ? (k < 0 ? 'w' : 'e') : k < 0 ? 'n' : 's'));
  const score = (k: number) => {
    const e = endSide(k);
    return (e?.windows ? 2 : 0) + (e?.wall ? 1 : 0);
  };
  let s = score(-1) === score(1) ? (sideRoom[1] >= sideRoom[0] ? 1 : -1) : score(-1) > score(1) ? -1 : 1;
  const arm = D('armchair');
  const place = (k: number) => {
    const a = cof.w / 2 + arm.w / 2 + 0.2,
      b = cof.d / 2 + 0.35;
    return [cx + tAxis[0] * k * a + nx * b, cz + tAxis[1] * k * a + nz * b];
  };
  const inside = ([x, z]: number[]) =>
    x - arm.w / 2 > r.x + HALF && x + arm.w / 2 < r.x + r.w - HALF && z - arm.d / 2 > r.z + HALF && z + arm.d / 2 < r.z + r.d - HALF;
  if (!inside(place(s)) && inside(place(-s)) && !score(s)) s = -s;
  let [ax, az] = place(s);
  // keep it in the room (pulled away from the wall it would touch)
  ax = clamp(ax, r.x + HALF + arm.w / 2 + 0.05, r.x + r.w - HALF - arm.w / 2 - 0.05);
  az = clamp(az, r.z + HALF + arm.d / 2 + 0.05, r.z + r.d - HALF - arm.d / 2 - 0.05);
  const aRot = Math.atan2(cx - ax, cz - az);
  out.push({ slot: 'armchair', room: r.id, x: ax, z: az, rot: aRot, maxW: inside(place(s)) ? 1.2 : 0.5, maxD: 1 });
  const lt = center - s * (sofa.w / 2 + 0.25);
  const [lx, lz] = facePoint(r, sofaSide.side, clamp(lt, sSpan[0] + 0.2, sSpan[1] - 0.2));
  out.push({ slot: 'floorlamp', room: r.id, x: lx + nx * 0.25, z: lz + nz * 0.25, rot: 0, maxW: 1, maxD: 1 });
  out.push({ slot: 'pendant', room: r.id, x: cx, z: cz, rot: 0, maxW: 9, maxD: 9 });
}

/** Walking space wanted in front of a wardrobe so its doors open and you can stand there. */
export const WARDROBE_PASSAGE = 0.6;

interface BedroomPlan {
  out: Placement[];
  /** free space between the wardrobe front and the bed, when the bed is in front of it */
  gap?: number;
  ward: 'none' | 'short' | 'fits';
}

/** One arrangement: the bed against `bedSide`, the wardrobe on `wSide`, the bed pushed away from a side wardrobe or centred. */
function arrangeBedroom(r: Room, bedSide: SideInfo, wSide: { s: SideInfo } | undefined, push: boolean, D: DimsFn): BedroomPlan {
  const bed = D('bed'),
    night = D('night'),
    ward = D('wardrobe');
  const need = bed.w + 2 * night.w + 0.04;
  const out: Placement[] = [];
  const bSpan = longest(bedSide.low)!;
  let bedT = (bSpan[0] + bSpan[1]) / 2;
  if (push && wSide && perpendicular(wSide.s.side, bedSide.side)) {
    // push the bed group away from the wardrobe wall
    const wardAtLow = (() => {
      const e = edgeOf(r, wSide.s.side);
      const b = edgeOf(r, bedSide.side);
      return Math.abs(e.c - b.a1) < Math.abs(e.c - b.a2);
    })();
    bedT = wardAtLow ? bSpan[1] - need / 2 : bSpan[0] + need / 2;
  }
  bedT = fitIn(bSpan, Math.min(need, len(bSpan)), bedT);
  const depth = roomDepth(r, bedSide.side);
  const bp = wallItem('bed', r, bedSide.side, bedT, bSpan, depth);
  out.push(bp, { ...bp, slot: 'mattress' }, { ...bp, slot: 'base' });
  const e = edgeOf(r, bedSide.side),
    along = e.axis === 'x';
  const nts = [-1, 1].map(k => {
    const t = bedT + k * (bed.w / 2 + 0.02 + night.w / 2);
    const [x, z] = facePoint(r, bedSide.side, t);
    return { x, z, rot: rotOf(bedSide.side) };
  });
  out.push({ slot: 'night', room: r.id, x: nts[0].x, z: nts[0].z, rot: nts[0].rot, maxW: len(bSpan) - bed.w, maxD: depth, extra: nts });
  out.push({ slot: 'lamps', room: r.id, x: nts[0].x, z: nts[0].z, rot: nts[0].rot, maxW: 9, maxD: 9, extra: nts });
  let gap: number | undefined,
    wardState: BedroomPlan['ward'] = 'none';
  if (wSide) {
    // keep the wardrobe clear of the bed (50 cm to walk past it) and of the bedside tables
    const [nx, nz] = inward(bedSide.side);
    const rectAt = (t: number, w: number, d: number) => {
      const [x, z] = facePoint(r, bedSide.side, t),
        x2 = x + nx * d,
        z2 = z + nz * d;
      return along
        ? { x1: t - w / 2, x2: t + w / 2, z1: Math.min(z, z2), z2: Math.max(z, z2) }
        : { x1: Math.min(x, x2), x2: Math.max(x, x2), z1: t - w / 2, z2: t + w / 2 };
    };
    const bedRect = rectAt(bedT, bed.w, bed.d);
    const blockers = [
      { ...bedRect, pad: 0 },
      ...nts.map((_, k) => ({ ...rectAt(bedT + (k ? 1 : -1) * (bed.w / 2 + 0.02 + night.w / 2), night.w, night.d), pad: 0.08 })),
    ];
    const we = edgeOf(r, wSide.s.side),
      [wnx, wnz] = inward(wSide.s.side);
    let spans = wSide.s.tall.slice();
    for (const b of blockers) {
      if (we.axis === 'x') {
        const fz = we.c + wnz * HALF,
          reach = ward.d + b.pad;
        if (wnz > 0 ? b.z1 < fz + reach : b.z2 > fz - reach) spans = subtract(spans, [b.x1 - 0.02, b.x2 + 0.02]);
      } else {
        const fx = we.c + wnx * HALF,
          reach = ward.d + b.pad;
        if (wnx > 0 ? b.x1 < fx + reach : b.x2 > fx - reach) spans = subtract(spans, [b.z1 - 0.02, b.z2 + 0.02]);
      }
    }
    const span = longest(spans);
    if (span) {
      wardState = len(span) >= ward.w ? 'fits' : 'short';
      const wt = fitIn(span, ward.w, (span[0] + span[1]) / 2),
        wp = wallItem('wardrobe', r, wSide.s.side, wt, span, roomDepth(r, wSide.s.side));
      // walkway between the wardrobe front and the bed, when they face each other
      const [fx, fz] = facePoint(r, wSide.s.side, wt),
        front = we.axis === 'x' ? fz + wnz * ward.d : fx + wnx * ward.d;
      const lo = wt - ward.w / 2,
        hi = wt + ward.w / 2;
      const overl = we.axis === 'x' ? bedRect.x1 < hi && bedRect.x2 > lo : bedRect.z1 < hi && bedRect.z2 > lo;
      if (overl)
        wp.gap = gap =
          we.axis === 'x' ? (wnz > 0 ? bedRect.z1 - front : front - bedRect.z2) : wnx > 0 ? bedRect.x1 - front : front - bedRect.x2;
      out.push(wp);
    }
  }
  out.push({ slot: 'pendant', room: r.id, x: r.x + r.w / 2, z: r.z + r.d / 2, rot: 0, maxW: 9, maxD: 9 });
  return { out, gap, ward: wardState };
}

function bedroom(_p: Project, r: Room, si: SideInfo[], D: DimsFn, out: Placement[]) {
  const bed = D('bed'),
    night = D('night');
  const need = bed.w + 2 * night.w + 0.04;
  const cands = si.filter(s => s.wall && s.low.length);
  if (!cands.length) return;
  const score = (s: SideInfo) => len(longest(s.low)!) + (s.windows ? 0 : 0.6) + (len(longest(s.low)!) >= need ? 1 : 0);
  const wardSides = (bedSide: SideInfo) =>
    si
      .filter(s => s !== bedSide && s.wall && s.tall.length)
      .map(s => ({ s, span: longest(s.tall)! }))
      .sort(
        (a, b) =>
          len(b.span) + (b.s.side === opposite(bedSide.side) ? -0.4 : 0) - (len(a.span) + (a.s.side === opposite(bedSide.side) ? -0.4 : 0)),
      );
  // the usual arrangement: the best wall for the bed, the wardrobe on the longest other wall
  const bedSide = cands.slice().sort((a, b) => score(b) - score(a))[0];
  const first = arrangeBedroom(r, bedSide, wardSides(bedSide)[0], true, D);
  const tight = (pl: BedroomPlan) => (pl.gap === undefined ? 0 : Math.max(0, WARDROBE_PASSAGE - pl.gap));
  if (first.ward === 'fits' && !tight(first)) {
    out.push(...first.out);
    return;
  }
  // too tight in front of the wardrobe (or no room for it): try every bed wall, wardrobe wall and bed position
  const value = (pl: BedroomPlan, bs: SideInfo) =>
    (pl.ward === 'fits' ? 3 : pl.ward === 'short' ? 1.5 : 0) - tight(pl) * 10 + 0.3 * score(bs) + (bs === bedSide ? 0.2 : 0);
  let best = first,
    bestV = value(first, bedSide);
  for (const bs of cands) {
    // only walls where the bed and both bedside tables fit: never trade a tight wardrobe for a bed that does not fit
    if (bs !== bedSide && len(longest(bs.low)!) < need) continue;
    for (const ws of wardSides(bs))
      for (const push of [true, false]) {
        const pl = arrangeBedroom(r, bs, ws, push, D),
          v = value(pl, bs);
        if (v > bestV + 1e-6) {
          best = pl;
          bestV = v;
        }
      }
  }
  out.push(...best.out);
}

function kitchen(_p: Project, r: Room, si: SideInfo[], D: DimsFn, out: Placement[]) {
  const cands = si.filter(s => s.wall && s.low.length);
  if (!cands.length) return;
  const score = (s: SideInfo) => len(longest(s.tall.length ? s.tall : s.low)!) + (s.windows ? -0.3 : 0);
  const side = cands.slice().sort((a, b) => score(b) - score(a))[0];
  const span = longest(side.tall.length && len(longest(side.tall)!) > 1.2 ? side.tall : side.low)!;
  const fr = D('fridge'),
    k = D('kitchen');
  const runW = Math.min(len(span), fr.w + 0.01 + k.w);
  const start = span[0] + (len(span) - runW) / 2;
  out.push({
    ...wallItem('kitchen', r, side.side, start + runW / 2, span, roomDepth(r, side.side)),
    extra: [{ ...pt(facePoint(r, side.side, start)), rot: rotOf(side.side), w: runW }],
  });
  for (const s of ['worktop', 'sink', 'faucet', 'hob', 'oven', 'hood', 'fridge'] as SlotId[]) out.push({ ...out[out.length - 1], slot: s });
}
const pt = ([x, z]: [number, number]) => ({ x, z });

function diningTable(p: Project, r: Room, out: Placement[], D: DimsFn) {
  let x = r.x + r.w / 2,
    z = r.z + r.d / 2;
  const entry = p.openings.find(o => o.room === r.id && o.kind === 'entry');
  if (entry) {
    const s = openingSpan(entry, p.rooms)!,
      [nx, nz] = inward(entry.side),
      mid = (s.a + s.b) / 2;
    x += nx * 0.3;
    z += nz * 0.3;
    if (s.axis === 'x') x += Math.sign(x - mid) * 0.4;
    else z += Math.sign(z - mid) * 0.4;
  }
  const t = D('table');
  const rot = r.w >= r.d ? 0 : Math.PI / 2;
  out.push({ slot: 'table', room: r.id, x, z, rot, maxW: Math.max(r.w, r.d) - 1.3, maxD: Math.min(r.w, r.d) - 1.3 });
  out.push({ ...out[out.length - 1], slot: 'chairs' });
  out.push({ slot: 'pendant', room: r.id, x, z, rot: 0, maxW: 9, maxD: 9 });
  void t;
}

function hall(p: Project, r: Room, si: SideInfo[], D: DimsFn, out: Placement[]) {
  const entry = p.openings.find(o => o.kind === 'entry' && o.room === r.id);
  const h = D('hall');
  let best: { side: Side; t: number; span: Span } | null = null;
  if (entry) {
    const s = openingSpan(entry, p.rooms)!;
    for (const info of si) {
      if (!info.wall || !perpendicular(info.side, entry.side)) continue;
      const e = info.edge;
      // the end of this wall that touches the entry wall
      const nearEnd = Math.abs(e.a1 - s.c) < Math.abs(e.a2 - s.c) ? 'a1' : 'a2';
      const distToDoor = Math.min(Math.abs(e.c - s.a), Math.abs(e.c - s.b));
      for (const span of info.tall) {
        const t = nearEnd === 'a1' ? span[0] + 0.45 + h.w / 2 : span[1] - 0.45 - h.w / 2;
        if (t - h.w / 2 < span[0] - 1e-3 || t + h.w / 2 > span[1] + 1e-3) continue;
        if (!best || distToDoor < Math.abs((best as any).dist ?? 99)) {
          best = { side: info.side, t, span };
          (best as any).dist = distToDoor;
        }
      }
    }
  }
  if (!best) {
    const info = si.filter(s => s.wall && s.tall.length).sort((a, b) => len(longest(b.tall)!) - len(longest(a.tall)!))[0];
    if (!info) return;
    const span = longest(info.tall)!;
    best = { side: info.side, t: fitIn(span, h.w, span[0] + h.w / 2), span };
  }
  const pl = wallItem('hall', r, best.side, best.t, best.span, roomDepth(r, best.side));
  out.push(pl, { ...pl, slot: 'hooks' });
}

function bathroom(p: Project, r: Room, si: SideInfo[], D: DimsFn, out: Placement[], fixtures: Fixture[]) {
  const door = p.openings.find(o => o.kind === 'door' && (o.room === r.id || sameLine(o, r, p)));
  const walls = si.filter(s => s.wall && s.low.length);
  if (!walls.length) return;
  const doorSide = door ? sideOfOpening(door, r, p) : null;
  // shower in the far corner, toilet on the wall facing the door, washer on the longest remaining stretch
  const far = walls.find(s => doorSide && s.side === opposite(doorSide)) || walls[0];
  const fs = longest(far.low)!;
  const wash = D('washer');
  const rest = walls.filter(s => s !== far).sort((a, b) => len(longest(b.low)!) - len(longest(a.low)!));
  fixtures.push({ kind: 'wc', room: r.id, ...pt(facePoint(r, far.side, (fs[0] + fs[1]) / 2)), rot: rotOf(far.side) });
  if (rest[0]) {
    const sp = longest(rest[0].low)!;
    fixtures.push({ kind: 'shower', room: r.id, ...pt(facePoint(r, rest[0].side, sp[1] - 0.45)), rot: rotOf(rest[0].side) });
    fixtures.push({
      kind: 'vanity',
      room: r.id,
      ...pt(facePoint(r, rest[0].side, Math.min(sp[1] - 1.25, Math.max(sp[0] + 1.0, (sp[0] + sp[1]) / 2 - 0.2)))),
      rot: rotOf(rest[0].side),
    });
  }
  const ws = rest[1] || rest[0] || far,
    wsp = longest(ws.low)!;
  out.push(wallItem('washer', r, ws.side, fitIn(wsp, wash.w, (wsp[0] + wsp[1]) / 2), wsp, roomDepth(r, ws.side)));
}
function sameLine(o: { room: string; side: Side; at: number; width: number }, r: Room, p: Project) {
  const s = openingSpan(o as any, p.rooms);
  if (!s) return false;
  return SIDES.some(side => {
    const e = edgeOf(r, side);
    return e.axis === s.axis && Math.abs(e.c - s.c) < 1e-3 && s.a >= e.a1 - 1e-3 && s.b <= e.a2 + 1e-3;
  });
}
function sideOfOpening(o: any, r: Room, p: Project): Side | null {
  const s = openingSpan(o, p.rooms);
  if (!s) return null;
  return (
    SIDES.find(side => {
      const e = edgeOf(r, side);
      return e.axis === s.axis && Math.abs(e.c - s.c) < 1e-3;
    }) || null
  );
}

export interface Fixture {
  kind: 'wc' | 'shower' | 'vanity';
  room: string;
  x: number;
  z: number;
  rot: number;
}
export interface Layout {
  placements: Placement[];
  fixtures: Fixture[];
  curtains: { x: number; z: number; rot: number; w: number; room: string }[];
}

export function autoLayout(p: Project, D: DimsFn): Layout {
  const walls = deriveWalls(p),
    out: Placement[] = [],
    fixtures: Fixture[] = [];
  const hasDining = p.rooms.some(r => r.type === 'dining');
  for (const r of p.rooms) {
    const si = sideInfo(p, r, walls);
    if (r.type === 'living') living(p, r, si, D, out);
    else if (r.type === 'bedroom') bedroom(p, r, si, D, out);
    else if (r.type === 'kitchen') {
      kitchen(p, r, si, D, out);
      if (!hasDining && r.w * r.d >= 7) diningTable(p, r, out, D);
    } else if (r.type === 'dining') diningTable(p, r, out, D);
    else if (r.type === 'bathroom') bathroom(p, r, si, D, out, fixtures);
    else if (r.type === 'terrace')
      out.push({ slot: 'terrace', room: r.id, x: r.x + r.w / 2, z: r.z + r.d / 2, rot: 0, maxW: r.w - 0.3, maxD: r.d - 0.3 });
  }
  // hall furniture: a hall if there is one, otherwise the room with the entrance door
  const entry = p.openings.find(o => o.kind === 'entry');
  const hallRoom = p.rooms.find(r => r.type === 'hall') || (entry && p.rooms.find(r => r.id === entry.room));
  if (hallRoom) hall(p, hallRoom, sideInfo(p, hallRoom, walls), D, out);
  // one pendant per room: keep the first
  const seen = new Set<string>();
  const placements = out.filter(pl => {
    if (pl.slot !== 'pendant') return true;
    if (seen.has(pl.room)) return false;
    seen.add(pl.room);
    return true;
  });
  const curtains = p.openings
    .filter(o => o.kind === 'window' && ['living', 'bedroom', 'dining'].includes(p.rooms.find(r => r.id === o.room)?.type || ''))
    .map(o => {
      const r = p.rooms.find(x => x.id === o.room)!,
        s = openingSpan(o, p.rooms)!;
      const [x, z] = facePoint(r, o.side, (s.a + s.b) / 2);
      const [nx, nz] = inward(o.side);
      return { x: x + nx * 0.08, z: z + nz * 0.08, rot: rotOf(o.side), w: o.width, room: r.id };
    });
  return { placements, fixtures, curtains };
}

/** Camera views: an overview plus one view per room from the corner nearest its door. */
export function autoViews(p: Project): View[] {
  const b = {
    x1: Math.min(...p.rooms.map(r => r.x)),
    z1: Math.min(...p.rooms.map(r => r.z)),
    x2: Math.max(...p.rooms.map(r => r.x + r.w)),
    z2: Math.max(...p.rooms.map(r => r.z + r.d)),
  };
  const cx = (b.x1 + b.x2) / 2,
    cz = (b.z1 + b.z2) / 2,
    span = Math.max(b.x2 - b.x1, b.z2 - b.z1);
  const views: View[] = [
    { id: 'overview', label: 'overview', pos: [cx, span * 0.82, b.z2 + span * 0.62], target: [cx, 0, cz + span * 0.02], interior: false },
  ];
  for (const r of p.rooms) {
    if (r.type === 'terrace') {
      views.push({
        id: r.id,
        label: r.id,
        room: r.id,
        interior: false,
        pos: [r.x + r.w / 2 - 0.6, 3.2, r.z - 2.3],
        target: [r.x + r.w / 2, 0.4, r.z + r.d * 0.7],
      });
      continue;
    }
    const door =
      p.openings.find(o => (o.kind === 'door' || o.kind === 'entry') && o.room === r.id) ||
      p.openings.find(o => o.kind === 'door' && sameLine(o, r, p));
    const corners: [number, number][] = [
      [r.x, r.z],
      [r.x + r.w, r.z],
      [r.x, r.z + r.d],
      [r.x + r.w, r.z + r.d],
    ];
    let pick = corners[3];
    if (door) {
      // stand on the door's wall, but away from the door leaf that swings into the room
      const s = openingSpan(door, p.rooms)!;
      const dp: [number, number] = s.axis === 'x' ? [(s.a + s.b) / 2, s.c] : [s.c, (s.a + s.b) / 2];
      const dist = (c: [number, number]) => Math.hypot(c[0] - dp[0], c[1] - dp[1]);
      const onWall = (c: [number, number]) => Math.abs((s.axis === 'x' ? c[1] : c[0]) - s.c) < 1e-3;
      const clear = corners.filter(c => dist(c) >= 1.0);
      pick =
        clear.filter(onWall).sort((a, b) => dist(a) - dist(b))[0] ||
        clear.sort((a, b) => dist(a) - dist(b))[0] ||
        corners.slice().sort((a, b) => dist(a) - dist(b))[0];
    } else {
      // open-plan room: look from the open side toward the windows
      const win = p.openings.find(o => o.room === r.id && (o.kind === 'window' || o.kind === 'balcony'));
      if (win) {
        const s = openingSpan(win, p.rooms)!;
        const wp: [number, number] = s.axis === 'x' ? [(s.a + s.b) / 2, s.c] : [s.c, (s.a + s.b) / 2];
        pick = corners.slice().sort((a, b) => Math.hypot(b[0] - wp[0], b[1] - wp[1]) - Math.hypot(a[0] - wp[0], a[1] - wp[1]))[0];
      }
    }
    // a small open-plan room (kitchen niche): look at it from the room it opens into
    if (!door && Math.min(r.w, r.d) < 2.0) {
      const openSide = sideInfo(p, r).find(x => !x.wall);
      if (openSide) {
        const [nx, nz] = inward(openSide.side),
          cx2 = r.x + r.w / 2,
          cz2 = r.z + r.d / 2,
          back = 2.4 + Math.min(r.w, r.d) / 2;
        views.push({
          id: r.id,
          label: r.id,
          room: r.id,
          interior: true,
          pos: [cx2 - nx * back, 1.6, cz2 - nz * back],
          target: [cx2, 1.0, cz2],
        });
        continue;
      }
    }
    // small rooms (bathrooms): look in from the doorway
    if (door && Math.min(r.w, r.d) < 2.0) {
      const sd = sideOfOpening(door, r, p),
        s2 = openingSpan(door, p.rooms)!;
      if (sd) {
        const [nx, nz] = inward(sd),
          mid = (s2.a + s2.b) / 2;
        const dp: [number, number] = s2.axis === 'x' ? [mid, s2.c] : [s2.c, mid];
        views.push({
          id: r.id,
          label: r.id,
          room: r.id,
          interior: true,
          pos: [dp[0] - nx * 0.55, 1.6, dp[1] - nz * 0.55],
          target: [r.x + r.w / 2 + nx * 0.6, 0.9, r.z + r.d / 2 + nz * 0.6],
        });
        continue;
      }
    }
    // an open-plan dining area is best seen looking toward its kitchen
    const kit = p.rooms.find(
      k => k.type === 'kitchen' && p.open.some(([a, b]) => (a === r.id && b === k.id) || (b === r.id && a === k.id)),
    );
    if (kit && r.type !== 'kitchen') {
      const kc: [number, number] = [kit.x + kit.w / 2, kit.z + kit.d / 2],
        rc = [r.x + r.w / 2, r.z + r.d / 2];
      const dx = rc[0] - kc[0],
        dz = rc[1] - kc[1],
        L = Math.hypot(dx, dz) || 1,
        dist = Math.max(2.6, Math.min(4, Math.max(r.w, r.d)));
      views.push({
        id: r.id,
        label: r.id,
        room: r.id,
        interior: true,
        pos: [kc[0] + (dx / L) * dist, 1.6, kc[1] + (dz / L) * dist],
        target: [kc[0], 1.0, kc[1]],
      });
      continue;
    }
    const ix = pick[0] === r.x ? 1 : -1,
      iz = pick[1] === r.z ? 1 : -1;
    const small = Math.min(r.w, r.d) < 1.2;
    const inset = small ? 0.2 : 0.35;
    const pos: [number, number, number] = [pick[0] + ix * inset, small ? 1.7 : 1.65, pick[1] + iz * inset];
    const tgt: [number, number, number] = [pick[0] + ix * r.w * 0.9, 0.85, pick[1] + iz * r.d * 0.9];
    if (small) {
      pos[0] = r.x + r.w / 2;
      pos[2] = r.z - iz * 1.6 + (iz < 0 ? r.d : 0);
    }
    views.push({ id: r.id, label: r.id, room: r.id, interior: true, pos, target: tgt });
  }
  return views;
}

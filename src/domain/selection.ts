import LZString from 'lz-string';
import type { Catalog, Product, Project, SlotId } from '../types';
import { activeSlots, curtainWindows, roomsOfType, slotDef } from './slots';
import { autoLayout, type Dims, type Layout } from './layout';
import { applyMoves, moveIssues } from './moves';

export type Selection = Partial<Record<SlotId, string>>;
export type Style = 'cheap' | 'light' | 'warm' | 'dark' | 'color';

export interface Index {
  cat: Catalog;
  byId: Map<string, Product>;
  bySlot: Map<SlotId, Product[]>;
}
export function indexCatalog(cat: Catalog): Index {
  const byId = new Map<string, Product>(),
    bySlot = new Map<SlotId, Product[]>();
  for (const p of cat.products) {
    if (p.unavailable) continue;
    byId.set(p.id, p);
    (bySlot.get(p.slot) || bySlot.set(p.slot, []).get(p.slot)!).push(p);
  }
  return { cat, byId, bySlot };
}

const DEFAULT_CM: Partial<Record<SlotId, [number, number, number]>> = {
  kitchen: [180, 60, 85],
  fridge: [55, 60, 175],
  table: [120, 80, 75],
  chairs: [45, 50, 85],
  sofa: [200, 90, 85],
  armchair: [75, 80, 80],
  coffee: [100, 55, 45],
  tvunit: [150, 40, 50],
  tv: [97, 6, 56],
  rug: [230, 160, 1],
  floorlamp: [35, 35, 150],
  bed: [168, 208, 100],
  mattress: [160, 200, 20],
  base: [160, 200, 8],
  wardrobe: [120, 55, 200],
  night: [40, 40, 50],
  lamps: [20, 20, 40],
  washer: [60, 57, 85],
  hall: [60, 30, 100],
  hooks: [50, 8, 15],
  terrace: [120, 120, 75],
  curtains: [140, 2, 250],
  rods: [210, 3, 3],
  pendant: [40, 40, 30],
  sink: [56, 46, 20],
  faucet: [20, 20, 35],
  hob: [58, 50, 5],
  oven: [60, 56, 60],
  hood: [60, 50, 15],
  worktop: [100, 60, 4],
};
export function dimsOf(p: Product | undefined, slot: SlotId): Dims {
  const def = DEFAULT_CM[slot] || [50, 50, 50];
  const w = p?.w ?? def[0],
    d = p?.d ?? (p?.round ? w : def[1]),
    h = p?.h ?? def[2];
  return { w: w / 100, d: d / 100, h: h / 100 };
}

/** Promotions expire: after `until` the regular price applies again. */
export function effectivePrice(p: Product, today: string) {
  const expired = !!p.until && p.until < today;
  return { price: expired && p.regular ? p.regular : p.price, expired, promo: !!p.until && !expired };
}

const get = (ix: Index, sel: Selection, s: SlotId) => {
  const id = sel[s];
  return id ? ix.byId.get(id) : undefined;
};

/** How many packs of the chosen product this apartment needs. */
export function unitsNeeded(slot: SlotId, p: Product | undefined, proj: Project, sel: Selection, ix: Index): number {
  if (!p) return 0;
  const pack = p.pack || 1;
  const beds = roomsOfType(proj, 'bedroom').length;
  const per = (n: number) => Math.ceil(n / pack);
  switch (slot) {
    case 'chairs': {
      const t = get(ix, sel, 'table');
      return t?.includesChairs ? 0 : per(4);
    }
    case 'worktop': {
      const k = get(ix, sel, 'kitchen');
      if (!k?.needsWorktop) return 0;
      return Math.max(1, Math.ceil(((k.w || 180) - 1) / (p.w || 100)));
    }
    case 'base': {
      const b = get(ix, sel, 'bed');
      if (!b?.needsBase) return 0;
      const mw = get(ix, sel, 'mattress')?.w || 160;
      return beds * ((p.w || mw) >= mw - 5 ? 1 : Math.ceil(mw / (p.w || mw)));
    }
    case 'faucet': {
      const s = get(ix, sel, 'sink');
      return s?.includesFaucet ? 0 : 1;
    }
    case 'night':
    case 'lamps':
      return per(2 * beds);
    case 'bed':
    case 'mattress':
    case 'wardrobe':
      return beds;
    case 'curtains':
      return per(2 * curtainWindows(proj).length);
    case 'rods':
      return curtainWindows(proj).length;
    case 'pendant':
      return proj.rooms.filter(
        r => ['living', 'bedroom', 'dining'].includes(r.type) || (r.type === 'kitchen' && !proj.rooms.some(x => x.type === 'dining')),
      ).length;
    case 'sofa':
    case 'coffee':
    case 'tvunit':
    case 'tv':
    case 'rug':
    case 'armchair':
    case 'floorlamp':
      return roomsOfType(proj, 'living').length;
    case 'terrace':
      return Math.min(1, roomsOfType(proj, 'terrace').length);
    case 'washer':
      return 1;
    default:
      return per(1);
  }
}

export interface Line {
  slot: SlotId;
  product?: Product;
  units: number;
  unitPrice: number;
  total: number;
  expired: boolean;
  promo: boolean;
}
export function lines(proj: Project, sel: Selection, ix: Index, today: string): Line[] {
  return activeSlots(proj).map(sd => {
    const p = get(ix, sel, sd.id),
      units = unitsNeeded(sd.id, p, proj, sel, ix);
    const e = p ? effectivePrice(p, today) : { price: 0, expired: false, promo: false };
    return { slot: sd.id, product: p, units, unitPrice: e.price, total: e.price * units, expired: e.expired, promo: e.promo && units > 0 };
  });
}
export const total = (ls: Line[]) => ls.reduce((s, l) => s + l.total, 0);

const cheapest = (ps: Product[] | undefined, pref?: (p: Product) => boolean) => {
  const list = (ps || []).slice().sort((a, b) => a.price - b.price);
  return (pref && list.find(pref)) || list[0];
};

/**
 * Whether a saved selection belongs to this catalogue: at least half of its products are in it.
 * A few may have been delisted since; a selection made of another country's products is not ours.
 */
export function ownProducts(sel: Selection, ix: Index): boolean {
  const ids = Object.values(sel).filter((v): v is string => typeof v === 'string');
  return ids.length > 0 && ids.filter(id => ix.byId.has(id)).length * 2 >= ids.length;
}

/** Worktop, slatted base, chairs and curtain rods follow the main piece they belong to. */
export function fixDeps(sel: Selection, ix: Index): Selection {
  const s = { ...sel };
  const k = get(ix, s, 'kitchen');
  if (k && !k.needsWorktop) delete s.worktop;
  else if (k && !s.worktop) s.worktop = cheapest(ix.bySlot.get('worktop'), w => family(w.hex) === family(k.hex2 || k.hex))?.id;
  const b = get(ix, s, 'bed');
  if (b && !b.needsBase) delete s.base;
  else if (b && !s.base) s.base = cheapest(ix.bySlot.get('base'))?.id;
  const t = get(ix, s, 'table');
  if (t?.includesChairs) delete s.chairs;
  else if (t && !s.chairs) s.chairs = cheapest(ix.bySlot.get('chairs'))?.id;
  if (s.curtains && !s.rods) s.rods = cheapest(ix.bySlot.get('rods'))?.id;
  if (!s.curtains) delete s.rods;
  return s;
}

// ---- colour families from hex, so they work for every language ----
export function family(hex?: string): 'light' | 'warm' | 'dark' | 'color' | '' {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return '';
  const n = parseInt(hex.replace('#', ''), 16),
    r = (n >> 16) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    l = (mx + mn) / 2,
    d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (l < 0.33) return 'dark';
  if (l > 0.86) return 'light';
  if (s > 0.2 && h >= 80 && h <= 330) return 'color';
  if (s > 0.12 && h >= 10 && h < 70) return 'warm';
  return l > 0.55 ? 'light' : 'dark';
}

// ---- fit checks ----
export interface Issue {
  slot: SlotId;
  hard: boolean;
  code: string;
  v: Record<string, number | string>;
}
const cm = (m: number) => Math.round(m * 100);

export function fitIssues(proj: Project, sel: Selection, ix: Index, layout?: Layout): Issue[] {
  const D = (s: SlotId) => dimsOf(get(ix, sel, s), s);
  const L = layout || applyMoves(autoLayout(proj, D), proj.moves);
  const out: Issue[] = [];
  const pl = (s: SlotId) => L.placements.find(p => p.slot === s);
  const over = (slot: SlotId, need: number, have: number, code: string, extra: Record<string, number | string> = {}) => {
    if (need <= have + 0.005) return;
    const o = need - have;
    out.push({ slot, hard: o > 0.1, code, v: { need: cm(need), have: cm(have), over: cm(o), ...extra } });
  };
  const has = (s: SlotId) => !!get(ix, sel, s);
  if (has('kitchen') && pl('kitchen'))
    over('kitchen', D('kitchen').w + (has('fridge') ? D('fridge').w + 0.01 : 0), pl('kitchen')!.maxW, 'kitchenRun');
  if (has('sofa') && pl('sofa')) over('sofa', D('sofa').w, pl('sofa')!.maxW, 'wall');
  if (has('tvunit') && pl('tvunit')) over('tvunit', D('tvunit').w, pl('tvunit')!.maxW, 'wall');
  if (has('wardrobe')) {
    const w = pl('wardrobe');
    if (!w) out.push({ slot: 'wardrobe', hard: true, code: 'noWall', v: {} });
    else {
      over('wardrobe', D('wardrobe').w, w.maxW, 'wall');
      if (w.gap !== undefined && w.gap < 0.6)
        out.push({ slot: 'wardrobe', hard: w.gap < 0.3, code: 'passage', v: { have: cm(Math.max(0, w.gap)) } });
    }
  }
  if (has('bed') && pl('bed')) {
    const b = pl('bed')!,
      group = D('bed').w + (has('night') ? 2 * D('night').w + 0.04 : 0);
    over('bed', group, b.maxW, 'bedGroup');
    over('bed', D('bed').d + 0.5, b.maxD, 'bedFoot');
  }
  if (has('sofa') && pl('sofa')) {
    const s = pl('sofa')!;
    over(
      'coffee',
      D('sofa').d + 0.3 + (has('coffee') ? D('coffee').d : 0) + 0.3 + (has('tvunit') ? D('tvunit').d : 0),
      s.maxD,
      'livingDepth',
    );
  }
  if (has('hall') && pl('hall')) over('hall', D('hall').w, pl('hall')!.maxW, 'wall');
  if (has('washer') && pl('washer')) over('washer', D('washer').w, pl('washer')!.maxW, 'wall');
  if (has('table') && pl('table')) {
    const t = pl('table')!;
    over('table', D('table').w, t.maxW, 'tableZone');
  }
  if (has('terrace') && pl('terrace')) {
    const t = pl('terrace')!;
    over('terrace', Math.min(D('terrace').w, D('terrace').d), Math.min(t.maxW, t.maxD), 'terrace');
  }
  const k = get(ix, sel, 'kitchen');
  if (k?.needsWorktop && !has('worktop')) out.push({ slot: 'worktop', hard: true, code: 'needsWorktop', v: {} });
  const b = get(ix, sel, 'bed');
  if (b?.needsBase && !has('base')) out.push({ slot: 'base', hard: true, code: 'needsBase', v: {} });
  const t = get(ix, sel, 'table');
  if (t && !t.includesChairs && !has('chairs')) out.push({ slot: 'chairs', hard: true, code: 'needsChairs', v: {} });
  for (const mi of moveIssues(proj, L, D, has))
    out.push({ slot: mi.slot, hard: true, code: mi.code, v: { other: mi.other || '', over: mi.over || 0 } });
  const m = get(ix, sel, 'mattress');
  if (b && m && b.w && m.w && Math.abs(b.w - (b.w > m.w + 12 ? 10 : 0) - m.w) > 12)
    out.push({ slot: 'mattress', hard: false, code: 'mattressSize', v: { bed: b.w, mattress: m.w } });
  return out;
}

// ---- automatic proposals ----
export function generate(style: Style, proj: Project, ix: Index, today: string): Selection {
  let sel: Selection = {};
  const want = style === 'cheap' ? null : style;
  const hardKeys = (sl: Selection) =>
    new Set(
      fitIssues(proj, sl, ix)
        .filter(i => i.hard && !/needs/.test(i.code))
        .map(i => i.slot + ':' + i.code),
    );
  for (const sd of activeSlots(proj)) {
    if (sd.dependent) continue;
    const before = hardKeys(sel);
    const cands = (ix.bySlot.get(sd.id) || []).filter(p => p.price > 0);
    if (!cands.length) continue;
    if (sd.optional && style === 'cheap') continue;
    let best: Product | null = null,
      bs = Infinity;
    for (const p of cands) {
      const trial = fixDeps({ ...sel, [sd.id]: p.id }, ix);
      const ls = lines(proj, trial, ix, today);
      let sc = total(ls.filter(l => l.slot === sd.id || slotDef(l.slot).dependent));
      if (want) {
        const f = family(p.hex);
        if (f !== want) sc *= f === '' ? 1.25 : (f === 'warm' && want === 'light') || (f === 'light' && want === 'warm') ? 1.2 : 1.6;
      }
      // a candidate is out if it causes a misfit that was not there before (the fridge can break the kitchen run)
      const hard = [...hardKeys(trial)].some(k => !before.has(k) || k.startsWith(sd.id + ':'));
      if (hard) sc += 1e9;
      if (sc < bs) {
        bs = sc;
        best = p;
      }
    }
    if (best) sel = fixDeps({ ...sel, [sd.id]: best.id }, ix);
  }
  return sel;
}

// ---- share links ----
export function encodeSelection(sel: Selection): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(sel));
}
export function decodeSelection(s: string, ix: Index): Selection {
  try {
    const raw = JSON.parse(LZString.decompressFromEncodedURIComponent(s) || '{}');
    const out: Selection = {};
    for (const [k, v] of Object.entries(raw)) {
      const p = typeof v === 'string' ? ix.byId.get(v) : undefined;
      if (p && p.slot === k) out[k as SlotId] = v as string;
    }
    return out;
  } catch {
    return {};
  }
}

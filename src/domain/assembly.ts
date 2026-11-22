import type { Assembly } from '../data/assembly';
import type { SlotId } from '../types';
import type { Line } from './selection';

/** Flat-pack pieces someone has to put together, and appliances someone has to connect. */
const ASSEMBLE: SlotId[] = ['wardrobe', 'bed', 'base', 'table', 'chairs', 'tvunit', 'night', 'hall', 'coffee', 'sofa', 'armchair'];
// a stove connection is priced per stove: the oven stands for it, the hob is not counted twice
const CONNECT: Partial<Record<SlotId, 'washer' | 'oven'>> = { washer: 'washer', oven: 'oven' };

export interface StoreAssembly {
  store: string;
  /** flat-pack pieces from this store (units: four chairs are four pieces) */
  pieces: number;
  kitchen: boolean;
  appliances: number;
  /** the least it costs where the store publishes prices */
  cost: number;
  /** more is added per piece, in the basket or when booking */
  from: boolean;
  unknown: boolean;
  url?: string;
  note?: string;
}

/** What one store charges to assemble and connect its part of the list (see data/assembly.ts for the sources). */
export function storeAssembly(a: Assembly | undefined, pieces: number, kitchen: boolean, devices: ('washer' | 'oven')[]) {
  if (!a || a.unknown) return { cost: 0, from: false, unknown: true, url: a?.url, note: a?.note };
  let cost = 0,
    from = false;
  if (pieces > 0 && (a.visit !== undefined || a.minimum !== undefined)) {
    cost += Math.max(a.visit ?? 0, a.minimum ?? 0);
    from ||= !!a.perPiece || a.minimum !== undefined;
  }
  if (kitchen && a.kitchenFrom !== undefined) {
    cost += a.kitchenFrom;
    from = true;
  }
  let priced = cost > 0;
  for (const d of devices)
    if (a.connect?.[d] !== undefined) {
      cost += a.connect[d]!;
      priced = true;
    }
  // pieces or a kitchen the store has no published price for: the amount is not known
  const unpriced = (pieces > 0 && a.visit === undefined && a.minimum === undefined) || (kitchen && a.kitchenFrom === undefined);
  return { cost, from: from || (unpriced && priced), unknown: !priced, url: a.url, note: a.note };
}

/** Assembly for a whole shopping list, store by store; estimates and the user's own finds have none. */
export function assemblyFor(ls: Line[], table: Record<string, Assembly> | undefined) {
  const by = new Map<string, { pieces: number; kitchen: boolean; devices: ('washer' | 'oven')[] }>();
  for (const l of ls) {
    if (!l.product || !l.units || l.product.store === 'est' || l.product.store === 'own') continue;
    const dev = CONNECT[l.slot];
    const isPiece = ASSEMBLE.includes(l.slot),
      isKitchen = l.slot === 'kitchen';
    if (!dev && !isPiece && !isKitchen) continue;
    const s = by.get(l.product.store) || { pieces: 0, kitchen: false, devices: [] };
    if (isPiece) s.pieces += l.units;
    if (isKitchen) s.kitchen = true;
    if (dev) s.devices.push(dev);
    by.set(l.product.store, s);
  }
  const stores: StoreAssembly[] = [...by].map(([store, s]) => ({
    store,
    pieces: s.pieces,
    kitchen: s.kitchen,
    appliances: s.devices.length,
    ...storeAssembly(table?.[store], s.pieces, s.kitchen, s.devices),
  }));
  return {
    stores,
    total: stores.reduce((a, s) => a + s.cost, 0),
    from: stores.some(s => s.from),
    unknown: stores.filter(s => s.unknown),
  };
}

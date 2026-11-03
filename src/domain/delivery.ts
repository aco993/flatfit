import type { Delivery } from '../data/delivery';
import type { Line } from './selection';

export interface StoreDelivery { store: string; goods: number; cost: number; from: boolean; unknown: boolean; free: boolean; url?: string }

/** What one store charges to bring this order home (see data/delivery.ts for the sources). */
export function storeDelivery(d: Delivery | undefined, goods: number, items: number): Omit<StoreDelivery, 'store' | 'goods'> {
  if (!d || d.unknown) return { cost: 0, from: false, unknown: true, free: false, url: d?.url };
  if (d.freeFrom !== undefined && goods >= d.freeFrom) return { cost: 0, from: false, unknown: false, free: true, url: d.url };
  let cost = d.fee ?? 0;
  if (d.tiers) cost = (d.tiers.find(([upTo]) => goods <= upTo) || d.tiers[d.tiers.length - 1])[1];
  if (d.perExtra && items > 1) cost += d.perExtra * (items - 1);
  return { cost, from: !!d.from, unknown: false, free: false, url: d.url };
}

/** Delivery for a whole shopping list, store by store. Estimates (no real store) have none. */
export function deliveryFor(ls: Line[], table: Record<string, Delivery> | undefined) {
  const byStore = new Map<string, { goods: number; items: number }>();
  for (const l of ls) {
    if (!l.product || !l.units || l.product.store === 'est') continue;
    const s = byStore.get(l.product.store) || { goods: 0, items: 0 };
    s.goods += l.total; s.items += l.units; byStore.set(l.product.store, s);
  }
  const stores: StoreDelivery[] = [...byStore].map(([store, s]) => ({ store, goods: s.goods, ...storeDelivery(table?.[store], s.goods, s.items) }));
  return { stores, total: stores.reduce((a, s) => a + s.cost, 0), from: stores.some(s => s.from), unknown: stores.filter(s => s.unknown) };
}

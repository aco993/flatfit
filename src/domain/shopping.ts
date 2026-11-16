import type { Product, SlotId } from '../types';
import type { Line } from './selection';

/**
 * The shopping list as it is used in the shops: grouped by store, with what is already bought ticked off and what
 * is left to pay. A tick belongs to a slot *and* a product, so choosing another sofa unticks the sofa.
 */
export const tickKey = (slot: SlotId, product: Product) => `${slot}:${product.id}`;

export interface ShopItem {
  slot: SlotId;
  product: Product;
  units: number;
  total: number;
  bought: boolean;
}
export interface ShopStore {
  store: string;
  items: ShopItem[];
  total: number;
  left: number;
}
export interface ShoppingList {
  stores: ShopStore[];
  total: number;
  left: number;
  count: number;
  boughtCount: number;
}

export function shoppingList(ls: Line[], bought: Iterable<string>): ShoppingList {
  const ticks = new Set(bought);
  const by = new Map<string, ShopStore>();
  for (const l of ls) {
    if (!l.product || !l.units) continue;
    const item: ShopItem = {
      slot: l.slot,
      product: l.product,
      units: l.units,
      total: l.total,
      bought: ticks.has(tickKey(l.slot, l.product)),
    };
    const s = by.get(l.product.store) || { store: l.product.store, items: [], total: 0, left: 0 };
    s.items.push(item);
    s.total += item.total;
    if (!item.bought) s.left += item.total;
    by.set(l.product.store, s);
  }
  // the store with the most left to pay first: that is where the shopping trip starts
  const stores = [...by.values()].sort((a, b) => b.left - a.left || b.total - a.total);
  const items = stores.flatMap(s => s.items);
  return {
    stores,
    total: stores.reduce((a, s) => a + s.total, 0),
    left: stores.reduce((a, s) => a + s.left, 0),
    count: items.length,
    boughtCount: items.filter(i => i.bought).length,
  };
}

/** Ticks of products that are no longer on the list are dropped, so they cannot come back ticked later. */
export function keepTicks(ls: Line[], bought: Iterable<string>): string[] {
  const live = new Set(ls.filter(l => l.product && l.units).map(l => tickKey(l.slot, l.product!)));
  return [...new Set(bought)].filter(k => live.has(k));
}

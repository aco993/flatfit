import type { Catalog, Product, SlotId } from '../types';

/**
 * Products the user adds from any store (a find at a market, a second-hand piece, a shop FlatFit does not know).
 * They live only in the browser, join the catalogue under the store "own", and go through the same 3D view,
 * fit checks, totals and shopping list as every other product.
 */
export const OWN_STORE = 'own';

export interface OwnInput {
  slot: SlotId;
  name: string;
  url?: string;
  price: number;
  w?: number;
  d?: number;
  h?: number;
  color?: string;
  hex?: string;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined);
const safeUrl = (u?: string) => {
  const s = (u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
};

/** A product from the form, or null when the name or price is missing. Sizes are in centimetres. */
export function makeOwnProduct(i: OwnInput, id: string): Product | null {
  const name = i.name.trim().slice(0, 120),
    price = num(i.price);
  if (!name || !price) return null;
  const p: Product = { id, slot: i.slot, store: OWN_STORE, name, url: safeUrl(i.url), price, color: (i.color || '').trim().slice(0, 40) };
  for (const k of ['w', 'd', 'h'] as const) {
    const v = num(i[k]);
    if (v) p[k] = Math.min(v, 1000);
  }
  if (i.hex && /^#[0-9a-f]{6}$/i.test(i.hex)) p.hex = i.hex.toLowerCase();
  return p;
}

/** Stored own products that are still well-formed (storage can hold anything). */
export function validOwn(list: unknown): Product[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is Product =>
      !!p &&
      typeof p === 'object' &&
      typeof p.id === 'string' &&
      p.id.startsWith('own-') &&
      typeof p.slot === 'string' &&
      typeof p.name === 'string' &&
      typeof p.price === 'number' &&
      p.price > 0 &&
      p.store === OWN_STORE,
  );
}

/** The catalogue with the user's own products and their store added (a copy: the loaded catalogue stays as it is). */
export function withOwn(cat: Catalog, own: Product[], storeName: string): Catalog {
  if (!own.length) return cat;
  return {
    ...cat,
    stores: [...cat.stores.filter(s => s.id !== OWN_STORE), { id: OWN_STORE, name: storeName, web: '' }],
    products: [...cat.products, ...own],
  };
}

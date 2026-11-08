import type { Catalog, Product } from '../types';

/**
 * "Refresh prices" in the browser, without a server:
 * 1. IKEA's public search endpoint answers cross-origin requests, so IKEA prices (and how long a sale lasts)
 *    are checked live, item by item;
 * 2. other stores do not allow that, so their prices come from the catalogue the daily GitHub Action
 *    re-checks and commits; the page reads the newest copy straight from the repository.
 */
export interface PriceUpdate {
  price: number;
  regular?: number;
  until?: string;
  checked: string;
  unavailable?: boolean;
}
export type Updates = Record<string, PriceUpdate>;
export interface RefreshReport {
  live: number;
  changed: number;
  newSales: number;
  gone: number;
  failed: number;
  published?: string;
}

export const PUBLISHED = 'https://raw.githubusercontent.com/aco993/flatfit/main/src/data/catalogs/';
const ITEM = /ikea\.com\/([a-z]{2}\/[a-z]{2})\/p\/[^/]*-(s?\d{8})\/?$/;
/** fixed rates only: the Bosnian mark is pegged to the euro */
const RATE: Record<string, number> = { 'EUR>BAM': 1.95583 };
/** a sale "valid until" more than this many days away is the shop's default date, not the end of a promotion */
const SALE_DAYS = 120;

export const ikeaItem = (p: Product) => {
  const m = ITEM.exec(p.url);
  return m ? { loc: m[1], item: m[2] } : null;
};
const amount = (x?: { wholeNumber?: string; decimals?: string }) =>
  x?.wholeNumber ? parseFloat(x.wholeNumber.replace(/\D/g, '') + '.' + (x.decimals || '0').replace(/\D/g, '')) : undefined;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Current IKEA price of one item; null when IKEA no longer lists it. */
export async function ikeaPrice(loc: string, item: string, signal?: AbortSignal) {
  const no = item.replace(/^s/, '');
  const r = await fetch(`https://sik.search.blue.cdtapps.com/${loc}/search-result-page?q=${no}&types=PRODUCT&size=5`, { signal });
  if (!r.ok) throw new Error(`IKEA ${r.status}`);
  const d = await r.json();
  const hit = (d.searchResultPage?.products?.main?.items || [])
    .map((i: { product?: any }) => i.product)
    .find((x: any) => x && (x.itemNo === no || x.id === item));
  if (!hit?.salesPrice?.numeral) return null;
  const sp = hit.salesPrice,
    prev = amount(sp.previous);
  return {
    price: sp.numeral as number,
    regular: prev && prev > sp.numeral ? prev : undefined,
    validTo: sp.validTo as string | undefined,
    currency: sp.currencyCode as string,
  };
}

/** Turns one live answer into an update in the catalogue's currency. */
export function toUpdate(
  live: { price: number; regular?: number; validTo?: string; currency: string },
  currency: string,
  today: string,
): PriceUpdate {
  const k = live.currency === currency ? 1 : (RATE[`${live.currency}>${currency}`] ?? NaN);
  const conv = (v: number) => (k === 1 ? v : Math.round(v * k));
  const u: PriceUpdate = { price: conv(live.price), checked: today };
  if (live.regular) {
    u.regular = conv(live.regular);
    if (live.validTo && days(today, live.validTo) <= SALE_DAYS) u.until = live.validTo.slice(0, 10);
  }
  return u;
}

const same = (p: Product, u: PriceUpdate) =>
  p.price === u.price &&
  (p.regular || 0) === (u.regular || 0) &&
  (p.until || '') === (u.until || '') &&
  !!p.unavailable === !!u.unavailable;

/** A catalogue with the updates applied (the original is not changed). */
export function applyUpdates(cat: Catalog, ups: Updates): Catalog {
  return {
    ...cat,
    products: cat.products.map(p => {
      const u = ups[p.id];
      if (!u || (p.checked && u.checked < p.checked)) return p;
      const n: Product = { ...p, price: u.price, checked: u.checked };
      if (u.regular) n.regular = u.regular;
      else delete n.regular;
      if (u.until) n.until = u.until;
      else delete n.until;
      if (u.unavailable) n.unavailable = true;
      else delete n.unavailable;
      return n;
    }),
  };
}

export async function refreshPrices(
  cat: Catalog,
  today: string,
  opt: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; fetchPublished?: boolean } = {},
): Promise<{ updates: Updates; report: RefreshReport }> {
  const updates: Updates = {},
    report: RefreshReport = { live: 0, changed: 0, newSales: 0, gone: 0, failed: 0 };
  const byId = new Map(cat.products.map(p => [p.id, p]));
  // 1. newest published catalogue (other stores)
  if (opt.fetchPublished !== false) {
    try {
      const r = await fetch(PUBLISHED + cat.country + '.json', { cache: 'no-store', signal: opt.signal });
      if (r.ok) {
        const pub = (await r.json()) as Catalog;
        report.published = pub.checked;
        for (const q of pub.products || []) {
          const p = byId.get(q.id),
            checked = q.checked || pub.checked;
          if (!p || checked <= (p.checked || cat.checked)) continue;
          updates[q.id] = { price: q.price, regular: q.regular, until: q.until, checked, unavailable: q.unavailable };
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  // 2. IKEA live, a few requests at a time
  const queue = cat.products
    .map(p => ({ p, it: ikeaItem(p) }))
    .filter((x): x is { p: Product; it: { loc: string; item: string } } => !!x.it);
  let done = 0;
  const worker = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      try {
        const live = await ikeaPrice(x.it.loc, x.it.item, opt.signal);
        if (live) {
          const u = toUpdate(live, cat.currency, today);
          if (Number.isFinite(u.price)) {
            updates[x.p.id] = u;
            report.live++;
          }
        } else {
          updates[x.p.id] = { price: x.p.price, regular: x.p.regular, until: x.p.until, checked: today, unavailable: true };
          report.live++;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        report.failed++;
      }
      opt.onProgress?.(++done, total);
    }
  };
  const total = queue.length;
  opt.onProgress?.(0, total);
  await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
  for (const [id, u] of Object.entries(updates)) {
    const p = byId.get(id)!;
    if (same(p, u)) continue;
    report.changed++;
    if (u.unavailable && !p.unavailable) report.gone++;
    else if (u.regular && u.regular > u.price && !(p.regular && p.regular > p.price)) report.newSales++;
  }
  return { updates, report };
}

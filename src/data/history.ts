import type { Series } from '../domain/history';

/**
 * Price histories and price-drop feeds are written at build time from the git history of the catalogues
 * (scripts/history.mjs). They are optional: a dev server without them, or a failed request, means no history.
 */
const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<Record<string, Series>>>();

export function loadHistory(country: string): Promise<Record<string, Series>> {
  let p = cache.get(country);
  if (!p) {
    p = fetch(`${BASE}history/${country}.json`)
      .then(r => (r.ok ? r.json() : { products: {} }))
      .then(j => (j && typeof j.products === 'object' ? (j.products as Record<string, Series>) : {}))
      .catch(() => ({}));
    cache.set(country, p);
  }
  return p;
}

export const feedUrl = (country: string) => `${BASE}feeds/${country}.xml`;

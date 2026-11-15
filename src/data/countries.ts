import type { Catalog, Product } from '../types';

export interface Country {
  id: string;
  currency: string;
  locale: string;
  flag: string;
  eurRate?: number;
  /**
   * The country's price-comparison site, searched for a product's model code ({q}). Only a link for the user:
   * these sites answer scripts with a bot challenge or forbid automated reading, so FlatFit never fetches them.
   */
  compare?: { site: string; url: string };
}

/** Supported markets. Adding one = a catalogue JSON in src/data/catalogs + an entry here + a name in i18n. */
export const COUNTRIES: Country[] = [
  {
    id: 'rs',
    currency: 'RSD',
    locale: 'sr-Latn-RS',
    flag: '🇷🇸',
    eurRate: 117.2,
    compare: { site: 'idealno.rs', url: 'https://www.idealno.rs/Trazenje/Proizvodi?q={q}' },
  },
  // Bosnia: the comparison sites found (jeftinije.ba) list no large appliances or TVs yet
  { id: 'ba', currency: 'BAM', locale: 'bs-BA', flag: '🇧🇦', eurRate: 1.95583 },
  {
    id: 'hr',
    currency: 'EUR',
    locale: 'hr-HR',
    flag: '🇭🇷',
    compare: { site: 'jeftinije.hr', url: 'https://www.jeftinije.hr/Trazenje/Proizvodi?q={q}' },
  },
  { id: 'de', currency: 'EUR', locale: 'de-DE', flag: '🇩🇪', compare: { site: 'geizhals.de', url: 'https://geizhals.de/?fs={q}' } },
  { id: 'at', currency: 'EUR', locale: 'de-AT', flag: '🇦🇹', compare: { site: 'geizhals.at', url: 'https://geizhals.at/?fs={q}' } },
];
export const country = (id: string) => COUNTRIES.find(c => c.id === id) || COUNTRIES[0];

/** Link to the product's model on the country's price-comparison site, if it has a model code and the country a site. */
export function compareLink(p: Pick<Product, 'model'>, countryId: string) {
  const c = COUNTRIES.find(x => x.id === countryId)?.compare;
  if (!c || !p.model) return undefined;
  return { site: c.site, url: c.url.replace('{q}', encodeURIComponent(p.model)) };
}

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  rs: () => import('./catalogs/rs.json'),
  ba: () => import('./catalogs/ba.json'),
  hr: () => import('./catalogs/hr.json'),
  de: () => import('./catalogs/de.json'),
  at: () => import('./catalogs/at.json'),
};
export async function loadCatalog(id: string): Promise<Catalog> {
  const m = await (loaders[id] || loaders.rs)();
  return m.default as Catalog;
}

export function money(v: number, c: Country, locale?: string) {
  return new Intl.NumberFormat(locale || c.locale, {
    style: 'currency',
    currency: c.currency,
    maximumFractionDigits: c.currency === 'RSD' ? 0 : 2,
    minimumFractionDigits: c.currency === 'RSD' ? 0 : Number.isInteger(v) ? 0 : 2,
  }).format(v);
}

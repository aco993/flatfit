import type { Catalog } from '../types';

export interface Country {
  id: string;
  currency: string;
  locale: string;
  flag: string;
  eurRate?: number;
}

/** Supported markets. Adding one = a catalogue JSON in src/data/catalogs + an entry here + a name in i18n. */
export const COUNTRIES: Country[] = [
  { id: 'rs', currency: 'RSD', locale: 'sr-Latn-RS', flag: '🇷🇸', eurRate: 117.2 },
  { id: 'ba', currency: 'BAM', locale: 'bs-BA', flag: '🇧🇦', eurRate: 1.95583 },
  { id: 'hr', currency: 'EUR', locale: 'hr-HR', flag: '🇭🇷' },
  { id: 'de', currency: 'EUR', locale: 'de-DE', flag: '🇩🇪' },
  { id: 'at', currency: 'EUR', locale: 'de-AT', flag: '🇦🇹' },
];
export const country = (id: string) => COUNTRIES.find(c => c.id === id) || COUNTRIES[0];

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

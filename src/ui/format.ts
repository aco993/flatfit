import type { Product } from '../types';
import { LANGS, getLang } from '../i18n';

/** Number, date and size formatting in the interface language. */
export const localeOf = () => LANGS.find(l => l.id === getLang())!.locale;
export const fmtNum = (v: number, d = 0) =>
  new Intl.NumberFormat(localeOf(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(localeOf(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
};
export const dimTxt = (p: Product) =>
  p.w
    ? [p.w, p.d, p.h]
        .filter(Boolean)
        .map(x => fmtNum(x!, x! % 1 ? 1 : 0))
        .join(' × ') + ' cm'
    : '';
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

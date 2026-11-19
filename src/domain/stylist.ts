import type { Project, SlotId } from '../types';
import { withinBudget } from './budget';
import { activeSlots } from './slots';
import { fitIssues, fixDeps, generate, lines, total, type Index, type Selection, type Style } from './selection';

/**
 * The AI stylist: a sentence ("calm and warm, for renting to couples, under 2,500 €, a sofa bed") is turned by a
 * language model into a few parameters, and FlatFit's own planner picks the products. The model never names a
 * product, so it cannot invent one that is not for sale; everything it says is checked against these lists.
 */
export const OPTIONAL: SlotId[] = ['armchair', 'tv', 'floorlamp', 'lamps', 'hooks'];
const STYLES: Style[] = ['cheap', 'light', 'warm', 'dark', 'color'];

export interface Brief {
  style: Style;
  /** most the furniture may cost, in the country's currency; null = no limit */
  budget: number | null;
  /** optional pieces the person asked for, and ones they do not want */
  include: SlotId[];
  exclude: SlotId[];
  /** a sofa that opens into a bed (guests, a studio, a flat to let) */
  sofaBed: boolean;
  /** one sentence in the person's language: how the wish was understood */
  note: string;
}

/** JSON schema for the model's answer (Gemini responseJsonSchema, Claude json_schema output). */
export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string', enum: STYLES },
    budget: { type: ['number', 'null'] },
    include: { type: 'array', items: { type: 'string', enum: OPTIONAL } },
    exclude: { type: 'array', items: { type: 'string', enum: OPTIONAL } },
    sofaBed: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['style', 'budget', 'include', 'exclude', 'sofaBed', 'note'],
  additionalProperties: false,
} as const;

/** The question for the model: what the fields mean, the flat, the market, the wish. */
export function briefPrompt(wish: string, ctx: { currency: string; lang: string; rooms: string; cheapest: number; current: number }) {
  return `You turn a person's wish for furnishing a flat into settings for a furniture planner. Do not name or invent any product: the planner picks real products from a store catalogue.

Fill these fields only:
- style: "cheap" (cheapest that fits, no optional pieces), "light" (light wood and white, Scandinavian), "warm" (warm wood, beige, Japandi), "dark" (dark wood, black, grey, urban), "color" (one colourful accent).
- budget: the most the furniture may cost in ${ctx.currency}, as a number, or null if the wish names no limit. Convert other currencies roughly to ${ctx.currency} (1 EUR ≈ 117 RSD ≈ 1.96 KM).
- include / exclude: optional pieces the person wants or does not want: armchair, tv, floorlamp, lamps (bedside lamps), hooks (coat stand).
- sofaBed: true if guests should be able to sleep on the sofa, or the flat is a studio or meant for letting short-term.
- note: one short sentence in the language "${ctx.lang}" saying how you understood the wish.

The flat: ${ctx.rooms}. In this market the cheapest complete setup that fits costs ${Math.round(ctx.cheapest)} ${ctx.currency}; the current one ${Math.round(ctx.current)} ${ctx.currency}.

The wish: """${wish.slice(0, 600)}"""`;
}

/** The model's answer, checked field by field; null when it is not usable. */
export function parseBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!STYLES.includes(o.style as Style)) return null;
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is SlotId => OPTIONAL.includes(x as SlotId)))] : []);
  const budget = typeof o.budget === 'number' && Number.isFinite(o.budget) && o.budget > 0 ? Math.round(o.budget) : null;
  const include = list(o.include),
    exclude = list(o.exclude).filter(s => !include.includes(s));
  return {
    style: o.style as Style,
    budget,
    include,
    exclude,
    sofaBed: o.sofaBed === true,
    note: typeof o.note === 'string' ? o.note.slice(0, 300) : '',
  };
}

const SOFA_BED = /razvla|ležaj|lezaj|sleeper|sofa bed|bettfunktion|schlaf|sovesofa/i;

/**
 * The setup for a brief: the look, then the optional pieces asked for or left out, a sofa bed if wanted, and,
 * if that costs more than the budget, the best setup the budget allows.
 */
export function applyBrief(b: Brief, proj: Project, ix: Index, today: string): { sel: Selection; total: number; budgetUsed: boolean } {
  let sel: Selection = generate(b.style, proj, ix, today);
  const active = new Set(activeSlots(proj).map(s => s.id));
  const hard = (s: Selection, slot: SlotId) => fitIssues(proj, s, ix).some(i => i.hard && i.slot === slot && !/needs/.test(i.code));
  const cheapestFitting = (slot: SlotId, s: Selection, test: (name: string) => boolean = () => true) =>
    (ix.bySlot.get(slot) || [])
      .filter(p => p.price > 0 && test(p.name))
      .sort((x, y) => x.price - y.price)
      .find(p => !hard(fixDeps({ ...s, [slot]: p.id }, ix), slot));
  for (const slot of b.include)
    if (active.has(slot) && !sel[slot]) {
      const p = cheapestFitting(slot, sel);
      if (p) sel = { ...sel, [slot]: p.id };
    }
  for (const slot of b.exclude) delete sel[slot];
  if (b.sofaBed && active.has('sofa')) {
    const cur = sel.sofa ? ix.byId.get(sel.sofa) : undefined;
    if (!cur || !SOFA_BED.test(cur.name)) {
      const p = cheapestFitting('sofa', sel, n => SOFA_BED.test(n));
      if (p) sel = { ...sel, sofa: p.id };
    }
  }
  sel = fixDeps(sel, ix);
  let sum = total(lines(proj, sel, ix, today));
  let budgetUsed = false;
  if (b.budget && sum > b.budget) {
    const r = withinBudget(b.budget, proj, ix, today, b.style === 'cheap' ? 'light' : b.style);
    sel = r.sel;
    sum = r.total;
    budgetUsed = true;
    // then each wish again, cheapest first, as long as the total stays within the budget
    const tryWith = (next: Selection) => {
      const s2 = fixDeps(next, ix),
        t2 = total(lines(proj, s2, ix, today));
      if (t2 <= b.budget!) {
        sel = s2;
        sum = t2;
      }
    };
    if (b.sofaBed && active.has('sofa')) {
      const cur = sel.sofa ? ix.byId.get(sel.sofa) : undefined;
      const p = !cur || !SOFA_BED.test(cur.name) ? cheapestFitting('sofa', sel, n => SOFA_BED.test(n)) : undefined;
      if (p) tryWith({ ...sel, sofa: p.id });
    }
    for (const slot of b.include)
      if (active.has(slot) && !sel[slot]) {
        const p = cheapestFitting(slot, sel);
        if (p) tryWith({ ...sel, [slot]: p.id });
      }
    for (const slot of b.exclude) if (sel[slot]) tryWith(Object.fromEntries(Object.entries(sel).filter(([k]) => k !== slot)));
  }
  return { sel, total: sum, budgetUsed };
}

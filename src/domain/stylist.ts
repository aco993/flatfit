import type { Project, SlotId } from '../types';
import { pin, withinBudget } from './budget';
import { SLOTS, activeSlots } from './slots';
import { family, fitIssues, fixDeps, generate, lines, total, type Index, type Selection, type Style } from './selection';

/**
 * The AI stylist: a sentence ("calm and warm, for renting to couples, under 2,500 €, a sofa bed") is turned by a
 * language model into a few parameters, and FlatFit's own planner picks the products. The model never names a
 * product, so it cannot invent one that is not for sale; everything it says is checked against these lists.
 * It is a conversation: after the first setup, "cheaper, but keep the sofa" or "another TV" changes only that.
 */
export const OPTIONAL: SlotId[] = ['armchair', 'tv', 'floorlamp', 'lamps', 'hooks'];
const STYLES: Style[] = ['cheap', 'light', 'warm', 'dark', 'color'];
/** pieces a person picks themselves; the dependent ones (worktop, chairs, slatted base, rods) follow them */
const PIECES: SlotId[] = SLOTS.filter(s => !s.dependent).map(s => s.id);
const DIRECTIONS = ['other', 'cheaper', 'pricier'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Brief {
  style: Style;
  /** most the furniture may cost, in the country's currency; null = no limit */
  budget: number | null;
  /** optional pieces the person asked for, and ones they do not want */
  include: SlotId[];
  exclude: SlotId[];
  /** a sofa that opens into a bed (guests, a studio, a flat to let) */
  sofaBed: boolean;
  /** pieces that stay exactly as they are now */
  keep: SlotId[];
  /** when not empty, only these pieces change and everything else stays */
  only: SlotId[];
  /** for the pieces in \`only\`: something cheaper, something better, or just a different one */
  direction: Direction;
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
    keep: { type: 'array', items: { type: 'string', enum: PIECES } },
    only: { type: 'array', items: { type: 'string', enum: PIECES } },
    direction: { type: 'string', enum: DIRECTIONS },
    note: { type: 'string' },
  },
  required: ['style', 'budget', 'include', 'exclude', 'sofaBed', 'keep', 'only', 'direction', 'note'],
  additionalProperties: false,
} as const;

export interface Turn {
  /** what the person wrote */
  wish: string;
  /** how the model understood it */
  brief: Brief;
}

/**
 * The question for the model: what the fields mean, the flat, the market, the wish. In a follow-up it also gets
 * the earlier wishes, the settings it gave last time and what the list holds now, and changes only what is asked.
 */
export function briefPrompt(
  wish: string,
  ctx: { currency: string; lang: string; rooms: string; cheapest: number; current: number; earlier?: Turn[]; setup?: string },
) {
  const last = ctx.earlier?.at(-1);
  const follow = last
    ? `

This is a follow-up. The person said before, in order: ${ctx.earlier!.map(t => `"""${t.wish.slice(0, 300)}"""`).join(', ')}.
Your settings last time: ${JSON.stringify(last.brief)}
What the list holds now (piece: product, price): ${ctx.setup || '(nothing)'}
Return the full settings again. Copy everything the new message does not change. If the message is about certain pieces only ("another sofa", "a cheaper TV", "a darker rug"), put just those in "only" and set "direction"; everything else then stays as it is. If it changes the whole flat ("darker", "cheaper overall", "under 2,000 €"), leave "only" empty and put in "keep" every piece the person wants to keep.`
    : '';
  return `You turn a person's wish for furnishing a flat into settings for a furniture planner. Do not name or invent any product: the planner picks real products from a store catalogue.

Fill these fields only:
- style: "cheap" (cheapest that fits, no optional pieces), "light" (light wood and white, Scandinavian), "warm" (warm wood, beige, Japandi), "dark" (dark wood, black, grey, urban), "color" (one colourful accent).
- budget: the most the furniture may cost in ${ctx.currency}, as a number, or null if the wish names no limit. Convert other currencies roughly to ${ctx.currency} (1 EUR ≈ 117 RSD ≈ 1.96 KM).
- include / exclude: optional pieces the person wants or does not want: armchair, tv, floorlamp, lamps (bedside lamps), hooks (coat stand).
- sofaBed: true if guests should be able to sleep on the sofa, or the flat is a studio or meant for letting short-term.
- keep: pieces to keep exactly as they are now (empty on a first wish).
- only: when the wish is about some pieces only, those pieces; otherwise empty.
- direction: for the pieces in "only": "cheaper", "pricier" (better, bigger, nicer) or "other" (just a different one).
- note: one short sentence in the language "${ctx.lang}" saying how you understood the wish.

The flat: ${ctx.rooms}. In this market the cheapest complete setup that fits costs ${Math.round(ctx.cheapest)} ${ctx.currency}; the current one ${Math.round(ctx.current)} ${ctx.currency}.${follow}

The wish: """${wish.slice(0, 600)}"""`;
}

/** The model's answer, checked field by field; null when it is not usable. */
export function parseBrief(raw: unknown): Brief | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!STYLES.includes(o.style as Style)) return null;
  const list = (v: unknown, allowed: SlotId[]) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is SlotId => allowed.includes(x as SlotId)))] : [];
  const budget = typeof o.budget === 'number' && Number.isFinite(o.budget) && o.budget > 0 ? Math.round(o.budget) : null;
  const include = list(o.include, OPTIONAL),
    exclude = list(o.exclude, OPTIONAL).filter(s => !include.includes(s)),
    only = list(o.only, PIECES),
    keep = list(o.keep, PIECES).filter(s => !only.includes(s) && !exclude.includes(s));
  return {
    style: o.style as Style,
    budget,
    include,
    exclude,
    sofaBed: o.sofaBed === true,
    keep,
    only,
    direction: DIRECTIONS.includes(o.direction as Direction) ? (o.direction as Direction) : 'other',
    note: typeof o.note === 'string' ? o.note.slice(0, 300) : '',
  };
}

const SOFA_BED = /razvla|ležaj|lezaj|sleeper|sofa bed|bettfunktion|schlaf|sovesofa/i;

/**
 * The setup for a brief: the look, then the optional pieces asked for or left out, a sofa bed if wanted, and,
 * if that costs more than the budget, the best setup the budget allows. With \`current\` (a follow-up), the pieces
 * to keep, and in an "only" wish every piece not named, stay as they are; the named ones get another product.
 */
export function applyBrief(
  b: Brief,
  proj: Project,
  ix: Index,
  today: string,
  current: Selection = {},
): { sel: Selection; total: number; budgetUsed: boolean } {
  const active = new Set(activeSlots(proj).map(s => s.id));
  const hard = (s: Selection, slot: SlotId) => fitIssues(proj, s, ix).some(i => i.hard && i.slot === slot && !/needs/.test(i.code));
  const fitting = (slot: SlotId, s: Selection) =>
    (ix.bySlot.get(slot) || []).filter(p => p.price > 0).filter(p => !hard(fixDeps({ ...s, [slot]: p.id }, ix), slot));
  const cheapestFitting = (slot: SlotId, s: Selection, test: (name: string) => boolean = () => true) =>
    (ix.bySlot.get(slot) || [])
      .filter(p => p.price > 0 && test(p.name))
      .sort((x, y) => x.price - y.price)
      .find(p => !hard(fixDeps({ ...s, [slot]: p.id }, ix), slot));

  // what stays: the pieces kept, and in an "only" wish every piece it does not name
  const pinned: Partial<Record<SlotId, string>> = {};
  if (b.only.length) for (const s of PIECES) if (active.has(s) && !b.only.includes(s)) pinned[s] = current[s] ?? '';
  for (const s of b.keep) if (current[s]) pinned[s] = current[s];
  for (const s of b.exclude) pinned[s] = '';
  for (const s of b.include) if (pinned[s] === '' && !b.exclude.includes(s)) delete pinned[s];

  let sel: Selection = pin(generate(b.style, proj, ix, today), pinned, ix);
  for (const slot of b.include)
    if (active.has(slot) && !sel[slot] && pinned[slot] === undefined) {
      const p = cheapestFitting(slot, sel);
      if (p) sel = { ...sel, [slot]: p.id };
    }
  if (b.sofaBed && active.has('sofa') && pinned.sofa === undefined) {
    const cur = sel.sofa ? ix.byId.get(sel.sofa) : undefined;
    if (!cur || !SOFA_BED.test(cur.name)) {
      const p = cheapestFitting('sofa', sel, n => SOFA_BED.test(n));
      if (p) sel = { ...sel, sofa: p.id };
    }
  }
  // the pieces the wish is about get a different product: in the look's colours first, the nearest price that way
  for (const slot of b.only) {
    if (!active.has(slot) || b.exclude.includes(slot) || !current[slot]) continue;
    const now = ix.byId.get(current[slot]!);
    if (!now) continue;
    const ok = fitting(slot, sel).filter(
      p =>
        p.id !== now.id &&
        (b.direction === 'cheaper' ? p.price < now.price : b.direction === 'pricier' ? p.price > now.price : true) &&
        (!b.sofaBed || slot !== 'sofa' || SOFA_BED.test(p.name)),
    );
    const inLook = b.style === 'cheap' ? ok : ok.filter(p => family(p.hex) === b.style);
    const pick = (inLook.length ? inLook : ok).sort((x, y) => Math.abs(x.price - now.price) - Math.abs(y.price - now.price))[0];
    // nothing cheaper (or better) that fits: the piece stays as it was
    sel = { ...sel, [slot]: pick ? pick.id : now.id };
  }
  sel = fixDeps(sel, ix);
  let sum = total(lines(proj, sel, ix, today));
  let budgetUsed = false;
  if (b.budget && sum > b.budget) {
    // the budget is spent around what stays; in an "only" wish the named pieces keep their new products if they fit
    const r = withinBudget(b.budget, proj, ix, today, b.style === 'cheap' ? 'light' : b.style, pinned);
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
    if (b.sofaBed && active.has('sofa') && pinned.sofa === undefined) {
      const cur = sel.sofa ? ix.byId.get(sel.sofa) : undefined;
      const p = !cur || !SOFA_BED.test(cur.name) ? cheapestFitting('sofa', sel, n => SOFA_BED.test(n)) : undefined;
      if (p) tryWith({ ...sel, sofa: p.id });
    }
    for (const slot of b.include)
      if (active.has(slot) && !sel[slot] && pinned[slot] === undefined) {
        const p = cheapestFitting(slot, sel);
        if (p) tryWith({ ...sel, [slot]: p.id });
      }
    for (const slot of b.exclude) if (sel[slot]) tryWith(Object.fromEntries(Object.entries(sel).filter(([k]) => k !== slot)));
  }
  return { sel, total: sum, budgetUsed };
}

/** What a follow-up changed: one line per piece, before and after (empty when the piece was not there). */
export function changes(before: Selection, after: Selection, ix: Index): { slot: SlotId; from: string; to: string }[] {
  const out: { slot: SlotId; from: string; to: string }[] = [];
  for (const slot of PIECES) {
    const a = before[slot] || '',
      z = after[slot] || '';
    if (a !== z) out.push({ slot, from: a ? ix.byId.get(a)?.name || a : '', to: z ? ix.byId.get(z)?.name || z : '' });
  }
  return out;
}

import type { Product, Project, SlotId } from '../types';
import { activeSlots, slotDef } from './slots';
import { family, fitIssues, fixDeps, generate, lines, total, type Index, type Selection, type Style } from './selection';

/**
 * "Furnish this flat for at most B": a multiple-choice knapsack over the catalogue.
 *
 * Every slot picks one product (optional slots may stay empty). A pick costs what it adds to the shopping list,
 * dependents included (a bed frame with its slatted base, a kitchen with its worktop). Its value is
 * weight × log(cost): spending more on a slot is worth less and less, and the weight (the slot's typical price)
 * makes the budget go where it shows, the sofa before the coat hooks. Colours outside the chosen family count
 * a little less. Dynamic programming over the budget in small steps finds the best set; then the real total and
 * the fit checks are recomputed, and a pick that breaks the plan is swapped back to the cheapest one that fits.
 */
export interface BudgetResult {
  sel: Selection;
  total: number;
  minimum: number;
  reached: boolean;
}

const STEPS = 600;

export function withinBudget(
  budget: number,
  proj: Project,
  ix: Index,
  today: string,
  style: Exclude<Style, 'cheap'> = 'light',
): BudgetResult {
  const base = generate('cheap', proj, ix, today);
  const minimum = total(lines(proj, base, ix, today));
  if (budget <= minimum) return { sel: base, total: minimum, minimum, reached: budget >= minimum };
  const hardOf = (s: Selection) =>
    new Set(
      fitIssues(proj, s, ix)
        .filter(i => i.hard && !/needs/.test(i.code))
        .map(i => i.slot + ':' + i.code),
    );
  const baseHard = hardOf(base);
  const costIn = (s: Selection, slot: SlotId) =>
    total(lines(proj, s, ix, today).filter(l => l.slot === slot || (slotDef(l.slot).dependent && depends(l.slot, slot))));

  // options per slot, priced in the context of the cheapest proposal
  type Opt = { id: string | null; cost: number; value: number };
  const groups: { slot: SlotId; opts: Opt[] }[] = [];
  for (const sd of activeSlots(proj)) {
    if (sd.dependent) continue;
    const cands = (ix.bySlot.get(sd.id) || []).filter(p => p.price > 0);
    if (!cands.length) continue;
    const opts: Opt[] = [];
    const raw: { p: Product; cost: number }[] = [];
    for (const p of cands) {
      const trial = fixDeps({ ...base, [sd.id]: p.id }, ix);
      if ([...hardOf(trial)].some(k => !baseHard.has(k))) continue; // does not fit this flat
      const cost = costIn(trial, sd.id);
      if (cost > 0) raw.push({ p, cost });
    }
    if (!raw.length) continue;
    const sorted = raw.map(r => r.cost).sort((a, b) => a - b),
      weight = sorted[Math.floor(sorted.length / 2)];
    for (const { p, cost } of raw) {
      const f = family(p.hex),
        colour = f === style ? 1 : f === '' ? 0.9 : 0.8;
      opts.push({ id: p.id, cost, value: weight * Math.log(1 + cost) * colour });
    }
    if (sd.optional) opts.push({ id: null, cost: 0, value: 0 });
    groups.push({ slot: sd.id, opts });
  }

  let cap = budget,
    best: Selection = base;
  for (let round = 0; round < 6; round++) {
    const step = cap / STEPS;
    // dp[b] = best value using exactly up to b steps; choice[g][b] = option index picked in group g
    let dp = new Float64Array(STEPS + 1).fill(-Infinity);
    dp[0] = 0;
    const choice: Int16Array[] = [];
    for (const g of groups) {
      const next = new Float64Array(STEPS + 1).fill(-Infinity),
        pick = new Int16Array(STEPS + 1).fill(-1);
      g.opts.forEach((o, oi) => {
        const c = Math.ceil(o.cost / step - 1e-9);
        for (let b = c; b <= STEPS; b++) {
          const v = dp[b - c] + o.value;
          if (dp[b - c] > -Infinity && v > next[b]) {
            next[b] = v;
            pick[b] = oi;
          }
        }
      });
      dp = next;
      choice.push(pick);
    }
    let b = 0;
    for (let i = 1; i <= STEPS; i++) if (dp[i] > dp[b]) b = i;
    if (dp[b] === -Infinity) break;
    let sel: Selection = {};
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const o = groups[gi].opts[choice[gi][b]];
      if (o.id) sel[groups[gi].slot] = o.id;
      b -= Math.ceil(o.cost / step - 1e-9);
    }
    sel = fixDeps(sel, ix);
    // pieces chosen one by one can clash (a wide fridge next to a long kitchen): fall back to the cheap pick there
    for (let i = 0; i < 4; i++) {
      const bad = [...hardOf(sel)].filter(k => !baseHard.has(k)).map(k => k.split(':')[0] as SlotId);
      if (!bad.length) break;
      for (const s of bad) {
        if (base[s]) sel[s] = base[s];
        else delete sel[s];
      }
      sel = fixDeps(sel, ix);
    }
    const sum = total(lines(proj, sel, ix, today));
    if (sum <= budget) return { sel, total: sum, minimum, reached: true };
    best = sel;
    cap -= sum - budget + step; // quantities interact (rods follow curtains); try again a little lower
  }
  return { sel: best, total: total(lines(proj, best, ix, today)), minimum, reached: false };
}

/** dependent slots and the main piece they follow */
function depends(dep: SlotId, main: SlotId) {
  return ({ worktop: 'kitchen', base: 'bed', chairs: 'table', rods: 'curtains' } as Partial<Record<SlotId, SlotId>>)[dep] === main;
}

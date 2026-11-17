import type { SlotId } from '../types';
import type { Line } from './selection';

/**
 * For landlords: does furnishing pay? The furniture costs money once and wears out over the years; furnished,
 * the flat rents for more. This compares the two per month.
 *
 * Lifespans are typical figures for a rented flat (a guest uses the sofa harder than an owner does), not data
 * from the stores, and the app says so.
 */
export const LIFESPAN_YEARS: Record<SlotId, number> = {
  kitchen: 15,
  worktop: 15,
  sink: 15,
  faucet: 10,
  hob: 10,
  oven: 12,
  hood: 10,
  fridge: 10,
  washer: 8,
  tv: 7,
  table: 10,
  chairs: 7,
  sofa: 6,
  armchair: 7,
  coffee: 10,
  tvunit: 10,
  rug: 4,
  floorlamp: 8,
  bed: 12,
  base: 10,
  mattress: 7,
  wardrobe: 15,
  night: 12,
  lamps: 8,
  hall: 12,
  hooks: 12,
  terrace: 6,
  curtains: 4,
  rods: 12,
  pendant: 10,
};

export interface PaybackInput {
  /** monthly rent with the furniture */
  furnished: number;
  /** monthly rent the flat would get empty (0 when it would not be rented out empty at all) */
  unfurnished: number;
  /** share of the year it is let, 0–100 */
  occupancy: number;
}

export interface Payback {
  /** what the furniture costs, with delivery */
  cost: number;
  /** extra rent per month the furniture brings, at the occupancy given */
  extra: number;
  /** wear per month: each piece's price spread over its lifespan */
  wear: number;
  /** extra rent minus wear */
  net: number;
  /** months until the extra rent has paid the furniture back; null when it never does */
  months: number | null;
  /** the pieces that wear out first, cheapest-to-replace last: what to budget for */
  soonest: { slot: SlotId; years: number; total: number }[];
}

export function payback(ls: Line[], delivery: number, input: PaybackInput): Payback {
  const bought = ls.filter(l => l.product && l.units > 0 && l.total > 0);
  const goods = bought.reduce((s, l) => s + l.total, 0);
  const cost = goods + Math.max(0, delivery);
  const occ = Math.min(100, Math.max(0, input.occupancy)) / 100;
  const extra = Math.max(0, input.furnished - Math.max(0, input.unfurnished)) * occ;
  const wear = bought.reduce((s, l) => s + l.total / (LIFESPAN_YEARS[l.slot] * 12), 0);
  const months = extra > 0 && cost > 0 ? Math.ceil(cost / extra) : cost === 0 ? 0 : null;
  const soonest = bought
    .map(l => ({ slot: l.slot, years: LIFESPAN_YEARS[l.slot], total: l.total }))
    .sort((a, b) => a.years - b.years || b.total - a.total)
    .slice(0, 3);
  return { cost, extra, wear, net: extra - wear, months, soonest };
}

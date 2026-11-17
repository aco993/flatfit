import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/types';
import type { Line } from '../../src/domain/selection';
import { SLOTS } from '../../src/domain/slots';
import { LIFESPAN_YEARS, payback } from '../../src/domain/payback';

const L = (slot: Line['slot'], total: number, units = 1): Line => ({
  slot,
  product: { id: slot, slot, store: 's', name: slot, url: '', price: total / units, color: '' } as Product,
  units,
  unitPrice: total / units,
  total,
  expired: false,
  promo: false,
});

describe('payback for landlords', () => {
  it('has a lifespan for every slot', () => {
    for (const s of SLOTS) expect(LIFESPAN_YEARS[s.id], s.id).toBeGreaterThan(0);
  });
  it('pays back from the extra rent, at the occupancy given', () => {
    const ls = [L('sofa', 36000), L('bed', 24000), L('rug', 4800)];
    const p = payback(ls, 1200, { furnished: 500, unfurnished: 400, occupancy: 100 });
    expect(p.cost).toBe(66000);
    expect(p.extra).toBe(100);
    expect(p.months).toBe(660);
    // 36000/72 + 24000/144 + 4800/48 = 500 + 166.67 + 100
    expect(p.wear).toBeCloseTo(766.67, 1);
    expect(p.net).toBeCloseTo(100 - 766.67, 1);
    expect(p.soonest[0]).toEqual({ slot: 'rug', years: 4, total: 4800 });
    const half = payback(ls, 1200, { furnished: 500, unfurnished: 400, occupancy: 50 });
    expect(half.extra).toBe(50);
    expect(half.months).toBe(1320);
  });
  it('never pays back when the furnished rent is not higher, and ignores empty slots', () => {
    const ls = [L('sofa', 30000), { ...L('tv', 0), product: undefined }, L('hooks', 900, 0)];
    const p = payback(ls, 0, { furnished: 300, unfurnished: 300, occupancy: 100 });
    expect(p.cost).toBe(30000);
    expect(p.months).toBeNull();
    expect(p.soonest.map(s => s.slot)).toEqual(['sofa']);
  });
  it('counts a flat that would not be let empty as the whole rent being extra', () => {
    const p = payback([L('sofa', 6000)], 0, { furnished: 500, unfurnished: 0, occupancy: 100 });
    expect(p.months).toBe(12);
  });
});

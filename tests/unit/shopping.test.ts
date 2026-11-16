import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/types';
import type { Line } from '../../src/domain/selection';
import { keepTicks, shoppingList, tickKey } from '../../src/domain/shopping';

const P = (id: string, store: string, price: number): Product => ({ id, slot: 'sofa', store, name: id, url: '', price, color: '' });
const L = (slot: Line['slot'], p: Product | undefined, units = 1): Line => ({
  slot,
  product: p,
  units,
  unitPrice: p?.price || 0,
  total: (p?.price || 0) * units,
  expired: false,
  promo: false,
});
const sofa = P('s1', 'jysk', 25000),
  chair = P('c1', 'ik', 2500),
  table = P('t1', 'ik', 9000),
  rug = P('r1', 'jysk', 4000);
const ls = [
  L('sofa', sofa),
  L('chairs', chair, 4),
  L('table', table),
  L('rug', rug),
  L('armchair', undefined),
  L('hooks', P('h', 'ik', 1), 0),
];

describe('shopping list', () => {
  it('groups by store, skips empty slots and zero units, and totals what is left to pay', () => {
    const s = shoppingList(ls, [tickKey('chairs', chair)]);
    expect(s.count).toBe(4);
    expect(s.boughtCount).toBe(1);
    expect(s.total).toBe(25000 + 10000 + 9000 + 4000);
    expect(s.left).toBe(25000 + 9000 + 4000);
    expect(s.stores.map(x => x.store)).toEqual(['jysk', 'ik']);
    expect(s.stores[1].left).toBe(9000);
  });
  it('unticks a slot when another product is chosen for it', () => {
    const other = P('s2', 'jysk', 30000);
    const s = shoppingList([L('sofa', other)], [tickKey('sofa', sofa)]);
    expect(s.boughtCount).toBe(0);
    expect(keepTicks([L('sofa', other)], [tickKey('sofa', sofa)])).toEqual([]);
  });
  it('keeps only ticks of products still on the list, once each', () => {
    const k = tickKey('rug', rug);
    expect(keepTicks(ls, [k, k, 'gone:x'])).toEqual([k]);
  });
});

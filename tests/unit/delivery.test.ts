import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import ba from '../../src/data/catalogs/ba.json';
import hr from '../../src/data/catalogs/hr.json';
import de from '../../src/data/catalogs/de.json';
import at from '../../src/data/catalogs/at.json';
import type { Catalog } from '../../src/types';
import { DELIVERY } from '../../src/data/delivery';
import { deliveryFor, storeDelivery } from '../../src/domain/delivery';
import { DEMO } from '../../src/data/demo';
import { generate, indexCatalog, lines } from '../../src/domain/selection';

describe('delivery rules', () => {
  it('picks the tier for the order value', () => {
    const d = DELIVERY.de.ikea;
    expect(storeDelivery(d, 300, 5).cost).toBe(89);
    expect(storeDelivery(d, 800, 5).cost).toBe(99);
    expect(storeDelivery(d, 2500, 5).cost).toBe(159);
  });
  it('is free above the threshold and a minimum below it (JYSK BiH)', () => {
    expect(storeDelivery(DELIVERY.ba.jysk, 650, 3)).toMatchObject({ cost: 0, free: true });
    expect(storeDelivery(DELIVERY.ba.jysk, 120, 1)).toMatchObject({ cost: 7, from: true });
  });
  it('charges each further large appliance (Gigatron)', () => {
    expect(storeDelivery(DELIVERY.rs.giga, 90000, 3).cost).toBe(2399 + 2 * 1199);
  });
  it('never guesses for stores that do not publish a price', () => {
    expect(storeDelivery(DELIVERY.rs.fi, 100000, 10)).toMatchObject({ cost: 0, unknown: true });
    expect(storeDelivery(undefined, 100, 1).unknown).toBe(true);
  });
});

describe.each([
  ['rs', rs],
  ['ba', ba],
  ['hr', hr],
  ['de', de],
  ['at', at],
] as const)('delivery for the demo flat (%s)', (id, cat) => {
  it('covers every store in the catalogue except estimates, with an https source', () => {
    for (const s of (cat as Catalog).stores)
      if (s.id !== 'est') {
        expect(DELIVERY[id][s.id], `${id}.${s.id}`).toBeTruthy();
        expect(DELIVERY[id][s.id].url).toMatch(/^https:\/\//);
      }
  });
  it('adds up store by store', () => {
    const ix = indexCatalog(cat as Catalog),
      ls = lines(DEMO, generate('light', DEMO, ix, '2026-11-03'), ix, '2026-11-03');
    const d = deliveryFor(ls, DELIVERY[id]);
    expect(d.stores.length).toBeGreaterThan(0);
    expect(d.total).toBe(d.stores.reduce((a, s) => a + s.cost, 0));
    expect(d.stores.some(s => s.store === 'est')).toBe(false);
  });
});

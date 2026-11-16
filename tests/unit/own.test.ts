import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import type { Catalog } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { makeOwnProduct, OWN_STORE, validOwn, withOwn } from '../../src/domain/own';
import { fitIssues, indexCatalog, lines, total } from '../../src/domain/selection';
import { shoppingList } from '../../src/domain/shopping';

describe('own products', () => {
  it('needs a name and a price, and keeps only safe links and sane sizes', () => {
    expect(makeOwnProduct({ slot: 'sofa', name: ' ', price: 100 }, 'own-1')).toBeNull();
    expect(makeOwnProduct({ slot: 'sofa', name: 'Sofa', price: 0 }, 'own-1')).toBeNull();
    const p = makeOwnProduct(
      { slot: 'sofa', name: 'Old sofa', price: 12000, url: 'javascript:alert(1)', w: 210, d: Number.NaN, hex: '#AABBCC' },
      'own-1',
    )!;
    expect(p.url).toBe('');
    expect(p.w).toBe(210);
    expect(p.d).toBeUndefined();
    expect(p.hex).toBe('#aabbcc');
    expect(p.store).toBe(OWN_STORE);
    expect(makeOwnProduct({ slot: 'sofa', name: 'x', price: 1, url: 'kupujemprodajem.com/oglas/1' }, 'own-2')!.url).toBe(
      'https://kupujemprodajem.com/oglas/1',
    );
  });
  it('drops broken stored entries', () => {
    const ok = makeOwnProduct({ slot: 'rug', name: 'Rug', price: 3000 }, 'own-r')!;
    expect(validOwn([ok, null, { id: 'fi-x', store: 'own' }, { ...ok, price: -1 }, 'x'])).toEqual([ok]);
    expect(validOwn('nope')).toEqual([]);
  });
  it('goes through the fit check, the total and the shopping list like any product', () => {
    const big = makeOwnProduct({ slot: 'sofa', name: 'Huge sofa', price: 9999, w: 600, d: 100, h: 80 }, 'own-big')!;
    const cat = withOwn(rs as Catalog, [big], 'My products');
    expect(cat.products.length).toBe((rs as Catalog).products.length + 1);
    expect((rs as Catalog).products.some(p => p.id === 'own-big')).toBe(false);
    const ix = indexCatalog(cat);
    const sel = { sofa: big.id };
    expect(fitIssues(DEMO, sel, ix).some(i => i.slot === 'sofa' && i.hard)).toBe(true);
    const ls = lines(DEMO, sel, ix, '2026-11-16');
    expect(total(ls)).toBe(9999);
    expect(shoppingList(ls, []).stores[0].store).toBe(OWN_STORE);
  });
});

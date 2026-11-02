import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, Product } from '../../src/types';
import { applyUpdates, ikeaItem, refreshPrices, toUpdate } from '../../src/data/refresh';

const TODAY = '2026-11-02';
const prod = (id: string, url: string, extra: Partial<Product> = {}): Product => ({ id, slot: 'sofa', store: 'ikea', name: id, url, price: 100, color: '', checked: '2026-10-30', ...extra });
const cat = (products: Product[], currency = 'EUR'): Catalog => ({ country: 'hr', currency, checked: '2026-10-30', stores: [{ id: 'ikea', name: 'IKEA', web: '' }], products });
const ikeaAnswer = (itemNo: string, numeral: number, previous?: number, validTo?: string) => ({
  searchResultPage: { products: { main: { items: [{ product: { itemNo, id: itemNo, salesPrice: { numeral, currencyCode: 'EUR', validTo, previous: previous ? { wholeNumber: String(previous), decimals: '' } : undefined } } }] } } },
});

describe('IKEA item numbers', () => {
  it('reads the market and the item number from a product link', () => {
    expect(ikeaItem(prod('a', 'https://www.ikea.com/hr/hr/p/kivik-trosjed-tibbleby-bez-siva-s69440597/'))).toEqual({ loc: 'hr/hr', item: 's69440597' });
    expect(ikeaItem(prod('b', 'https://www.ikea.com/rs/sr/p/glostad-sofa-dvosed-knisa-tamnosiva-50489012/'))).toEqual({ loc: 'rs/sr', item: '50489012' });
  });
  it('ignores search links and other stores', () => {
    expect(ikeaItem(prod('c', 'https://www.ikea.com/rs/sr/search/?q=knoxhult'))).toBeNull();
    expect(ikeaItem(prod('d', 'https://jysk.ba/dnevna-soba/sofe/trosjed-gedved'))).toBeNull();
  });
});

describe('live answer → catalogue update', () => {
  it('keeps the sale end only when it is near (a date a year away is IKEA’s default)', () => {
    expect(toUpdate({ price: 179, regular: 219, validTo: '2026-11-30T00:00:00', currency: 'EUR' }, 'EUR', TODAY)).toEqual({ price: 179, regular: 219, until: '2026-11-30', checked: TODAY });
    expect(toUpdate({ price: 299, regular: 329, validTo: '2027-03-03', currency: 'EUR' }, 'EUR', TODAY).until).toBeUndefined();
  });
  it('converts euro prices to marks for the Bosnian estimates', () => {
    expect(toUpdate({ price: 195, currency: 'EUR' }, 'BAM', TODAY).price).toBe(381);
  });
  it('does not invent a rate it does not know', () => {
    expect(Number.isNaN(toUpdate({ price: 10, currency: 'EUR' }, 'RSD', TODAY).price)).toBe(true);
  });
});

describe('applying updates', () => {
  it('replaces price, sale and availability, and never goes back to an older check', () => {
    const c = cat([prod('a', 'x', { regular: 150, until: '2026-11-01' }), prod('b', 'y', { checked: '2026-11-05' })]);
    const out = applyUpdates(c, { a: { price: 90, checked: TODAY }, b: { price: 1, checked: TODAY } });
    expect(out.products[0]).toMatchObject({ price: 90, checked: TODAY }); expect(out.products[0].regular).toBeUndefined(); expect(out.products[0].until).toBeUndefined();
    expect(out.products[1].price).toBe(100);
    expect(c.products[0].price).toBe(100); // the original is untouched
  });
});

describe('refreshPrices', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('checks IKEA live, counts changes and new sales, marks what IKEA no longer lists', async () => {
    const c = cat([
      prod('same', 'https://www.ikea.com/hr/hr/p/a-11111111/'),
      prod('sale', 'https://www.ikea.com/hr/hr/p/b-22222222/'),
      prod('gone', 'https://www.ikea.com/hr/hr/p/c-33333333/'),
      prod('other', 'https://jysk.ba/x', { store: 'jysk' }),
    ]);
    const answers: Record<string, unknown> = { '11111111': ikeaAnswer('11111111', 100), '22222222': ikeaAnswer('22222222', 80, 100, '2026-11-20'), '33333333': { searchResultPage: { products: { main: { items: [] } } } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => answers[/q=(\d+)/.exec(url)![1]] })));
    const progress: number[] = [];
    const { updates, report } = await refreshPrices(c, TODAY, { fetchPublished: false, onProgress: d => progress.push(d) });
    expect(report).toMatchObject({ live: 3, changed: 2, newSales: 1, gone: 1, failed: 0 });
    expect(updates.sale).toMatchObject({ price: 80, regular: 100, until: '2026-11-20' });
    expect(updates.gone.unavailable).toBe(true);
    expect(updates.other).toBeUndefined();
    expect(progress.at(-1)).toBe(3);
  });
  it('takes other stores from the newest published catalogue', async () => {
    const c = cat([prod('j', 'https://jysk.ba/x', { store: 'jysk' })]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...c, checked: TODAY, products: [{ ...c.products[0], price: 70, regular: 100, checked: TODAY }] }) })));
    const { updates, report } = await refreshPrices(c, TODAY);
    expect(updates.j).toMatchObject({ price: 70, regular: 100, checked: TODAY });
    expect(report).toMatchObject({ changed: 1, newSales: 1, published: TODAY });
  });
  it('counts failures instead of throwing when a store is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { report } = await refreshPrices(cat([prod('a', 'https://www.ikea.com/hr/hr/p/a-11111111/')]), TODAY);
    expect(report).toMatchObject({ live: 0, failed: 1, changed: 0 });
  });
});

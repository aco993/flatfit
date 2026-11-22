import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import at from '../../src/data/catalogs/at.json';
import ba from '../../src/data/catalogs/ba.json';
import de from '../../src/data/catalogs/de.json';
import hr from '../../src/data/catalogs/hr.json';
import type { Catalog } from '../../src/types';
import { ASSEMBLY } from '../../src/data/assembly';
import { DEMO } from '../../src/data/demo';
import { assemblyFor, storeAssembly } from '../../src/domain/assembly';
import { generate, indexCatalog, lines } from '../../src/domain/selection';

const TODAY = '2026-11-22';

describe('assembly and connection', () => {
  it('adds the call-out fee once per store, and kitchen assembly as a service of its own', () => {
    const ik = ASSEMBLY.rs.ik;
    expect(storeAssembly(ik, 5, false, [])).toMatchObject({ cost: 1999, from: true, unknown: false });
    expect(storeAssembly(ik, 5, true, [])).toMatchObject({ cost: 1999 + 4499, from: true });
    expect(storeAssembly(ik, 0, true, [])).toMatchObject({ cost: 4499, from: true });
  });
  it('uses a minimum order where that is what the store publishes', () => {
    expect(storeAssembly(ASSEMBLY.de.ikea, 3, false, [])).toMatchObject({ cost: 39, from: true });
  });
  it('prices connecting appliances per device, exactly where the store gives the amount', () => {
    expect(storeAssembly(ASSEMBLY.at.neck, 0, false, ['washer', 'oven'])).toMatchObject({
      cost: 29.99 + 79.9,
      from: false,
      unknown: false,
    });
  });
  it('says "not known" instead of guessing where a store publishes nothing', () => {
    expect(storeAssembly(ASSEMBLY.rs.fi, 6, true, [])).toMatchObject({ cost: 0, unknown: true });
    expect(storeAssembly(undefined, 1, false, [])).toMatchObject({ unknown: true });
  });
  it('counts the pieces per store for the demo flat in Serbia, and every store has an entry', () => {
    const ix = indexCatalog(rs as Catalog);
    const ls = lines(DEMO, generate('light', DEMO, ix, TODAY), ix, TODAY);
    const a = assemblyFor(ls, ASSEMBLY.rs);
    expect(a.stores.length).toBeGreaterThan(0);
    expect(a.stores.reduce((n, s) => n + s.pieces, 0)).toBeGreaterThanOrEqual(5);
    for (const s of a.stores) expect(ASSEMBLY.rs[s.store], s.store).toBeDefined();
    const ixAt = indexCatalog(at as Catalog);
    for (const s of assemblyFor(lines(DEMO, generate('light', DEMO, ixAt, TODAY), ixAt, TODAY), ASSEMBLY.at).stores)
      expect(ASSEMBLY.at[s.store], s.store).toBeDefined();
  });
  it('has an entry for every store of every country, each with a https link', () => {
    for (const cat of [rs, ba, hr, de, at] as Catalog[])
      for (const st of cat.stores)
        if (!['est', 'own'].includes(st.id)) expect(ASSEMBLY[cat.country]?.[st.id], cat.country + ':' + st.id).toBeDefined();
    for (const table of Object.values(ASSEMBLY)) for (const a of Object.values(table)) expect(a.url).toMatch(/^https:\/\//);
  });
});

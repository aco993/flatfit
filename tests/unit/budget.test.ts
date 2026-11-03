import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import ba from '../../src/data/catalogs/ba.json';
import de from '../../src/data/catalogs/de.json';
import type { Catalog } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { withinBudget } from '../../src/domain/budget';
import { fitIssues, generate, indexCatalog, lines, total } from '../../src/domain/selection';

const TODAY = '2026-11-03';
const markets = { rs: indexCatalog(rs as Catalog), ba: indexCatalog(ba as Catalog), de: indexCatalog(de as Catalog) };
const hard = (s: Parameters<typeof fitIssues>[1], ix: Parameters<typeof fitIssues>[2], p = DEMO) => fitIssues(p, s, ix).filter(i => i.hard && !/needs/.test(i.code)).map(i => i.slot + ':' + i.code);

describe.each(Object.entries(markets))('budget mode (%s)', (_, ix) => {
  const min = total(lines(DEMO, generate('cheap', DEMO, ix, TODAY), ix, TODAY));
  it('stays within the budget and spends most of it', () => {
    const budget = Math.round(min * 1.6), r = withinBudget(budget, DEMO, ix, TODAY);
    expect(r.reached).toBe(true);
    expect(r.total).toBeLessThanOrEqual(budget);
    expect(r.total).toBeGreaterThan(min * 1.3);
    expect(r.total).toBe(total(lines(DEMO, r.sel, ix, TODAY)));
  });
  it('never proposes a piece that does not fit', () => {
    const r = withinBudget(Math.round(min * 2.2), DEMO, ix, TODAY);
    expect(hard(r.sel, ix)).toEqual(hard(generate('cheap', DEMO, ix, TODAY), ix));
  });
  it('a bigger budget never buys a cheaper flat', () => {
    const a = withinBudget(Math.round(min * 1.3), DEMO, ix, TODAY), b = withinBudget(Math.round(min * 1.9), DEMO, ix, TODAY);
    expect(b.total).toBeGreaterThanOrEqual(a.total);
  });
  it('says so when the budget is below the cheapest setup that fits', () => {
    const r = withinBudget(Math.round(min * 0.7), DEMO, ix, TODAY);
    expect(r.reached).toBe(false); expect(r.minimum).toBe(min);
  });
});

describe('budget mode on other flats', () => {
  it('works for a studio and a two-room flat', () => {
    for (const p of [fromTemplate('studio', 's', 'de'), fromTemplate('tworoom', 't', 'de')]) {
      const ix = markets.de, min = total(lines(p, generate('cheap', p, ix, TODAY), ix, TODAY));
      const r = withinBudget(Math.round(min * 1.5), p, ix, TODAY);
      expect(r.reached).toBe(true); expect(r.total).toBeLessThanOrEqual(Math.round(min * 1.5));
    }
  });
});

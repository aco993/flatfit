import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import type { Catalog } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { fitIssues, generate, indexCatalog, lines, total } from '../../src/domain/selection';
import { applyBrief, briefPrompt, parseBrief, type Brief } from '../../src/domain/stylist';

const ix = indexCatalog(rs as Catalog);
const TODAY = '2026-11-20';
const brief = (b: Partial<Brief>): Brief => ({ style: 'warm', budget: null, include: [], exclude: [], sofaBed: false, note: '', ...b });

describe('AI stylist', () => {
  it('accepts only the fields and values the planner knows', () => {
    expect(parseBrief(null)).toBeNull();
    expect(parseBrief({ style: 'baroque' })).toBeNull();
    const b = parseBrief({
      style: 'dark',
      budget: 250000.4,
      include: ['tv', 'tv', 'sofa', 'pony'],
      exclude: ['tv', 'hooks'],
      sofaBed: 'yes',
      note: 'x',
    })!;
    expect(b).toEqual({ style: 'dark', budget: 250000, include: ['tv'], exclude: ['hooks'], sofaBed: false, note: 'x' });
    expect(parseBrief({ style: 'light', budget: -5, include: 'tv', exclude: null, sofaBed: true, note: 3 })).toEqual({
      style: 'light',
      budget: null,
      include: [],
      exclude: [],
      sofaBed: true,
      note: '',
    });
  });
  it('tells the model what it may fill in, and never asks it for a product', () => {
    const p = briefPrompt('cosy, under 2500 euro', {
      currency: 'RSD',
      lang: 'sr',
      rooms: 'living 15.6 m²',
      cheapest: 287631,
      current: 542507,
    });
    expect(p).toContain('Do not name or invent any product');
    expect(p).toContain('RSD');
    expect(p).toContain('cosy, under 2500 euro');
  });
  it('turns a brief into a setup from the catalogue that fits', () => {
    const r = applyBrief(brief({ style: 'warm', include: ['tv', 'armchair'], exclude: ['hooks'] }), DEMO, ix, TODAY);
    expect(r.sel.tv).toBeTruthy();
    expect(r.sel.armchair).toBeTruthy();
    expect(r.sel.hooks).toBeUndefined();
    for (const id of Object.values(r.sel)) expect(ix.byId.has(id!)).toBe(true);
    expect(fitIssues(DEMO, r.sel, ix).filter(i => i.hard && !/needs/.test(i.code))).toEqual([]);
  });
  it('chooses a sofa bed when asked', () => {
    const r = applyBrief(brief({ style: 'cheap', sofaBed: true }), DEMO, ix, TODAY);
    expect(ix.byId.get(r.sel.sofa!)!.name).toMatch(/razvla|ležaj|lezaj/i);
  });
  it('stays within the budget, falling back to the best setup the budget allows', () => {
    const cheap = total(lines(DEMO, generate('cheap', DEMO, ix, TODAY), ix, TODAY));
    const budget = Math.round(cheap * 1.15);
    const r = applyBrief(brief({ style: 'dark', budget, include: ['tv', 'armchair', 'floorlamp'] }), DEMO, ix, TODAY);
    expect(r.total).toBeLessThanOrEqual(budget);
  });
});

describe('AI stylist within a budget', () => {
  it('keeps the wishes that still fit the budget after it has to cut', () => {
    const cheap = total(lines(DEMO, generate('cheap', DEMO, ix, TODAY), ix, TODAY));
    const r = applyBrief(brief({ style: 'warm', budget: Math.round(cheap * 1.1), include: ['tv'], sofaBed: true }), DEMO, ix, TODAY);
    expect(r.budgetUsed).toBe(true);
    expect(r.total).toBeLessThanOrEqual(Math.round(cheap * 1.1));
    expect(ix.byId.get(r.sel.sofa!)!.name).toMatch(/razvla|ležaj|lezaj/i);
  });
});

describe('narrow balcony', () => {
  it('a bistro set fits a terrace 1.35 m wide', () => {
    const p = {
      ...DEMO,
      rooms: DEMO.rooms.map(r => (r.type === 'terrace' ? { ...r, w: 1.35, d: 3.4, z: -3.4 } : r)),
    };
    const sel = generate('cheap', p, ix, TODAY);
    expect(fitIssues(p, sel, ix).filter(i => i.slot === 'terrace')).toEqual([]);
  });
});

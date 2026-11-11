import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import de from '../../src/data/catalogs/de.json';
import at from '../../src/data/catalogs/at.json';
import ba from '../../src/data/catalogs/ba.json';
import hr from '../../src/data/catalogs/hr.json';
import type { Catalog, Project, SlotId } from '../../src/types';
import { DEMO, RS_PRESETS } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { autoLayout, WARDROBE_PASSAGE } from '../../src/domain/layout';
import { activeSlots } from '../../src/domain/slots';
import {
  decodeSelection,
  dimsOf,
  effectivePrice,
  encodeSelection,
  family,
  fitIssues,
  fixDeps,
  ownProducts,
  generate,
  indexCatalog,
  lines,
  total,
  unitsNeeded,
} from '../../src/domain/selection';

const ixRS = indexCatalog(rs as Catalog),
  ixDE = indexCatalog(de as Catalog),
  ixAT = indexCatalog(at as Catalog);
const ixBA = indexCatalog(ba as Catalog),
  ixHR = indexCatalog(hr as Catalog);
const TODAY = '2026-10-30';

describe('units needed', () => {
  it('counts curtains per window and buys pairs as one pack', () => {
    const pair = ixDE.bySlot.get('curtains')!.find(p => p.pack === 2)!;
    // demo: two windows in living room and bedroom → 4 panels → 2 pairs
    expect(unitsNeeded('curtains', pair, DEMO, { curtains: pair.id }, ixDE)).toBe(2);
    expect(unitsNeeded('rods', ixDE.bySlot.get('rods')![0], DEMO, {}, ixDE)).toBe(2);
  });
  it('needs no chairs when the table set includes them, otherwise four', () => {
    const set = ixRS.cat.products.find(p => p.slot === 'table' && p.includesChairs);
    const plain = ixRS.cat.products.find(p => p.slot === 'table' && !p.includesChairs)!;
    const chair = ixRS.bySlot.get('chairs')![0];
    expect(unitsNeeded('chairs', chair, DEMO, { table: plain.id, chairs: chair.id }, ixRS)).toBe(4);
    if (set) expect(unitsNeeded('chairs', chair, DEMO, { table: set.id, chairs: chair.id }, ixRS)).toBe(0);
  });
  it('covers the kitchen length with worktop pieces', () => {
    const k = ixRS.cat.products.find(p => p.slot === 'kitchen' && p.needsWorktop && (p.w || 0) > 150)!;
    const wt = ixRS.bySlot.get('worktop')!.find(p => p.w === 100)!;
    expect(unitsNeeded('worktop', wt, DEMO, { kitchen: k.id, worktop: wt.id }, ixRS)).toBe(Math.ceil(((k.w || 0) - 1) / 100));
  });
  it('uses two narrow slatted bases for a 160 cm bed', () => {
    const bed = ixDE.bySlot.get('bed')!.find(p => p.needsBase)!;
    const narrow = ixDE.bySlot.get('base')!.find(p => (p.w || 0) <= 90)!;
    expect(unitsNeeded('base', narrow, DEMO, { bed: bed.id, base: narrow.id }, ixDE)).toBe(2);
  });
});

describe('prices', () => {
  it('falls back to the regular price after a promotion ends', () => {
    const p = ixRS.cat.products.find(x => x.until && x.regular)!;
    expect(effectivePrice(p, '2026-10-01').price).toBe(p.price);
    const after = new Date(Date.parse(p.until!) + 86400000).toISOString().slice(0, 10);
    expect(effectivePrice(p, after)).toMatchObject({ price: p.regular, expired: true });
  });
  it('totals equal the sum of lines', () => {
    const sel = fixDeps({ ...RS_PRESETS.scandi }, ixRS);
    const ls = lines(DEMO, sel, ixRS, TODAY);
    expect(total(ls)).toBe(ls.reduce((s, l) => s + l.unitPrice * l.units, 0));
    expect(total(ls)).toBeGreaterThan(100000);
  });
});

describe('dependencies', () => {
  it('adds a worktop when the kitchen needs one and removes it when not', () => {
    const k1 = ixRS.cat.products.find(p => p.slot === 'kitchen' && p.needsWorktop)!;
    const k2 = ixRS.cat.products.find(p => p.slot === 'kitchen' && !p.needsWorktop)!;
    expect(fixDeps({ kitchen: k1.id }, ixRS).worktop).toBeTruthy();
    expect(fixDeps({ kitchen: k2.id, worktop: 'fi-wt-hrast' }, ixRS).worktop).toBeUndefined();
  });
});

describe('fit checks', () => {
  it('flags a kitchen + fridge longer than the niche', () => {
    const big = ixRS.cat.products.filter(p => p.slot === 'kitchen').sort((a, b) => (b.w || 0) - (a.w || 0))[0];
    const fr = ixRS.bySlot.get('fridge')![0];
    const iss = fitIssues(DEMO, { kitchen: big.id, fridge: fr.id }, ixRS);
    expect(iss.some(i => i.code === 'kitchenRun')).toBe((big.w || 0) + (fr.w || 0) > 248);
  });
  it('soft warning for 10 cm or less, hard above', () => {
    const iss = fitIssues(DEMO, { sofa: 'fi-vegas' }, ixRS);
    for (const i of iss) if (i.v.over !== undefined) expect(i.hard).toBe(Number(i.v.over) > 10);
  });
});

describe('generated proposals', () => {
  const projects: Project[] = [DEMO, fromTemplate('studio', 's', 'de'), fromTemplate('tworoom', 't', 'de')];
  for (const [name, ix] of [
    ['rs', ixRS],
    ['ba', ixBA],
    ['hr', ixHR],
    ['de', ixDE],
    ['at', ixAT],
  ] as const) {
    for (const p of projects) {
      it(`${name} / ${p.rooms.length} rooms: "cheap" fills every required slot and nothing is a hard misfit`, () => {
        const sel = generate('cheap', p, ix, TODAY);
        for (const sd of activeSlots(p))
          if (!sd.optional && !sd.dependent && ix.bySlot.get(sd.id)?.length) expect(sel[sd.id], sd.id).toBeTruthy();
        const hard = fitIssues(p, sel, ix).filter(i => i.hard && !/needs/.test(i.code));
        expect(hard.map(i => i.slot + ':' + i.code)).toEqual([]);
      });
    }
  }
  it('"dark" prefers dark colours more often than "light"', () => {
    const dark = generate('dark', DEMO, ixRS, TODAY),
      light = generate('light', DEMO, ixRS, TODAY);
    const count = (s: typeof dark, f: string) => Object.values(s).filter(id => family(ixRS.byId.get(id!)?.hex) === f).length;
    expect(count(dark, 'dark')).toBeGreaterThan(count(light, 'dark'));
  });
});

describe('layout', () => {
  it('places every piece of the demo inside its room', () => {
    const sel = fixDeps({ ...RS_PRESETS.scandi }, ixRS);
    const L = autoLayout(DEMO, s => dimsOf(sel[s] ? ixRS.byId.get(sel[s]!) : undefined, s));
    for (const pl of L.placements) {
      const r = DEMO.rooms.find(x => x.id === pl.room)!;
      expect(pl.x, pl.slot).toBeGreaterThanOrEqual(r.x - 0.01);
      expect(pl.x, pl.slot).toBeLessThanOrEqual(r.x + r.w + 0.01);
      expect(pl.z, pl.slot).toBeGreaterThanOrEqual(r.z - 0.01);
      expect(pl.z, pl.slot).toBeLessThanOrEqual(r.z + r.d + 0.01);
    }
    for (const s of ['sofa', 'tvunit', 'bed', 'wardrobe', 'kitchen', 'table', 'hall', 'washer', 'terrace'] as const)
      expect(
        L.placements.some(p => p.slot === s),
        s,
      ).toBe(true);
    expect(L.curtains.length).toBe(2);
  });
  it('puts the sofa and TV on opposite walls of the living room', () => {
    const L = autoLayout(DEMO, s => dimsOf(undefined, s));
    const sofa = L.placements.find(p => p.slot === 'sofa')!,
      tv = L.placements.find(p => p.slot === 'tvunit')!;
    expect(Math.abs(Math.abs(sofa.rot - tv.rot) - Math.PI)).toBeLessThan(1e-6);
  });
});

describe('share links', () => {
  it('round-trip a selection and drop unknown or mismatched ids', () => {
    const sel = { sofa: 'fi-vegas', bed: 'fi-varadero' } as const;
    const code = encodeSelection(sel);
    expect(decodeSelection(code, ixRS)).toEqual(sel);
    expect(decodeSelection(encodeSelection({ sofa: 'fi-varadero', bed: 'nope' } as never), ixRS)).toEqual({});
    expect(decodeSelection('garbage%%', ixRS)).toEqual({});
  });
});

describe('colour families', () => {
  it('classifies typical furniture colours', () => {
    expect(family('#1d1e20')).toBe('dark');
    expect(family('#f2f1ec')).toBe('light');
    expect(family('#c9a679')).toBe('warm');
    expect(family('#3c5a85')).toBe('color');
  });
});

describe('a saved selection from another country', () => {
  it('is not taken as this country’s choice; a few delisted products are tolerated', () => {
    const rsIx = indexCatalog(rs as Catalog),
      baIx = indexCatalog(ba as Catalog);
    const baSel = generate('light', DEMO, baIx, '2026-11-09'),
      rsSel = generate('light', DEMO, rsIx, '2026-11-09');
    expect(ownProducts(baSel, rsIx)).toBe(false);
    expect(ownProducts(rsSel, rsIx)).toBe(true);
    expect(ownProducts({ ...rsSel, sofa: 'rs-gone-since-last-week' }, rsIx)).toBe(true);
    expect(ownProducts({}, rsIx)).toBe(false);
  });
});

describe('wardrobe and bed in a bedroom that is wide but not deep', () => {
  // A made-up flat: a living room on top, under it a bedroom 3.5 m wide and 3.05 m deep with its door
  // near the top of the east wall (from the hall) and its window on the west wall. The usual
  // arrangement put the bed on the long north wall and the wardrobe facing it, about 30 cm away.
  const flat: Project = {
    id: 't-bed',
    name: 'Bedroom test',
    country: 'rs',
    wallHeight: 2.6,
    rooms: [
      { id: 'liv', type: 'living', x: 0, z: 0, w: 4.9, d: 3.4 },
      { id: 'bed', type: 'bedroom', x: 0, z: 3.4, w: 3.5, d: 3.05 },
      { id: 'hal', type: 'hall', x: 3.5, z: 3.4, w: 1.4, d: 3.05 },
    ],
    open: [['liv', 'hal']],
    openings: [
      { id: 'o1', kind: 'entry', room: 'hal', side: 's', at: 0.25, width: 0.9 },
      { id: 'o2', kind: 'door', room: 'bed', side: 'e', at: 0.3, width: 0.8 },
      { id: 'o3', kind: 'window', room: 'liv', side: 'w', at: 1, width: 1.6 },
      { id: 'o4', kind: 'window', room: 'bed', side: 'w', at: 0.8, width: 1.2 },
    ],
  };
  for (const [name, ix] of [
    ['rs', ixRS],
    ['ba', ixBA],
    ['de', ixDE],
  ] as const)
    it(`${name}: leaves at least 60 cm in front of the wardrobe, with the bed and both bedside tables in place`, () => {
      const sel = generate('light', flat, ix, TODAY);
      const issues = fitIssues(flat, sel, ix).filter(i => i.slot === 'wardrobe' || i.slot === 'bed' || i.slot === 'night');
      expect(issues.map(i => i.slot + ':' + i.code)).toEqual([]);
      const D = (s: SlotId) => dimsOf(sel[s] ? ix.byId.get(sel[s]!) : undefined, s);
      const w = autoLayout(flat, D).placements.find(p => p.slot === 'wardrobe');
      expect(w, 'a wardrobe is planned').toBeTruthy();
      expect(w!.gap === undefined || w!.gap >= WARDROBE_PASSAGE).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';
import ba from '../../src/data/catalogs/ba.json';
import type { Catalog } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { setLang } from '../../src/i18n';
import { generate, indexCatalog, lines, total } from '../../src/domain/selection';
import { itemText, listingData } from '../../src/ui/listing';

const ix = indexCatalog(ba as Catalog);
const sel = generate('light', DEMO, ix, '2026-11-09');
const names: Record<string, string> = {
  living: 'Dnevna soba',
  dining: 'Trpezarija i ulaz',
  kitchen: 'Kuhinja',
  bedroom: 'Spavaća soba',
  bath: 'Kupatilo',
  terrace: 'Terasa',
};

describe('listing sheet', () => {
  setLang('bs');
  const d = listingData(DEMO, sel, ix, id => names[id]);
  it('gives the living area without the terrace, and the terrace apart (44.6 m² flat, 4.6 m² terrace)', () => {
    expect(d.area + d.terrace).toBeCloseTo(44.58, 1);
    expect(d.terrace).toBeCloseTo(4.59, 1);
    expect(d.rooms).toHaveLength(DEMO.rooms.length);
  });
  it('describes the flat in the interface language, with its rooms', () => {
    expect(d.description).toMatch(/^Namješten stan od 40,0 m² sa terasom od 4,6 m²: dnevna soba, trpezarija i ulaz/);
    expect(d.title).toBe('Demo · dvosoban stan · 44,6 m²');
  });
  it('lists every bought item once, grouped by room, and adds up to the shopping list', () => {
    const items = d.groups.flatMap(g => g.items);
    const bought = lines(DEMO, sel, ix, '2026-11-09').filter(l => l.product && l.units);
    expect(items).toHaveLength(bought.length);
    expect(d.total).toBe(total(bought));
    expect(d.groups.map(g => g.name)).toContain('Kuhinja');
  });
  it('drops the editor’s star from an edited copy of the demo', () => {
    expect(listingData({ ...DEMO, demo: false, name: 'Moj stan *' }, sel, ix, id => names[id]).title).toBe('Moj stan');
  });
  it('does not say the same thing twice in the furniture list', () => {
    expect(itemText('Ormar', 'Ormar FANDRUP 97x176')).toBe('Ormar FANDRUP 97x176');
    expect(itemText('Noćni ormarići', 'Noćni ormarić KORUP')).toBe('Noćni ormarić KORUP');
    expect(itemText('Sofa', 'Trosjed GEDVED')).toBe('<span class="slot">Sofa:</span> Trosjed GEDVED');
  });
});

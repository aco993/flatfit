import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import de from '../../src/data/catalogs/de.json';
import at from '../../src/data/catalogs/at.json';
import ba from '../../src/data/catalogs/ba.json';
import hr from '../../src/data/catalogs/hr.json';
import type { Catalog } from '../../src/types';
import { SLOTS } from '../../src/domain/slots';
import { COUNTRIES } from '../../src/data/countries';
import { RS_PRESETS } from '../../src/data/demo';

const CATS: Record<string, Catalog> = { rs: rs as Catalog, ba: ba as Catalog, hr: hr as Catalog, de: de as Catalog, at: at as Catalog };
const slotIds = new Set(SLOTS.map(s => s.id));

describe.each(Object.entries(CATS))('catalogue %s', (id, cat) => {
  it('belongs to a configured country with the same currency', () => {
    const c = COUNTRIES.find(x => x.id === id)!;
    expect(c).toBeTruthy();
    expect(cat.currency).toBe(c.currency);
    expect(cat.country).toBe(id);
    expect(cat.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('has unique ids and only known slots and stores', () => {
    const ids = cat.products.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const stores = new Set(cat.stores.map(s => s.id));
    for (const p of cat.products) {
      expect(slotIds.has(p.slot), p.id).toBe(true);
      expect(stores.has(p.store), p.id + ' store ' + p.store).toBe(true);
    }
  });
  it('every product has a price, a colour and an https link', () => {
    for (const p of cat.products) {
      expect(p.price, p.id).toBeGreaterThan(0);
      expect(p.url, p.id).toMatch(/^https:\/\//);
      expect(typeof p.color).toBe('string');
      if (p.hex) expect(p.hex, p.id).toMatch(/^#[0-9a-f]{6}$/i);
      if (p.regular) expect(p.regular, p.id).toBeGreaterThan(p.price);
      for (const k of ['w', 'd', 'h'] as const)
        if (p[k] !== undefined) {
          expect(p[k]!, p.id + k).toBeGreaterThan(0);
          expect(p[k]!, p.id + k).toBeLessThan(400);
        }
    }
  });
  it('furniture that stands on the floor has sizes (needed for fit checks)', () => {
    for (const p of cat.products)
      if (['sofa', 'bed', 'wardrobe', 'tvunit', 'kitchen', 'table', 'coffee', 'night', 'hall'].includes(p.slot))
        expect(p.w, p.id).toBeGreaterThan(0);
  });
  it('covers the main slots', () => {
    for (const s of ['kitchen', 'fridge', 'sofa', 'bed', 'mattress', 'wardrobe', 'table', 'curtains'])
      expect(
        cat.products.some(p => p.slot === s),
        s,
      ).toBe(true);
  });
});

describe.each(['rs', 'ba'])('price check dates (%s)', id => {
  it('every product says when its price was confirmed, never after the catalogue date', () => {
    for (const p of CATS[id].products) {
      expect(p.checked, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.checked! <= CATS[id].checked, p.id).toBe(true);
    }
  });
});

describe.each(Object.keys(CATS))('promotions (%s)', id => {
  it('a sale found by the price check comes with its regular price, and every sale ends within a few months', () => {
    for (const p of CATS[id].products)
      if (p.until) {
        // hand-checked offers (stores behind a bot challenge) may only say until when the price holds
        if (p.checked === CATS[id].checked) expect(p.regular, p.id).toBeGreaterThan(p.price);
        expect((Date.parse(p.until) - Date.parse(CATS[id].checked)) / 864e5, p.id).toBeLessThanOrEqual(130);
      }
  });
});

describe('Bosnia and Herzegovina', () => {
  it('labels every price that is not from a local store as an estimate', () => {
    for (const p of CATS.ba.products)
      if (p.store === 'est') {
        expect(p.estimate, p.id).toBe(true);
        expect(p.note, p.id).toBeTruthy();
      }
  });
  it('slatted bases are as long as the bed and narrower or as wide', () => {
    for (const p of CATS.ba.products.filter(p => p.slot === 'base' || p.slot === 'mattress')) {
      expect(p.d, p.id).toBe(200);
      expect(p.w!, p.id).toBeLessThanOrEqual(160);
    }
  });
});

describe('hand-picked looks', () => {
  it('only use products that exist in the Serbian catalogue and match their slot', () => {
    const byId = new Map(CATS.rs.products.map(p => [p.id, p]));
    for (const [name, sel] of Object.entries(RS_PRESETS))
      for (const [slot, id] of Object.entries(sel)) {
        if (!id) continue;
        expect(byId.get(id), `${name}.${slot}=${id}`).toBeTruthy();
        expect(byId.get(id)!.slot).toBe(slot);
        expect(byId.get(id)!.unavailable, `${name}.${slot}=${id} is no longer sold`).toBeFalsy();
      }
  });
});

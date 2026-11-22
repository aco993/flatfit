import { describe, expect, it } from 'vitest';
import rs from '../../src/data/catalogs/rs.json';
import at from '../../src/data/catalogs/at.json';
import ba from '../../src/data/catalogs/ba.json';
import de from '../../src/data/catalogs/de.json';
import hr from '../../src/data/catalogs/hr.json';
import type { Catalog } from '../../src/types';
import { bedShape, drawerLayout, wardrobeShape } from '../../src/domain/shape';

const W = (name: string, w: number) => wardrobeShape({ name }, w);

describe('furniture shape from the product name', () => {
  it('reads the door and drawer code of Serbian stores', () => {
    expect(W('Ormar CHARLOTTA 3V2F, kašmir', 1.2)).toMatchObject({ doors: 3, drawers: 2, mirror: false, cols: 3, rows: 1 });
    expect(W('Ormar VARADERO 4K1F1O, artisan hrast / crna', 1.575)).toMatchObject({ doors: 4, drawers: 1, mirror: true, cols: 4 });
    // six doors in 1.58 m are not side by side: three tall ones with three short ones above
    expect(W('Ormar MONT 6V2F, bijela / artisan hrast', 1.58)).toMatchObject({ doors: 6, drawers: 2, cols: 3, rows: 2 });
  });
  it('reads doors and drawers written out in words, in every language', () => {
    expect(W('Ormar FANDRUP 144x176 3 vrata 3 ladice bijela', 1.45)).toMatchObject({ doors: 3, drawers: 3 });
    expect(W('BRIMNES Kleiderschrank 2-türig, weiß, 78x50x190 cm', 0.78)).toMatchObject({ doors: 2, drawers: 0 });
    expect(W('KLEPPSTAD Kleiderschrank mit 3 Türen, weiß, 117x55x176 cm', 1.17)).toMatchObject({ doors: 3 });
    expect(W('BRIMNES Ormar+3 vrata, bijela, 117x50x190 cm', 1.17)).toMatchObject({ doors: 3 });
  });
  it('knows sliding doors, and falls back to the width when the name says nothing', () => {
    expect(W('KLEPPSTAD Ormar s kliznim vratima, bijela, 117x55x176 cm', 1.17)).toMatchObject({ sliding: true, doors: 2 });
    expect(W('PAX / HASVIK Kleiderschrank, weiß/weiß, 150x66x201 cm', 1.5)).toMatchObject({ sliding: true, doors: 2 });
    expect(W('Ormar sa klasičnim vratima 150, bijeli', 1.5)).toMatchObject({ doors: 3, sliding: false, drawers: 0 });
  });
  it('puts drawers in a row under every door when they divide evenly, otherwise under the last door', () => {
    expect(drawerLayout(W('3 vrata 3 ladice', 1.45))).toEqual({ rows: 1, inLastCol: 0 });
    expect(drawerLayout(W('3V2F', 1.2))).toEqual({ rows: 0, inLastCol: 2 });
    expect(drawerLayout(W('2 vrata', 0.8))).toEqual({ rows: 0, inLastCol: 0 });
  });
  it('tells upholstered beds and beds with storage apart', () => {
    expect(bedShape({ name: 'SLATTUM tapecirani krevet, tamnosiva, 160×200' })).toEqual({ upholstered: true, storage: false });
    expect(bedShape({ name: 'SLATTUM Bettgestell, gepolstert, Vissle dunkelgrau' })).toMatchObject({ upholstered: true });
    expect(bedShape({ name: 'Okvir kreveta HASLEV sa prost. za odlag. 160x200' })).toMatchObject({ storage: true });
    expect(bedShape({ name: 'STORKLINTA Bettgestell +2 -kästn/Mitba/Fedhzra' })).toMatchObject({ storage: true });
    expect(bedShape({ name: 'TARVA krevet sa podnicom, borovina, 160×200' })).toEqual({ upholstered: false, storage: false });
  });
  it('gives every wardrobe in the catalogues a sensible front', () => {
    for (const cat of [rs, ba, hr, de, at] as Catalog[])
      for (const p of cat.products)
        if (p.slot === 'wardrobe') {
          const s = wardrobeShape(p, (p.w ?? 100) / 100);
          // no door narrower than 25 cm or wider than 80 cm
          const dw = (p.w ?? 100) / 100 / s.cols;
          expect(dw, p.name).toBeGreaterThanOrEqual(0.25);
          expect(dw, p.name).toBeLessThanOrEqual(0.8);
          expect(s.drawers, p.name).toBeLessThanOrEqual(3 * s.cols);
        }
  });
});

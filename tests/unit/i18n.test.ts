import { describe, expect, it } from 'vitest';
import { DICT, setLang, t } from '../../src/i18n';
import { SLOTS, GROUPS } from '../../src/domain/slots';
import { COUNTRIES } from '../../src/data/countries';
import { isProject } from '../../src/store';
import { DEMO } from '../../src/data/demo';

describe('translations', () => {
  const en = Object.keys(DICT.en);
  for (const lang of ['de', 'sr', 'bs', 'hr'] as const) {
    it(`${lang} has every English key, with the same {placeholders}`, () => {
      expect(Object.keys(DICT[lang]).sort()).toEqual(en.slice().sort());
      for (const k of en) {
        const ph = (s: string) => (s.match(/\{\w+\}/g) || []).sort();
        expect(ph(DICT[lang][k as keyof typeof DICT.en]), `${lang}:${k}`).toEqual(ph(DICT.en[k as keyof typeof DICT.en]));
      }
    });
  }
  it('Bosnian and Croatian are ijekavian: no ekavian word left over from Serbian', () => {
    // \b knows only ASCII letters, so the word edges are spelled out with Unicode letter classes (č, š, …)
    const ekavian =
      /(?<!\p{L})(cen[aeiu]|cene|mer[ae]|izmeri|svetl\p{L}*|nameštaj\p{L}*|zavese|pesak|levo|dole|mesto|pomer\p{L}*|proverava|provere|promen\p{L}*|zamen\p{L}*|sledeći|pre|procena|razmer\p{L}*|izmen\p{L}*|lep[aoe]|uvek|vreme|deo)(?!\p{L})/iu;
    for (const lang of ['bs', 'hr'] as const)
      for (const [k, v] of Object.entries(DICT[lang])) expect(ekavian.test(v), `${lang}:${k} = ${v}`).toBe(false);
  });
  it('Croatian uses its own words where they differ from Bosnian', () => {
    expect(DICT.hr['slot.fridge']).toBe('Hladnjak');
    expect(DICT.bs['slot.fridge']).toBe('Frižider');
    expect(DICT.hr['room.bathroom']).toBe('Kupaonica');
    expect(DICT.hr['nav.edit']).toContain('tlocrt');
  });
  it('names every slot, group, room type and country', () => {
    for (const s of SLOTS) expect(DICT.en).toHaveProperty('slot.' + s.id);
    for (const g of GROUPS) expect(DICT.en).toHaveProperty('group.' + g);
    for (const c of COUNTRIES) expect(DICT.en).toHaveProperty('country.' + c.id);
  });
  it('fills placeholders', () => {
    setLang('de');
    expect(t('issue.wall', { need: 200, have: 180 })).toContain('200');
    setLang('en');
  });
});

describe('project validation', () => {
  it('accepts the demo and rejects broken input', () => {
    expect(isProject(DEMO)).toBe(true);
    expect(isProject({ ...DEMO, rooms: [{ id: 'x', type: 'garage', x: 0, z: 0, w: 1, d: 1 }] })).toBe(false);
    expect(isProject({ ...DEMO, rooms: [{ id: 'x', type: 'living', x: 0, z: 0, w: -1, d: 1 }] })).toBe(false);
    expect(isProject(null)).toBe(false);
    expect(isProject('{"id":1}')).toBe(false);
  });
});

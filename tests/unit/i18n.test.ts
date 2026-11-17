import { describe, expect, it } from 'vitest';
import { EN, type Key, loadLang, setLang, t } from '../../src/i18n';
import de from '../../src/i18n/de';
import sr from '../../src/i18n/sr';
import bs from '../../src/i18n/bs';
import hr from '../../src/i18n/hr';
import { SLOTS, GROUPS } from '../../src/domain/slots';
import { COUNTRIES } from '../../src/data/countries';
import { isProject } from '../../src/store';
import { DEMO } from '../../src/data/demo';

const DICT: Record<'en' | 'de' | 'sr' | 'bs' | 'hr', Record<Key, string>> = { en: EN, de, sr, bs, hr };

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
  it('fills placeholders', async () => {
    await loadLang('de');
    setLang('de');
    expect(t('issue.wall', { need: 200, have: 180 })).toContain('200');
    setLang('en');
  });
  it('picks the word form for a count by each language’s plural rules', async () => {
    await loadLang('sr');
    await loadLang('de');
    setLang('en');
    expect(t('sum.promos', { n: 1 })).toBe('1 item on sale');
    expect(t('sum.promos', { n: 3 })).toBe('3 items on sale');
    expect(t('sum.expired', { n: 1 })).toMatch(/^1 promotion has ended/);
    setLang('sr');
    expect(t('sum.promos', { n: 1 })).toBe('1 stavka na akciji');
    expect(t('sum.promos', { n: 3 })).toBe('3 stavke na akciji');
    expect(t('sum.promos', { n: 5 })).toBe('5 stavki na akciji');
    expect(t('sum.promos', { n: 21 })).toBe('21 stavka na akciji');
    setLang('de');
    expect(t('sum.expired', { n: 1 })).toMatch(/^1 Angebot ist abgelaufen/);
    setLang('en');
  });
  it('uses plural forms with as many choices as the language has', () => {
    for (const lang of ['en', 'de', 'sr', 'bs', 'hr'] as const)
      for (const [k, v] of Object.entries(DICT[lang]))
        for (const m of v.matchAll(/\{\w+:([^}]*)\}/g))
          expect(m[1].split('|').length, `${lang}:${k}`).toBe(lang === 'en' || lang === 'de' ? 2 : 3);
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

describe('languages on demand', () => {
  it('falls back to English until a language is loaded, then uses it', async () => {
    // nothing in this file has loaded Croatian through loadLang yet
    setLang('hr');
    expect(t('slot.fridge')).toBe(EN['slot.fridge']);
    await loadLang('hr');
    expect(t('slot.fridge')).toBe('Hladnjak');
    setLang('en');
    expect(t('slot.fridge')).toBe(EN['slot.fridge']);
  });
});

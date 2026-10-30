import { describe, expect, it } from 'vitest';
import { DICT, setLang, t } from '../../src/i18n';
import { SLOTS, GROUPS } from '../../src/domain/slots';
import { COUNTRIES } from '../../src/data/countries';
import { isProject } from '../../src/store';
import { DEMO } from '../../src/data/demo';

describe('translations', () => {
  const en = Object.keys(DICT.en);
  for (const lang of ['de', 'sr'] as const) {
    it(`${lang} has every English key, with the same {placeholders}`, () => {
      expect(Object.keys(DICT[lang]).sort()).toEqual(en.slice().sort());
      for (const k of en) {
        const ph = (s: string) => (s.match(/\{\w+\}/g) || []).sort();
        expect(ph(DICT[lang][k as keyof typeof DICT.en]), `${lang}:${k}`).toEqual(ph(DICT.en[k as keyof typeof DICT.en]));
      }
    });
  }
  it('names every slot, group, room type and country', () => {
    for (const s of SLOTS) expect(DICT.en).toHaveProperty('slot.' + s.id);
    for (const g of GROUPS) expect(DICT.en).toHaveProperty('group.' + g);
    for (const c of COUNTRIES) expect(DICT.en).toHaveProperty('country.' + c.id);
  });
  it('fills placeholders', () => {
    setLang('de'); expect(t('issue.wall', { need: 200, have: 180 })).toContain('200'); setLang('en');
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

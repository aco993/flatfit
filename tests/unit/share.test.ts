import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { cleanMoves, makeLink, readLink } from '../../src/ui/share';
import { History } from '../../src/ui/history';

const BASE = 'https://aco993.github.io/flatfit/';

describe('share links', () => {
  it('round-trips country, language, flat and selection for the demo, with moved furniture', () => {
    const demo = { ...structuredClone(DEMO), moves: { sofa: { x: 1.2, z: 1.5, rot: 0 } } };
    const url = makeLink(BASE + '#old', { country: 'ba', lang: 'bs', project: demo, selection: 'abc' });
    expect(url.startsWith(BASE + '#')).toBe(true);
    expect(url).not.toContain('plan=');
    expect(readLink(new URL(url).hash)).toMatchObject({ country: 'ba', lang: 'bs', projectId: 'demo', selection: 'abc', moves: demo.moves });
  });
  it('carries a custom floor plan in the link, without the traced image or the choices', () => {
    const p = { ...fromTemplate('studio', 'Studio', 'de'), backdrop: { src: 'data:image/png;base64,AAAA', x: 0, z: 0, w: 5, ar: 1, opacity: 0.5 }, choices: { de: { preset: 'light', sel: {} } } };
    const back = readLink(new URL(makeLink(BASE, { country: 'de', lang: 'en', project: p, selection: '' })).hash);
    expect(back.plan?.rooms).toEqual(p.rooms);
    expect(back.plan?.backdrop).toBeUndefined();
    expect(back.plan?.choices).toBeUndefined();
    expect(back.plan?.demo).toBe(false);
  });
  it('ignores what it does not understand', () => {
    expect(readLink('#c=xx&l=zz&plan=!!!&m=@@@')).toEqual({ selection: undefined });
  });
  it('keeps only well-formed moves of movable pieces', () => {
    expect(cleanMoves({ sofa: { x: 1, z: 2, rot: 0 }, wall: { x: 1, z: 1, rot: 0 }, bed: { x: 'a', z: 1, rot: 0 }, tv: null })).toEqual({ sofa: { x: 1, z: 2, rot: 0 } });
  });
});

describe('undo history', () => {
  it('undoes and redoes in order, and a new change clears the redo stack', () => {
    const h = new History<number>();
    h.push(1); h.push(2); // states before two changes; the current state is 3
    expect(h.undo(3)).toBe(2); expect(h.undo(2)).toBe(1); expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2); expect(h.canRedo).toBe(true);
    h.push(2); expect(h.canRedo).toBe(false);
  });
  it('forgets the oldest states beyond its limit', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 5; i++) h.push(i);
    expect([h.undo(5), h.undo(4), h.undo(3), h.undo(2)]).toEqual([4, 3, 2, undefined]);
  });
});

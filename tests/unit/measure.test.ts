import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { measureList } from '../../src/domain/measure';

describe('measuring sheet', () => {
  const m = measureList(DEMO);
  it('asks for the width and depth of every room, and the ceiling once', () => {
    expect(m.rooms).toHaveLength(DEMO.rooms.length);
    for (const r of m.rooms) expect(r.items.slice(0, 2).map(i => i.what)).toEqual(['width', 'depth']);
    expect(m.ceiling).toMatchObject({ what: 'ceiling', value: DEMO.wallHeight });
  });
  it('gives every measurement its own code', () => {
    const codes = [m.ceiling, ...m.rooms.flatMap(r => r.items)].map(i => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('lists where the entrance is and how wide it is (the corner by the bathroom)', () => {
    const dining = m.rooms.find(r => r.id === 'dining')!;
    const at = dining.items.find(i => i.kind === 'entry' && i.what === 'at')!,
      size = dining.items[dining.items.indexOf(at) + 1];
    expect(at).toMatchObject({ side: 's', value: 3.05 });
    expect(size).toMatchObject({ what: 'size', value: 0.85 });
  });
  it('asks for the sill of each window, and covers radiators and the TV socket', () => {
    const windows = DEMO.openings.filter(o => o.kind === 'window').length;
    expect(m.rooms.flatMap(r => r.items).filter(i => i.what === 'sill')).toHaveLength(windows);
    const two = measureList(fromTemplate('tworoom', 't', 'ba'));
    expect(two.rooms.flatMap(r => r.items).some(i => i.kind === 'radiator')).toBe(true);
    expect(two.rooms.flatMap(r => r.items).some(i => i.kind === 'tv')).toBe(true);
  });
});

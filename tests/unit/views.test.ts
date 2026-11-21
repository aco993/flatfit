import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/data/demo';
import { autoViews } from '../../src/domain/layout';

describe('room cameras', () => {
  it('skip a corner where a tall piece stands, for the next best one', () => {
    const free = autoViews(DEMO).find(v => v.id === 'bedroom')!;
    const [bx, , bz] = free.pos;
    // a wardrobe exactly where the camera would stand
    const blocked = (x: number, z: number) => Math.hypot(x - bx, z - bz) < 0.5;
    const moved = autoViews(DEMO, blocked).find(v => v.id === 'bedroom')!;
    expect(moved.pos).not.toEqual(free.pos);
    expect(blocked(moved.pos[0], moved.pos[2])).toBe(false);
    const bed = DEMO.rooms.find(r => r.id === 'bedroom')!;
    expect(moved.pos[0]).toBeGreaterThan(bed.x);
    expect(moved.pos[0]).toBeLessThan(bed.x + bed.w);
    expect(moved.pos[2]).toBeGreaterThan(bed.z);
    expect(moved.pos[2]).toBeLessThan(bed.z + bed.d);
  });
  it('keep the usual corner when nothing is in the way', () => {
    expect(autoViews(DEMO, () => false)).toEqual(autoViews(DEMO));
  });
});

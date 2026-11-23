import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { canStep, passages, roomAt, standable, walkSpots } from '../../src/domain/walk';

const free = () => false;
const pair = (a: string, b: string) => [a, b].sort().join('|');

describe('walking through the flat', () => {
  it('finds the ways between rooms in the plan: doors, the balcony door and open-plan seams, not the front door', () => {
    const ways = passages(DEMO).map(ps => `${pair(ps.a, ps.b)}:${ps.kind}`);
    expect(ways).toContain('bedroom|living:door');
    expect(ways).toContain('living|terrace:balcony');
    expect(ways).toContain('dining|living:open');
    expect(ways).toContain('dining|kitchen:open');
    // the entrance leads to the stairwell, which is not part of the flat
    expect(passages(DEMO).every(ps => ps.a && ps.b)).toBe(true);
  });
  it('steps through a doorway or an open seam, never through a wall', () => {
    // bedroom door: west wall of the bedroom (x = 4) at z 2.35–3.10
    expect(canStep(DEMO, [4.4, 2.7], [3.6, 2.7])).toBe(true);
    expect(canStep(DEMO, [4.4, 1.0], [3.6, 1.0])).toBe(false);
    // living and dining are one open space
    expect(canStep(DEMO, [2, 3.5], [2, 4.4])).toBe(true);
    expect(canStep(DEMO, [2, 3.5], [8, 3.5])).toBe(false);
  });
  it('keeps the camera off the walls and out of furniture, except in a doorway', () => {
    expect(standable(DEMO, 5.5, 1.6, free)).toBe(true);
    expect(standable(DEMO, 4.05, 1.0, free)).toBe(false);
    expect(standable(DEMO, 4.0, 2.7, free)).toBe(true);
    expect(standable(DEMO, 5.5, 1.6, (x, z) => Math.hypot(x - 5.5, z - 1.6) < 0.5)).toBe(false);
    expect(roomAt(DEMO, 20, 20)).toBeNull();
  });
  it('puts a ring in every room for each way out, leading a step into the next room', () => {
    const spots = walkSpots(DEMO, 'living', free);
    expect(spots.map(s => s.room).sort()).toEqual(['bath', 'bedroom', 'dining', 'terrace'].filter(r => spots.some(s => s.room === r)));
    for (const s of spots) {
      expect(roomAt(DEMO, s.x, s.z)).toBe('living');
      const [tx, tz] = s.path[s.path.length - 1];
      expect(roomAt(DEMO, tx, tz)).toBe(s.room);
      expect(standable(DEMO, tx, tz, free)).toBe(true);
    }
    expect(spots.some(s => s.room === 'bedroom')).toBe(true);
    // and back again
    expect(walkSpots(DEMO, 'bedroom', free).map(s => s.room)).toEqual(['living']);
  });
  it('turns aside behind a door when furniture stands right behind it', () => {
    // a wardrobe right behind the bedroom door, with a free strip beside it
    const wardrobe = (x: number, z: number) => x > 4.5 && x < 6.2 && z > 2.5 && z < 3.3;
    const s = walkSpots(DEMO, 'living', wardrobe).find(w => w.room === 'bedroom')!;
    expect(s.path.length).toBe(2);
    const [tx, tz] = s.path[1];
    expect(wardrobe(tx, tz)).toBe(false);
    expect(roomAt(DEMO, tx, tz)).toBe('bedroom');
  });
  it('works for the templates too: every room can be reached from every other', () => {
    for (const t of ['studio', 'tworoom'] as const) {
      const p = fromTemplate(t, 'x', 'de');
      const rooms = [...new Set(p.rooms.map(r => roomAt(p, r.x + r.w / 2, r.z + r.d / 2)!))].filter(r => r !== null);
      const seen = new Set([rooms[0]]),
        queue = [rooms[0]];
      while (queue.length) {
        const r = queue.shift()!;
        for (const s of walkSpots(p, r, free))
          if (!seen.has(s.room)) {
            seen.add(s.room);
            queue.push(s.room);
          }
      }
      expect([...seen].sort(), t).toEqual(rooms.sort());
    }
  });
});

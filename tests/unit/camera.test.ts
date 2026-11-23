import { describe, expect, it } from 'vitest';
import { INTERIOR_FOV, INTERIOR_MIN_H, horizontalFov, interiorFov } from '../../src/three/camera';

describe('field of view inside a room', () => {
  it('stays as it was on a wide screen', () => {
    expect(interiorFov(797 / 531)).toBe(INTERIOR_FOV);
    expect(interiorFov(16 / 9)).toBe(INTERIOR_FOV);
  });
  it('widens on a phone so the room is seen across at least the minimum angle', () => {
    const a = 359 / 440,
      v = interiorFov(a);
    expect(v).toBeGreaterThan(INTERIOR_FOV);
    expect(horizontalFov(v, a)).toBeCloseTo(INTERIOR_MIN_H, 5);
    // on the old fixed angle a phone saw only about 52° across
    expect(horizontalFov(INTERIOR_FOV, a)).toBeLessThan(55);
  });
  it('stops widening where the picture would stretch, and survives a zero-size canvas', () => {
    expect(interiorFov(0.3)).toBe(90);
    expect(interiorFov(0)).toBe(INTERIOR_FOV);
    expect(interiorFov(Number.NaN)).toBe(INTERIOR_FOV);
  });
});

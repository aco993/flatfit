/** Vertical field of view inside a room on a wide screen, in degrees. */
export const INTERIOR_FOV = 62;
/** The least horizontal field of view inside a room, so a tall phone screen still shows the room and not one piece. */
export const INTERIOR_MIN_H = 76;
const MAX_FOV = 90;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * three.js cameras keep the vertical angle fixed, so a portrait canvas sees a narrow slice of the room.
 * Widen the vertical angle until the horizontal one reaches INTERIOR_MIN_H, up to a limit past which the
 * edges of the picture stretch too much.
 */
export function interiorFov(aspect: number) {
  if (!(aspect > 0)) return INTERIOR_FOV;
  const v = deg(2 * Math.atan(Math.tan(rad(INTERIOR_MIN_H) / 2) / aspect));
  return Math.min(MAX_FOV, Math.max(INTERIOR_FOV, v));
}

/** Horizontal field of view for a vertical one, in degrees. */
export const horizontalFov = (vfov: number, aspect: number) => deg(2 * Math.atan(Math.tan(rad(vfov) / 2) * aspect));

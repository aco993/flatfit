import * as THREE from 'three';

/**
 * Everything the page needs from three.js, in one module that is loaded after the shopping list is on screen:
 * three.js is the largest part of the page, and nothing in the list waits for it.
 */
export { Viewer } from './viewer';
export { Materials } from './materials';
export { Models } from './models';
export { buildApartment } from './build';

/** The flat as a box from the floor to 3 m, for framing the overview. */
export const flatBox = (b: { x1: number; z1: number; x2: number; z2: number }) =>
  new THREE.Box3(new THREE.Vector3(b.x1, 0, b.z1), new THREE.Vector3(b.x2, 3, b.z2));

/** Where the camera looks, flattened onto the floor: a unit vector [x, z]; straight down counts as "away". */
export function groundDir(camera: THREE.Camera): [number, number] {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  const l = Math.hypot(d.x, d.z);
  return l < 1e-3 ? [0, -1] : [d.x / l, d.z / l];
}

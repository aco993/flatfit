import * as THREE from 'three';
import type { Placement, Product, SlotId } from '../../types';
import type { Kind, Materials } from '../materials';
import type { Models } from '../models';
import type { Builder, Furnish } from '../build';

/** What every part of furnishing needs: the builder, the chosen products and their places, and small helpers. */
export interface FurnishCtx {
  root: THREE.Group;
  b: Builder;
  M: Materials;
  f: Furnish;
  /** wall height drawn (low walls in the overview) */
  H: number;
  /** full height: inside a room, not the doll-house overview */
  full: boolean;
  models: Models;
  BLACK: THREE.MeshStandardMaterial;
  /** material in a product's colour (second colour with two = true), wood or lacquer by its look */
  mat: (p: Product | undefined, def: string, kind?: Kind, two?: boolean) => THREE.MeshStandardMaterial;
  /** a group standing at a placement, moved forward by half the piece's depth */
  at: (pl: Placement, d: number) => THREE.Group;
  /** runs fn for every placement of a slot, with the slot as the tag of what it builds */
  each: (s: SlotId, fn: (pl: Placement) => void) => void;
  has: (s: SlotId) => boolean;
}

export const hexOf = (p: Product | undefined, def: string) => p?.hex || def;

export function chair(b: Builder, parent: THREE.Object3D, x: number, z: number, ry: number, seat: THREE.Material, leg: THREE.Material) {
  const g = b.group(parent, x, z, ry);
  b.B(g, 0.42, 0.05, 0.42, 0, 0.43, 0, seat);
  b.B(g, 0.4, 0.34, 0.04, 0, 0.5, -0.19, seat);
  [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ].forEach(([sx, sz]) => {
    b.C(g, 0.015, 0.012, 0.44, sx, 0, sz, leg, 8);
  });
}

export function drape(b: Builder, g: THREE.Object3D, x: number, w: number, h: number, mat: THREE.Material) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * (b.lowPoly ? 20 : 40))), 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * Math.PI * w * 9) * 0.025);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, 0.02 + h / 2, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.slot = b.tag;
  g.add(m);
}

/** cushion colour that goes with the main fabric */
export function accentFor(hex?: string) {
  const map: Record<string, string> = {
    '#c6c5c1': '#97ad94',
    '#9a9b9c': '#97ad94',
    '#d6c8b0': '#7f7b4e',
    '#e8dcc6': '#7f7b4e',
    '#2f3f5c': '#c9a23f',
    '#55585b': '#c9a23f',
  };
  return (hex && map[hex.toLowerCase()]) || '#8a9a86';
}

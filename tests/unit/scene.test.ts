import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Product, Project, SlotId } from '../../src/types';
import { DEMO } from '../../src/data/demo';
import { fromTemplate } from '../../src/data/templates';
import { autoLayout } from '../../src/domain/layout';
import { activeSlots } from '../../src/domain/slots';
import { dimsOf } from '../../src/domain/selection';
import { buildApartment } from '../../src/three/build';
import { Materials } from '../../src/three/materials';
import { Models } from '../../src/three/models';

/**
 * Regression test of the 3D builder without a GPU: the scene is built in Node from made-up products with fixed
 * sizes (so the daily catalogue changes cannot move it), and every piece is reduced to its mesh count and its
 * bounding box to the centimetre. A change to how anything is built or placed shows up as a snapshot diff.
 * Screenshots of WebGL would differ between a laptop GPU and CI's software renderer; geometry does not.
 */
const product = (slot: SlotId): Product => ({ id: slot, slot, store: 't', name: slot, url: '', price: 1, color: '', hex: '#8a8a8a' });

function fingerprint(p: Project, wallH: number) {
  const D = (s: SlotId) => dimsOf(product(s), s);
  const active = new Set(activeSlots(p).map(s => s.id));
  const f = { product: (s: SlotId) => (active.has(s) ? product(s) : undefined), dims: D, layout: autoLayout(p, D) };
  const root = buildApartment(p, f, { wallH }, new Materials(), new Models());
  root.updateMatrixWorld(true);
  const by = new Map<string, { n: number; box: THREE.Box3 }>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const key = (m.userData.slot as string) || (m.userData.room ? 'floor' : 'shell');
    const e = by.get(key) || { n: 0, box: new THREE.Box3() };
    e.n++;
    e.box.expandByObject(m);
    by.set(key, e);
  });
  const cm = (v: number) => Math.round(v * 100);
  return Object.fromEntries(
    [...by]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, { n, box }]) => [
        k,
        `${n} meshes · x ${cm(box.min.x)}..${cm(box.max.x)} · y ${cm(box.min.y)}..${cm(box.max.y)} · z ${cm(box.min.z)}..${cm(box.max.z)}`,
      ]),
  );
}

describe('3D scene (geometry snapshot)', () => {
  it('the demo flat, full height', () => {
    expect(fingerprint(DEMO, DEMO.wallHeight)).toMatchSnapshot();
  });
  it('the demo flat, low walls of the overview', () => {
    expect(fingerprint(DEMO, 1.05)).toMatchSnapshot();
  });
  it('the two-room template', () => {
    const p = fromTemplate('tworoom', 'T', 'rs');
    expect(fingerprint(p, p.wallHeight)).toMatchSnapshot();
  });
});

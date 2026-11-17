import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pieceObject } from '../../src/three/ar';

describe('piece for augmented reality', () => {
  it('copies one piece’s meshes, stands it on the floor and centres it', () => {
    const root = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, slot: string) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
      m.position.set(x, y, z);
      m.userData.slot = slot;
      root.add(m);
      return m;
    };
    box(2, 0.4, 0.9, 3, 0.2, 5, 'sofa');
    box(2, 0.5, 0.2, 3, 0.65, 5.35, 'sofa');
    box(1, 1, 1, 0, 0.5, 0, 'table');
    root.position.set(1, 0, 1);
    const p = pieceObject(root, 'sofa')!;
    expect(p.children).toHaveLength(2);
    const b = new THREE.Box3().setFromObject(p);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 5);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 5);
    const size = b.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(2, 5);
    expect(size.y).toBeCloseTo(0.9, 5);
    expect(size.z).toBeCloseTo(0.9, 5);
    expect(pieceObject(root, 'bed')).toBeNull();
  });
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Free CC0 models from Poly Haven (plants, ceiling lamp, vase, terrace set). Primitive fallbacks are used until they load. */
export const MODEL_NAMES = ['potted_plant_02', 'potted_plant_04', 'modern_ceiling_lamp_01', 'outdoor_table_chair_set_01', 'ceramic_vase_01'] as const;
export type ModelName = typeof MODEL_NAMES[number];

export class Models {
  private src = new Map<string, THREE.Object3D>();
  private loading: Promise<void> | null = null;

  load(base: string): Promise<void> {
    if (this.loading) return this.loading;
    const loader = new GLTFLoader();
    this.loading = Promise.all(MODEL_NAMES.map(n => loader.loadAsync(`${base}models/${n}/${n}.json`).then(g => {
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.src.set(n, g.scene);
    }).catch(() => { /* keep the primitive fallback */ }))).then(() => undefined);
    return this.loading;
  }

  get ready() { return this.src.size > 0; }
  /** All loaded models in one group (not added to any scene), to compile their shaders ahead of time. */
  sample() { const g = new THREE.Group(); for (const m of this.src.values()) g.add(m.clone(true)); return g; }

  /** Place a copy with its bottom at y, centred at (x, z), scaled to height h or largest width w (metres). */
  place(parent: THREE.Object3D, name: ModelName, x: number, y: number, z: number, o: { h?: number; w?: number; ry?: number; tint?: string; tag?: string | null } = {}): boolean {
    const src = this.src.get(name); if (!src) return false;
    const m = src.clone(true);
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    const sc = o.h ? o.h / size.y : o.w ? o.w / Math.max(size.x, size.z) : 1; m.scale.setScalar(sc);
    if (o.ry) m.rotation.y = o.ry;
    const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3());
    m.position.set(x - c.x, y - b2.min.y, z - c.z);
    const tag = o.tag ?? null;
    m.traverse(c2 => {
      const mesh = c2 as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.userData.slot = tag;
      if (o.tint) { const mat = (mesh.material as THREE.MeshStandardMaterial).clone(); mat.color = new THREE.Color(o.tint); mesh.material = mat; }
    });
    parent.add(m); return true;
  }
}

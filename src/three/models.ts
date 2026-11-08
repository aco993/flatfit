import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Free CC0 models from Poly Haven. Decoration (plants, lamp, vase, terrace set) is placed at a natural size;
 * furniture is fitted to the chosen product's width, depth and height and recoloured to its colour.
 * Poly Haven has modern models only for some pieces (dining chair, armchair, round coffee table, low cabinet,
 * side table); sofas, beds and wardrobes stay procedural rather than shown as a period piece the store does not sell.
 * Everything loads lazily; the procedural pieces are used until then, or if a file fails.
 */
export const MODEL_NAMES = ['potted_plant_02', 'potted_plant_04', 'modern_ceiling_lamp_01', 'outdoor_table_chair_set_01', 'ceramic_vase_01',
  'dining_chair_02', 'modern_arm_chair_01', 'coffee_table_round_01', 'modern_wooden_cabinet', 'side_table_01'] as const;
export type ModelName = typeof MODEL_NAMES[number];

/**
 * How a furniture model takes the product's colour: which texels of which material are recoloured
 * ('light': only bright texels such as a marble top; 'notDark': all but near-black legs; 'all').
 * `ry` turns the model so its front faces +z like the procedural pieces.
 */
const FIT: Partial<Record<ModelName, { tint: Record<string, 'light' | 'notDark' | 'all'>; ry: number }>> = {
  dining_chair_02: { tint: { dining_chair_02: 'notDark' }, ry: 0 },
  modern_arm_chair_01: { tint: { modern_arm_chair_01_pillow: 'all' }, ry: 0 },
  coffee_table_round_01: { tint: { coffee_table_round_01: 'light' }, ry: 0 },
  modern_wooden_cabinet: { tint: { modern_wooden_cabinet: 'notDark' }, ry: 0 },
  side_table_01: { tint: { side_table_01: 'notDark' }, ry: 0 },
};

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export class Models {
  private src = new Map<string, THREE.Object3D>();
  private loading: Promise<void> | null = null;
  private tinted = new Map<string, THREE.Material>();

  load(base: string): Promise<void> {
    if (this.loading) return this.loading;
    const loader = new GLTFLoader();
    this.loading = Promise.all(MODEL_NAMES.map(n => loader.loadAsync(`${base}models/${n}/${n}.json`).then(g => {
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.src.set(n, g.scene);
    }).catch(() => { /* keep the procedural fallback */ }))).then(() => undefined);
    return this.loading;
  }

  get ready() { return this.src.size > 0; }
  has(name: ModelName) { return this.src.has(name); }
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

  /**
   * Furniture: a copy stretched to exactly w × h × d (x × y × z, metres) with its bottom centre at (x, y, z) of
   * `parent`, front towards +z, recoloured to `hex`. Returns false while the model is not loaded.
   */
  fit(parent: THREE.Object3D, name: ModelName, w: number, h: number, d: number, x: number, y: number, z: number, hex: string | undefined, tag: string | null): boolean {
    const src = this.src.get(name), cfg = FIT[name]; if (!src || !cfg) return false;
    const inner = src.clone(true), holder = new THREE.Group();
    inner.rotation.y = cfg.ry; holder.add(inner);
    const b = new THREE.Box3().setFromObject(holder), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) return false;
    inner.position.set(-c.x, -b.min.y, -c.z);
    const scaled = new THREE.Group(); scaled.add(holder); scaled.scale.set(w / size.x, h / size.y, d / size.z); scaled.position.set(x, y, z);
    inner.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.userData.slot = tag;
      const mat = mesh.material as THREE.MeshStandardMaterial, mode = cfg.tint[mat.name];
      if (mode && hex) mesh.material = this.recolour(mat, hex, mode);
    });
    parent.add(scaled); return true;
  }

  /**
   * A copy of the material whose colour texture is repainted in `hex`, keeping the texture's light and dark
   * detail. Done on a canvas, not in a shader, so the path tracer (which reads plain maps) sees the same colour.
   */
  private recolour(mat: THREE.MeshStandardMaterial, hex: string, mode: 'light' | 'notDark' | 'all'): THREE.Material {
    const key = `${mat.uuid}|${hex}|${mode}`, hit = this.tinted.get(key); if (hit) return hit;
    const out = mat.clone(), img = mat.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!img || typeof document === 'undefined') { out.color = new THREE.Color(hex); this.tinted.set(key, out); return out; }
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, cv.width, cv.height), px = data.data;
    const inMask = (l: number) => mode === 'all' || (mode === 'light' ? l > 0.42 : l > 0.08);
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) { const l = lum(px[i], px[i + 1], px[i + 2]); if (inMask(l)) { sum += l; n++; } }
    const mean = n ? sum / n : 0.5, rgb = parseInt(hex.replace('#', ''), 16) || 0xcccccc; // sRGB bytes, like the texture
    const tr = rgb >> 16, tg = (rgb >> 8) & 255, tb = rgb & 255;
    for (let i = 0; i < px.length; i += 4) {
      const l = lum(px[i], px[i + 1], px[i + 2]); if (!inMask(l)) continue;
      // keep 60 % of the texture's relative light and dark around the product colour
      const k = Math.max(0.55, Math.min(1.35, 1 + (l / mean - 1) * 0.6));
      px[i] = Math.min(255, tr * k); px[i + 1] = Math.min(255, tg * k); px[i + 2] = Math.min(255, tb * k);
    }
    g.putImageData(data, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.flipY = mat.map!.flipY; t.wrapS = mat.map!.wrapS; t.wrapT = mat.map!.wrapT; t.anisotropy = 4;
    out.map = t; out.color = new THREE.Color(1, 1, 1);
    this.tinted.set(key, out); return out;
  }
}

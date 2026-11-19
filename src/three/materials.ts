import * as THREE from 'three';

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const isBrowser = typeof document !== 'undefined';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  if (!isBrowser) return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * A normal map made from a height map drawn on a canvas (white = high): the light then catches the weave of a
 * fabric or the joints of a floor, instead of the surface looking printed on.
 */
function normalTex(size: number, drawHeight: (g: CanvasRenderingContext2D, w: number, h: number) => void, strength: number) {
  if (!isBrowser) return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  drawHeight(g, size, size);
  const src = g.getImageData(0, 0, size, size).data,
    out = g.createImageData(size, size),
    o = out.data;
  const hAt = (x: number, y: number) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength,
        dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength,
        len = Math.hypot(dx, dy, 1),
        i = (y * size + x) * 4;
      o[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      o[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      o[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Wood floor tones: the darkest plank colour; each plank adds up to 30 to it. */
export const WOOD = {
  light: [196, 170, 132],
  natural: [138, 108, 76],
  grey: [150, 144, 136],
  dark: [92, 64, 44],
} as const satisfies Record<string, readonly [number, number, number]>;
export type WoodTone = keyof typeof WOOD;

/** Oak planks in a tone: rows of boards with a half-board offset, grain lines and dark joints. */
function wood(c: readonly [number, number, number]) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rand(7),
      ph = h / 4;
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * w * 0.5;
      for (let k = -1; k < 2; k++) {
        const x = k * w + off,
          tone = r() * 30;
        g.fillStyle = `rgb(${c[0] + tone},${c[1] + tone},${c[2] + tone})`;
        g.fillRect(x, row * ph, w, ph);
        for (let l = 0; l < 18; l++) {
          g.strokeStyle = `rgba(60,38,20,${0.08 + r() * 0.12})`;
          g.lineWidth = 1 + r() * 2;
          const y = row * ph + r() * ph;
          g.beginPath();
          g.moveTo(x, y);
          g.bezierCurveTo(x + w * 0.3, y + (r() - 0.5) * 10, x + w * 0.6, y + (r() - 0.5) * 10, x + w, y + (r() - 0.5) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(50,32,18,.55)';
        g.fillRect(x, row * ph, 2, ph);
      }
      g.fillStyle = 'rgba(50,32,18,.55)';
      g.fillRect(0, row * ph, w, 2);
    }
  });
}

// floors
export type FloorKind = 'oak' | 'oak-light' | 'oak-grey' | 'oak-dark' | 'marble' | 'tile' | 'bathTile';
export const TEX = {
  oak: () => wood(WOOD.natural),
  'oak-light': () => wood(WOOD.light),
  'oak-grey': () => wood(WOOD.grey),
  'oak-dark': () => wood(WOOD.dark),
  marble: () =>
    canvasTex(512, 512, (g, w, h) => {
      const r = rand(3);
      g.fillStyle = '#eeeeec';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = `rgba(120,122,125,${0.15 + r() * 0.35})`;
        g.lineWidth = 0.6 + r() * 2.2;
        g.beginPath();
        let x = r() * w,
          y = 0;
        g.moveTo(x, y);
        while (y < h) {
          x += (r() - 0.35) * 60;
          y += 30 + r() * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.strokeStyle = 'rgba(150,150,150,.35)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
    }),
  tile: () =>
    canvasTex(256, 256, (g, w, h) => {
      const r = rand(11);
      g.fillStyle = '#45484b';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.03)`;
        g.fillRect(r() * w, r() * h, 6, 6);
      }
      g.strokeStyle = 'rgba(20,20,20,.6)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
    }),
  bathTile: () =>
    canvasTex(256, 256, (g, w, h) => {
      const r = rand(13);
      g.fillStyle = '#d9d7d2';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.04})`;
        g.fillRect(r() * w, r() * h, 4, 4);
      }
      g.strokeStyle = 'rgba(120,120,120,.5)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
    }),
  // grey detail maps; colour comes from the material
  /** threads crossing every 4 px: raised over, sunk under, like a plain weave */
  fabricNormal: () =>
    normalTex(
      256,
      (g, w, h) => {
        g.fillStyle = '#808080';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 4)
          for (let x = 0; x < w; x += 4) {
            const over = ((x + y) / 4) % 2 === 0;
            g.fillStyle = over ? '#d0d0d0' : '#404040';
            g.fillRect(x, y, 3, 3);
          }
      },
      2.2,
    ),
  /** the joints between the floor boards, laid out exactly like wood() so the grooves sit on the board edges */
  oakNormal: () =>
    normalTex(
      512,
      (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#000000';
        const ph = h / 4;
        for (let row = 0; row < 4; row++) {
          const off = (row % 2) * w * 0.5;
          for (let k = -1; k < 2; k++) g.fillRect(k * w + off, row * ph, 2, ph);
          g.fillRect(0, row * ph, w, 2);
        }
      },
      3,
    ),
  fabric: () =>
    canvasTex(256, 256, (g, w, h) => {
      const r = rand(5);
      g.fillStyle = '#ebebeb';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
        g.fillRect(0, y, w, 1);
      }
      for (let x = 0; x < w; x += 2) {
        g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
        g.fillRect(x, 0, 1, h);
      }
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    }),
  grain: () =>
    canvasTex(256, 256, (g, w, h) => {
      const r = rand(9);
      g.fillStyle = '#e6e6e6';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = `rgba(40,30,20,${0.05 + r() * 0.14})`;
        g.lineWidth = 0.5 + r() * 2;
        const y = r() * h;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 14, w * 0.7, y + (r() - 0.5) * 14, w, y);
        g.stroke();
      }
    }),
  weave: () =>
    canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#d8d8d8';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16)
        for (let x = 0; x < w; x += 16) {
          const o = ((x + y) / 16) % 2;
          g.fillStyle = o ? '#f2f2f2' : '#bdbdbd';
          g.fillRect(x + 1, y + 1, 14, 6);
          g.fillStyle = o ? '#bdbdbd' : '#f2f2f2';
          g.fillRect(x + 1, y + 9, 14, 6);
        }
    }),
};

export type Kind =
  | 'fabric'
  | 'drape'
  | 'wood'
  | 'lacquer'
  | 'gloss'
  | 'metal'
  | 'stone'
  | 'screen'
  | 'rattan'
  | 'plain'
  | 'glass'
  | 'emissive';

export class Materials {
  private cache = new Map<string, THREE.Material>();
  private tex: Partial<Record<keyof typeof TEX, THREE.Texture>> = {};
  private t(k: keyof typeof TEX) {
    this.tex[k] ??= TEX[k]();
    return this.tex[k];
  }

  /** Material for a surface kind; `hex` is an sRGB colour such as "#c9a679". */
  get(hex: string, kind: Kind = 'lacquer', opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = kind + hex + JSON.stringify(opts);
    const hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const o: THREE.MeshStandardMaterialParameters = { color: new THREE.Color(hex || '#d9d6d0'), roughness: 0.7, metalness: 0 };
    if (kind === 'fabric') {
      const m = this.t('fabric').clone();
      m.repeat.set(3, 3);
      o.map = m;
      const n = this.t('fabricNormal').clone();
      n.repeat.set(10, 10);
      o.normalMap = n;
      o.normalScale = new THREE.Vector2(0.55, 0.55);
      o.roughness = 0.95;
    } else if (kind === 'drape') {
      const m = this.t('fabric').clone();
      m.repeat.set(3, 3);
      o.map = m;
      o.roughness = 0.95;
      o.side = THREE.DoubleSide;
    } else if (kind === 'wood') {
      o.map = this.t('grain');
      o.roughness = 0.55;
    } else if (kind === 'rattan') {
      const m = this.t('weave').clone();
      m.repeat.set(4, 4);
      o.map = m;
      o.roughness = 0.85;
    } else if (kind === 'gloss') o.roughness = 0.16;
    else if (kind === 'lacquer') o.roughness = 0.42;
    else if (kind === 'stone') o.roughness = 0.28;
    else if (kind === 'metal') {
      o.roughness = 0.38;
      o.metalness = 0.75;
    } else if (kind === 'screen') {
      o.roughness = 0.12;
      o.metalness = 0.3;
    } else if (kind === 'glass') {
      o.roughness = 0.03;
      o.transparent = true;
      o.opacity = 0.18;
      o.depthWrite = false;
    } else if (kind === 'emissive') {
      o.emissive = new THREE.Color(hex);
      o.emissiveIntensity = 1.2;
    }
    Object.assign(o, opts);
    const m = new THREE.MeshStandardMaterial(o);
    if (kind === 'fabric' || kind === 'drape') m.userData.soft = true;
    this.cache.set(key, m);
    return m;
  }

  /** Floor material sized to a room; cached, so rebuilding the scene (every drag and swap) does not pile up textures. */
  floor(kind: FloorKind, w: number, d: number) {
    const key = `floor|${kind}|${w.toFixed(2)}|${d.toFixed(2)}`,
      hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const size = kind.startsWith('oak')
      ? [1.2, 0.8]
      : { marble: [0.6, 0.6], tile: [0.45, 0.45], bathTile: [0.3, 0.3] }[kind as 'marble' | 'tile' | 'bathTile'];
    const t = this.t(kind).clone();
    t.needsUpdate = true;
    t.repeat.set(w / size[0], d / size[1]);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'marble' ? 0.22 : kind.startsWith('oak') ? 0.5 : 0.45 });
    if (kind.startsWith('oak')) {
      const n = this.t('oakNormal').clone();
      n.needsUpdate = true;
      n.repeat.copy(t.repeat);
      m.normalMap = n;
      m.normalScale = new THREE.Vector2(0.8, 0.8);
    }
    this.cache.set(key, m);
    return m;
  }

  dispose() {
    this.cache.forEach(m => {
      m.dispose();
    });
    this.cache.clear();
  }
}

/** Woody colours get a grain texture, others a plain lacquer finish. */
export function isWood(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const n = parseInt(hex.slice(1), 16),
    r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255;
  return r > g && g > b && r - b > 40;
}

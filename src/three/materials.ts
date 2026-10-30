import * as THREE from 'three';

function rand(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const isBrowser = typeof document !== 'undefined';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  if (!isBrowser) return new THREE.Texture();
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// floors
export const TEX = {
  oak: () => canvasTex(512, 512, (g, w, h) => {
    const r = rand(7), ph = h / 4;
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * w * 0.5;
      for (let k = -1; k < 2; k++) {
        const x = k * w + off, tone = 110 + r() * 30;
        g.fillStyle = `rgb(${tone + 28},${tone - 2},${tone - 34})`; g.fillRect(x, row * ph, w, ph);
        for (let l = 0; l < 18; l++) { g.strokeStyle = `rgba(60,38,20,${0.08 + r() * 0.12})`; g.lineWidth = 1 + r() * 2; const y = row * ph + r() * ph; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + w * .3, y + (r() - .5) * 10, x + w * .6, y + (r() - .5) * 10, x + w, y + (r() - .5) * 6); g.stroke(); }
        g.fillStyle = 'rgba(50,32,18,.55)'; g.fillRect(x, row * ph, 2, ph);
      }
      g.fillStyle = 'rgba(50,32,18,.55)'; g.fillRect(0, row * ph, w, 2);
    }
  }),
  marble: () => canvasTex(512, 512, (g, w, h) => {
    const r = rand(3); g.fillStyle = '#eeeeec'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { g.strokeStyle = `rgba(120,122,125,${0.15 + r() * 0.35})`; g.lineWidth = 0.6 + r() * 2.2; g.beginPath(); let x = r() * w, y = 0; g.moveTo(x, y); while (y < h) { x += (r() - .35) * 60; y += 30 + r() * 40; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(150,150,150,.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  }),
  tile: () => canvasTex(256, 256, (g, w, h) => {
    const r = rand(11); g.fillStyle = '#45484b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${r() > .5 ? 255 : 0},${r() > .5 ? 255 : 0},${r() > .5 ? 255 : 0},0.03)`; g.fillRect(r() * w, r() * h, 6, 6); }
    g.strokeStyle = 'rgba(20,20,20,.6)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  }),
  bathTile: () => canvasTex(256, 256, (g, w, h) => {
    const r = rand(13); g.fillStyle = '#d9d7d2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.04})`; g.fillRect(r() * w, r() * h, 4, 4); }
    g.strokeStyle = 'rgba(120,120,120,.5)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  }),
  // grey detail maps; colour comes from the material
  fabric: () => canvasTex(256, 256, (g, w, h) => {
    const r = rand(5); g.fillStyle = '#ebebeb'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
  }),
  grain: () => canvasTex(256, 256, (g, w, h) => {
    const r = rand(9); g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(40,30,20,${0.05 + r() * 0.14})`; g.lineWidth = 0.5 + r() * 2; const y = r() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * .3, y + (r() - .5) * 14, w * .7, y + (r() - .5) * 14, w, y); g.stroke(); }
  }),
  weave: () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const o = ((x + y) / 16) % 2; g.fillStyle = o ? '#f2f2f2' : '#bdbdbd'; g.fillRect(x + 1, y + 1, 14, 6); g.fillStyle = o ? '#bdbdbd' : '#f2f2f2'; g.fillRect(x + 1, y + 9, 14, 6); }
  }),
};

export type Kind = 'fabric' | 'drape' | 'wood' | 'lacquer' | 'gloss' | 'metal' | 'stone' | 'screen' | 'rattan' | 'plain' | 'glass' | 'emissive';

export class Materials {
  private cache = new Map<string, THREE.Material>();
  private tex: Partial<Record<keyof typeof TEX, THREE.Texture>> = {};
  private t(k: keyof typeof TEX) { return this.tex[k] || (this.tex[k] = TEX[k]()); }

  /** Material for a surface kind; `hex` is an sRGB colour such as "#c9a679". */
  get(hex: string, kind: Kind = 'lacquer', opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = kind + hex + JSON.stringify(opts);
    const hit = this.cache.get(key); if (hit) return hit as THREE.MeshStandardMaterial;
    const o: THREE.MeshStandardMaterialParameters = { color: new THREE.Color(hex || '#d9d6d0'), roughness: 0.7, metalness: 0 };
    if (kind === 'fabric') { const m = this.t('fabric').clone(); m.repeat.set(3, 3); o.map = m; o.roughness = 0.95; }
    else if (kind === 'drape') { const m = this.t('fabric').clone(); m.repeat.set(3, 3); o.map = m; o.roughness = 0.95; o.side = THREE.DoubleSide; }
    else if (kind === 'wood') { o.map = this.t('grain'); o.roughness = 0.55; }
    else if (kind === 'rattan') { const m = this.t('weave').clone(); m.repeat.set(4, 4); o.map = m; o.roughness = 0.85; }
    else if (kind === 'gloss') o.roughness = 0.16;
    else if (kind === 'lacquer') o.roughness = 0.42;
    else if (kind === 'stone') o.roughness = 0.28;
    else if (kind === 'metal') { o.roughness = 0.38; o.metalness = 0.75; }
    else if (kind === 'screen') { o.roughness = 0.12; o.metalness = 0.3; }
    else if (kind === 'glass') { o.roughness = 0.03; o.transparent = true; o.opacity = 0.18; o.depthWrite = false; }
    else if (kind === 'emissive') { o.emissive = new THREE.Color(hex); o.emissiveIntensity = 1.2; }
    Object.assign(o, opts);
    const m = new THREE.MeshStandardMaterial(o);
    if (kind === 'fabric' || kind === 'drape') m.userData.soft = true;
    this.cache.set(key, m); return m;
  }

  floor(kind: 'oak' | 'marble' | 'tile' | 'bathTile', w: number, d: number) {
    const size = { oak: [1.2, 0.8], marble: [0.6, 0.6], tile: [0.45, 0.45], bathTile: [0.3, 0.3] }[kind];
    const t = this.t(kind).clone(); t.needsUpdate = true; t.repeat.set(w / size[0], d / size[1]);
    return new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'marble' ? 0.22 : kind === 'oak' ? 0.5 : 0.45 });
  }

  dispose() { this.cache.forEach(m => m.dispose()); this.cache.clear(); }
}

/** Woody colours get a grain texture, others a plain lacquer finish. */
export function isWood(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return r > g && g > b && r - b > 40;
}

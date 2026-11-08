import * as THREE from 'three';
import type { WebGLPathTracer as PT } from 'three-gpu-pathtracer';

export type Quality = 'fast' | 'balanced' | 'high';
export const QUALITY: Record<Quality, { maxW: number; samples: number }> = {
  fast: { maxW: 640, samples: 16 },
  balanced: { maxW: 960, samples: 40 },
  high: { maxW: 1440, samples: 128 },
};

/** Weak or unknown GPUs start at "fast"; the user can always pick another level. */
export function suggestQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'fast';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) || /SwiftShader|llvmpipe|Mali|Adreno|PowerVR/i.test(name)) return 'fast';
    if (/Intel|UHD|Iris|Apple GPU/i.test(name)) return 'fast';
    if (/RTX|Radeon RX|Apple M[2-9]|Arc/i.test(name)) return 'high';
    return 'balanced';
  } catch {
    return 'fast';
  }
}

export type Progress =
  | { phase: 'scene' }
  | { phase: 'compile'; seconds: number }
  | { phase: 'samples'; samples: number; target: number; eta: number | null; tiles: number }
  | { phase: 'recover'; attempt: number };

export interface TraceInput {
  root: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  quality: Quality;
  interior: boolean;
  lamps: [number, number, number][];
  onProgress: (p: Progress) => void;
  /** finish now with what is computed so far */
  finish: () => boolean;
  /** abandon completely */
  cancel: () => boolean;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  pt: PT;
  canvas: HTMLCanvasElement;
  lost: boolean;
  async?: boolean;
}
let engine: Engine | null = null;

async function getEngine(): Promise<Engine> {
  if (engine && !engine.lost) return engine;
  const { WebGLPathTracer } = await import('three-gpu-pathtracer');
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const e: Engine = { renderer, pt: new WebGLPathTracer(renderer), canvas, lost: false };
  // build the ray-tracing acceleration structure (BVH) in a Web Worker so the page stays responsive
  try {
    const { GenerateMeshBVHWorker } = await import('three-mesh-bvh/worker');
    e.pt.setBVHWorker(new GenerateMeshBVHWorker());
    e.async = true;
  } catch {
    e.async = false;
  }
  canvas.addEventListener(
    'webglcontextlost',
    ev => {
      ev.preventDefault();
      e.lost = true;
    },
    { once: true },
  );
  engine = e;
  return e;
}

function skyTexture() {
  const EW = 256,
    EH = 128,
    c = document.createElement('canvas');
  c.width = EW;
  c.height = EH;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 0, EH);
  gr.addColorStop(0, '#6f9fd3');
  gr.addColorStop(0.46, '#d7e5f1');
  gr.addColorStop(0.5, '#c8c1b4');
  gr.addColorStop(1, '#7f786d');
  x.fillStyle = gr;
  x.fillRect(0, 0, EW, EH);
  const px = x.getImageData(0, 0, EW, EH).data,
    f = new Float32Array(EW * EH * 4),
    lin = (v: number) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
  for (let yy = 0; yy < EH; yy++)
    for (let xx = 0; xx < EW; xx++) {
      const si = (yy * EW + xx) * 4,
        di = ((EH - 1 - yy) * EW + xx) * 4;
      f[di] = lin(px[si]);
      f[di + 1] = lin(px[si + 1]);
      f[di + 2] = lin(px[si + 2]);
      f[di + 3] = 1;
    }
  const t = new THREE.DataTexture(f, EW, EH, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const outputSize = (cssW: number, cssH: number, q: Quality) => {
  const k = Math.min(1, QUALITY[q].maxW / Math.max(1, cssW));
  return { w: Math.max(64, Math.round(cssW * k)), h: Math.max(48, Math.round(cssH * k)) };
};

/**
 * Path traces the scene. Each call to the GPU covers one tile; the next tile is only queued after the GPU
 * reports the previous one done, so a slow GPU never gets a long batch (which Windows answers with a driver reset).
 * Tile count adapts to the measured time per tile.
 */
export async function trace(inp: TraceInput, target: HTMLCanvasElement): Promise<{ samples: number; canvas: HTMLCanvasElement }> {
  const { samples: goal } = QUALITY[inp.quality];
  const { w, h } = outputSize(inp.width, inp.height, inp.quality);
  let tiles = inp.quality === 'fast' ? 3 : 2;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      inp.onProgress({ phase: 'recover', attempt });
      tiles = Math.min(8, tiles + 2);
      await new Promise(r => setTimeout(r, 2000));
    }
    if (inp.cancel()) throw new Cancelled();
    inp.onProgress({ phase: 'scene' });
    const e = await getEngine();
    const { renderer, pt } = e;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = inp.interior ? 1.25 : 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(inp.root);
    const env = skyTexture();
    scene.environment = env;
    scene.background = env;
    scene.environmentIntensity = inp.interior ? 1.5 : 1.0;
    const sun = new THREE.DirectionalLight(0xfff6ea, 3.0);
    sun.position.set(-3, 10, -7);
    sun.target.position.set(3.5, 0, 3);
    scene.add(sun, sun.target);
    if (inp.interior)
      for (const p of inp.lamps) {
        const l = new THREE.PointLight(0xffe4c4, 3.2, 0, 2);
        l.position.set(...p);
        scene.add(l);
      }
    const cam = inp.camera.clone();
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    pt.multipleImportanceSampling = true;
    pt.rasterizeScene = true;
    pt.bounces = 5;
    pt.transmissiveBounces = 3;
    pt.filterGlossyFactor = 0.5;
    pt.minSamples = 0;
    pt.renderDelay = 0;
    pt.fadeDuration = 0;
    pt.dynamicLowRes = false;
    pt.textureSize.set(512, 512);
    pt.tiles.set(tiles, tiles);
    await new Promise(r => setTimeout(r, 30));
    if (inp.cancel()) {
      scene.remove(inp.root);
      throw new Cancelled();
    }
    if (e.async) await pt.setSceneAsync(scene, cam);
    else pt.setScene(scene, cam);
    pt.reset();
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const t0 = performance.now();
    let tStart = 0,
      sStart = 0,
      sync: WebGLSync | null = null,
      queued = 0,
      slowTiles = 0;
    const result = await new Promise<'done' | 'lost'>((res, rej) => {
      const loop = () => {
        if (inp.cancel()) {
          rej(new Cancelled());
          return;
        }
        if (e.lost || gl.isContextLost()) {
          e.lost = true;
          res('lost');
          return;
        }
        if (sync) {
          if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
            setTimeout(loop, 4);
            return;
          }
          gl.deleteSync(sync);
          sync = null;
          const dt = performance.now() - queued;
          // adapt: long tiles risk a driver reset, so split the image finer at the next full pass
          if (dt > 250) slowTiles++;
          if (Number.isInteger(pt.samples) && slowTiles >= 2 && tiles < 8) {
            tiles++;
            pt.tiles.set(tiles, tiles);
            slowTiles = 0;
          }
        }
        if (inp.finish() || pt.samples >= goal) {
          res('done');
          return;
        }
        pt.renderSample();
        if ((pt as unknown as { isCompiling: boolean }).isCompiling)
          inp.onProgress({ phase: 'compile', seconds: Math.round((performance.now() - t0) / 1000) });
        else {
          if (!tStart && pt.samples > 0) {
            tStart = performance.now();
            sStart = pt.samples;
          }
          const rate = tStart && pt.samples > sStart ? (pt.samples - sStart) / ((performance.now() - tStart) / 1000) : 0;
          inp.onProgress({
            phase: 'samples',
            samples: pt.samples,
            target: goal,
            eta: rate ? Math.max(0, Math.round((goal - pt.samples) / rate)) : null,
            tiles,
          });
          sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          queued = performance.now();
        }
        setTimeout(loop, 4);
      };
      loop();
    }).finally(() => {
      scene.remove(inp.root);
      env.dispose();
    });
    if (result === 'lost') {
      engine = null;
      continue;
    }
    target.width = w;
    target.height = h;
    const x = target.getContext('2d')!;
    x.drawImage(e.canvas, 0, 0);
    if (pt.samples > 0 && brightness(target) < 1.5) {
      e.lost = true;
      engine = null;
      continue;
    }
    return { samples: pt.samples, canvas: target };
  }
  throw new Error('gpu-reset');
}

/** Live preview: copy the path tracer canvas while it works. */
export function previewInto(target: HTMLCanvasElement) {
  if (!engine || engine.lost) return;
  const c = engine.canvas;
  if (!c.width) return;
  if (target.width !== c.width) {
    target.width = c.width;
    target.height = c.height;
  }
  target.getContext('2d')!.drawImage(c, 0, 0);
}

export function brightness(c: HTMLCanvasElement) {
  const t = document.createElement('canvas');
  t.width = 48;
  t.height = 24;
  const x = t.getContext('2d')!;
  x.drawImage(c, 0, 0, 48, 24);
  const d = x.getImageData(0, 0, 48, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s / ((d.length / 4) * 3);
}

// ---------- denoising ----------
let unet: any = null;
/** Intel Open Image Denoise (neural network on WebGPU) with albedo + normal guides; throws when WebGPU is missing. */
export async function denoiseOIDN(
  src: HTMLCanvasElement,
  aux: { normal: Uint8ClampedArray; albedo: Uint8ClampedArray },
  base: string,
): Promise<HTMLCanvasElement> {
  if (!('gpu' in navigator)) throw new Error('no-webgpu');
  const { initUNetFromURL } = await import('oidn-web');
  if (!unet) unet = await initUNetFromURL(base + 'oidn/rt_ldr_alb_nrm.tza', undefined, { aux: true, hdr: false });
  const w = src.width,
    h = src.height,
    color = src.getContext('2d')!.getImageData(0, 0, w, h);
  const out: ImageData = await new Promise((res, rej) =>
    unet.tileExecute({
      color,
      albedo: new ImageData(new Uint8ClampedArray(aux.albedo), w, h),
      normal: new ImageData(new Uint8ClampedArray(aux.normal), w, h),
      done: (d: ImageData) => res(d),
      progress: () => {},
      error: (e: unknown) => rej(e),
    }),
  );
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(out instanceof ImageData ? out : new ImageData(new Uint8ClampedArray((out as any).data), w, h), 0, 0);
  if (brightness(c) < 1.5) throw new Error('empty');
  return c;
}

/** Fallback: remove lone outlier pixels (3×3 median test), then edge-preserving bilateral smoothing. */
export function denoiseFilter(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width,
    h = src.height,
    c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  const im = x.getImageData(0, 0, w, h),
    d = im.data,
    L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  const a = new Uint8ClampedArray(d),
    nb = new Float32Array(9);
  for (let y = 1; y < h - 1; y++)
    for (let xx = 1; xx < w - 1; xx++) {
      let n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) nb[n++] = L[(y + j) * w + xx + i];
      const med = Array.from(nb).sort((p, q) => p - q)[4],
        v = L[y * w + xx];
      if (v < med * 0.62 - 4 || v > med * 1.6 + 12) {
        let r = 0,
          g = 0,
          b = 0,
          k = 0;
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const q = (y + j) * w + xx + i;
            if (Math.abs(L[q] - med) <= Math.max(10, med * 0.25)) {
              r += d[q * 4];
              g += d[q * 4 + 1];
              b += d[q * 4 + 2];
              k++;
            }
          }
        if (k) {
          const o = (y * w + xx) * 4;
          a[o] = r / k;
          a[o + 1] = g / k;
          a[o + 2] = b / k;
        }
      }
    }
  const o = new Uint8ClampedArray(d.length),
    R = 2,
    ss = 2 * 1.8 * 1.8,
    sr = 2 * 22 * 22,
    sp: [number, number, number][] = [];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) sp.push([i, j, Math.exp(-(i * i + j * j) / ss)]);
  for (let y = 0; y < h; y++)
    for (let xx = 0; xx < w; xx++) {
      const k = (y * w + xx) * 4,
        r0 = a[k],
        g0 = a[k + 1],
        b0 = a[k + 2];
      let ws = 0,
        r = 0,
        g = 0,
        b = 0;
      for (const [i, j, wsp] of sp) {
        const yy = Math.min(h - 1, Math.max(0, y + j)),
          x2 = Math.min(w - 1, Math.max(0, xx + i)),
          q = (yy * w + x2) * 4;
        const dr = a[q] - r0,
          dg = a[q + 1] - g0,
          db = a[q + 2] - b0;
        const wt = wsp * Math.exp(-(dr * dr + dg * dg + db * db) / (3 * sr));
        ws += wt;
        r += a[q] * wt;
        g += a[q + 1] * wt;
        b += a[q + 2] * wt;
      }
      o[k] = r / ws;
      o[k + 1] = g / ws;
      o[k + 2] = b / ws;
      o[k + 3] = 255;
    }
  im.data.set(o);
  x.putImageData(im, 0, 0);
  return c;
}

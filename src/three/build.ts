import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Placement, Product, Project, SlotId } from '../types';
import { WALL_T, deriveWalls, edgeOf, inward } from '../domain/geometry';
import type { Dims, Layout } from '../domain/layout';
import { type FloorKind, type Materials, type WoodTone, isWood, type Kind } from './materials';

const floorKind = (k: 'oak' | 'marble' | 'tile' | 'bathTile', tone?: WoodTone): FloorKind =>
  k === 'oak' && tone && tone !== 'natural' ? `oak-${tone}` : k;
import type { Models } from './models';
import { type FurnishCtx, hexOf } from './furniture/context';
import { bedroom } from './furniture/bedroom';
import { dining } from './furniture/dining';
import { kitchen } from './furniture/kitchen';
import { living } from './furniture/living';
import { rest } from './furniture/rest';

export interface BuildOptions {
  /** wall height actually drawn: low "doll-house" walls for the overview, full height inside */
  wallH: number;
  lowPoly?: boolean;
  /** paint colour of the walls (#rrggbb); off-white when not chosen */
  wallHex?: string;
  /** tone of the wood floors (living rooms, bedrooms); natural oak when not chosen */
  floor?: WoodTone;
  ceiling?: boolean;
}
export interface Furnish {
  product: (s: SlotId) => Product | undefined;
  dims: (s: SlotId) => Dims;
  layout: Layout;
}

const FLOOR: Record<string, 'oak' | 'marble' | 'tile' | 'bathTile'> = {
  living: 'oak',
  bedroom: 'oak',
  dining: 'marble',
  kitchen: 'marble',
  hall: 'marble',
  bathroom: 'tile',
  terrace: 'tile',
};

/** Small helper that adds tagged meshes; the tag (slot id) is what a click on the 3D view selects. */
/** Rounded boxes are the costly part of a build; identical sizes (legs, fins, doors) share one geometry across builds. */
const GEO = new Map<string, THREE.BufferGeometry>();
export class Builder {
  tag: SlotId | null = null;
  constructor(
    public M: Materials,
    public lowPoly = false,
  ) {}
  private geo(w: number, h: number, d: number, soft: boolean) {
    const s = Math.min(w, h, d),
      seg = this.lowPoly ? (soft ? 2 : 1) : soft ? 4 : 2;
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${s > 0.025 ? seg : 0}|${soft ? 1 : 0}`;
    let g = GEO.get(key);
    if (!g) {
      if (GEO.size > 4000) {
        for (const x of GEO.values()) x.dispose();
        GEO.clear();
      }
      g = s > 0.025 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(soft ? 0.045 : 0.008, s / 2 - 0.002)) : new THREE.BoxGeometry(w, h, d);
      g.userData.shared = true;
      GEO.set(key, g);
    }
    return g;
  }
  /** box with its bottom centre at (x, y, z) */
  B(
    g: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    o: { ry?: number; rx?: number; rz?: number; shadow?: boolean } = {},
  ) {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const m = new THREE.Mesh(this.geo(w, h, d, !!mat.userData?.soft), mat);
    m.position.set(x, y + h / 2, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.shadow !== false;
    m.receiveShadow = true;
    m.userData.slot = this.tag;
    g.add(m);
    return m;
  }
  C(g: THREE.Object3D, rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 24) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, this.lowPoly ? Math.min(seg, 16) : seg), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.slot = this.tag;
    g.add(m);
    return m;
  }
  S(g: THREE.Object3D, r: number, x: number, y: number, z: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.userData.slot = this.tag;
    g.add(m);
    return m;
  }
  group(parent: THREE.Object3D, x: number, z: number, rot: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    parent.add(g);
    return g;
  }
}

export function buildApartment(p: Project, f: Furnish | null, opt: BuildOptions, M: Materials, models: Models): THREE.Group {
  const root = new THREE.Group();
  root.name = 'apartment';
  const b = new Builder(M, opt.lowPoly);
  const H = opt.wallH,
    full = H > 2;
  const WALL = M.get(opt.wallHex || '#f2f1ed', 'plain', { roughness: 0.92 }),
    FRAME = M.get('#fafafa', 'plain', { roughness: 0.4 }),
    GLASS = M.get('#d8e6ee', 'glass');

  // floors and ground
  for (const r of p.rooms) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), M.floor(floorKind(FLOOR[r.type] || 'oak', opt.floor), r.w, r.d));
    m.rotation.x = -Math.PI / 2;
    m.position.set(r.x + r.w / 2, 0.001, r.z + r.d / 2);
    m.receiveShadow = true;
    m.userData.room = r.id;
    root.add(m);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), M.get('#bdb9b2', 'plain', { roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  root.add(ground);

  // walls with openings
  const walls = deriveWalls(p);
  for (const w of walls) {
    const h = w.kind === 'parapet' ? Math.min(1.0, H) : H,
      th = w.kind === 'parapet' ? 0.18 : WALL_T;
    const mat = w.kind === 'parapet' ? M.get('#e4e2dd', 'plain') : WALL;
    const seg = (a: number, e: number, y0: number, y1: number) => {
      if (e - a <= 0.001 || y1 - y0 <= 0.001) return;
      const L = e - a,
        mid = (a + e) / 2;
      if (w.axis === 'x') b.B(root, L, y1 - y0, th, mid, y0, w.c, mat);
      else b.B(root, th, y1 - y0, L, w.c, y0, mid, mat);
    };
    let pos = w.a1 - th / 2;
    const end = w.a2 + th / 2;
    for (const o of w.openings) {
      seg(pos, o.a, 0, h);
      seg(o.a, o.b, 0, Math.min(o.lo, h));
      if (o.hi < h) seg(o.a, o.b, o.hi, h);
      if (o.glass && o.lo < h) {
        const top = Math.min(o.hi, h),
          L = o.b - o.a,
          mid = (o.a + o.b) / 2;
        if (w.axis === 'x') {
          b.B(root, L, top - o.lo, 0.02, mid, o.lo, w.c, GLASS, { shadow: false });
          b.B(root, L, 0.04, 0.2, mid, o.lo - 0.03, w.c, FRAME);
        } else {
          b.B(root, 0.02, top - o.lo, L, w.c, o.lo, mid, GLASS, { shadow: false });
          b.B(root, 0.2, 0.04, L, w.c, o.lo - 0.03, mid, FRAME);
        }
        const n = Math.max(1, Math.round(L / 0.62));
        for (let k = 0; k <= n; k++) {
          const t = o.a + (L * k) / n;
          if (w.axis === 'x') b.B(root, 0.05, top - o.lo, 0.08, t, o.lo, w.c, FRAME);
          else b.B(root, 0.08, top - o.lo, 0.05, w.c, o.lo, t, FRAME);
        }
        if (top < h) {
          if (w.axis === 'x') b.B(root, L, 0.05, 0.08, mid, top - 0.05, w.c, FRAME);
          else b.B(root, 0.08, 0.05, L, w.c, top - 0.05, mid, FRAME);
        }
      }
      if (!o.glass && o.lo === 0) {
        // door leaf: interior doors stand open into the room, the entrance door is closed
        const L = o.b - o.a;
        const DOOR = o.kind === 'entry' ? M.get('#6b4a2f', 'wood') : M.get('#f4f4f2', 'lacquer');
        const dh = Math.min(2.03, h - 0.01);
        if (o.kind === 'entry') {
          if (w.axis === 'x') b.B(root, L, dh, 0.05, (o.a + o.b) / 2, 0, w.c, DOOR);
          else b.B(root, 0.05, dh, L, w.c, 0, (o.a + o.b) / 2, DOOR);
        } else {
          // leaf opened a little past 90° into the room that owns the door, hinged at the start of the opening
          const hinge = new THREE.Group();
          const [nx, nz] = inward(o.side || 'n'),
            past = 0.12;
          if (w.axis === 'x') {
            hinge.position.set(o.a, 0, w.c);
            hinge.rotation.y = -nz * (Math.PI / 2 + past);
          } else {
            hinge.position.set(w.c, 0, o.a);
            hinge.rotation.y = nx > 0 ? -past : Math.PI + past;
          }
          root.add(hinge);
          b.B(hinge, L - 0.02, dh, 0.04, (L - 0.02) / 2, 0.005, 0, DOOR);
          if (h > 1.1) b.B(hinge, 0.13, 0.02, 0.025, L - 0.12, 1.02, 0.035, M.get('#b9bcbf', 'metal'));
        }
      }
      pos = o.b;
    }
    seg(pos, end, 0, h);
    if (w.kind === 'parapet') {
      if (w.axis === 'x') b.B(root, w.a2 - w.a1 + 0.2, 0.03, 0.26, (w.a1 + w.a2) / 2, h, w.c, M.get('#2b2c2e', 'stone'));
      else b.B(root, 0.26, 0.03, w.a2 - w.a1 + 0.2, w.c, h, (w.a1 + w.a2) / 2, M.get('#2b2c2e', 'stone'));
    }
  }
  // radiators and TV sockets on the inner face of their wall
  for (const it of p.wallItems || []) {
    const r = p.rooms.find(x => x.id === it.room);
    if (!r) continue;
    const e = edgeOf(r, it.side),
      [nx, nz] = inward(it.side),
      n = e.axis === 'x' ? nz : nx,
      mid = e.a1 + it.at + it.width / 2;
    const face = e.c + (n * WALL_T) / 2;
    b.tag = null;
    if (it.kind === 'radiator') {
      const RAD = M.get('#f5f5f2', 'lacquer', { roughness: 0.35 }),
        hh = Math.min(0.6, H - 0.2),
        d = 0.08,
        c = face + n * (0.035 + d / 2);
      const fins = Math.max(3, Math.round(it.width / 0.05));
      if (e.axis === 'x') {
        b.B(root, it.width, hh, d * 0.5, mid, 0.15, c - (n * d) / 4, RAD);
        for (let k = 0; k < fins; k++) b.B(root, 0.025, hh, d, mid - it.width / 2 + ((k + 0.5) * it.width) / fins, 0.15, c, RAD);
      } else {
        b.B(root, d * 0.5, hh, it.width, c - (n * d) / 4, 0.15, mid, RAD);
        for (let k = 0; k < fins; k++) b.B(root, d, hh, 0.025, c, 0.15, mid - it.width / 2 + ((k + 0.5) * it.width) / fins, RAD);
      }
    } else {
      const PLATE = M.get('#fbfbf9', 'lacquer'),
        c = face + n * 0.006;
      if (e.axis === 'x') b.B(root, 0.08, 0.08, 0.012, mid, 0.3, c, PLATE, { shadow: false });
      else b.B(root, 0.012, 0.08, 0.08, c, 0.3, mid, PLATE, { shadow: false });
    }
  }
  // ceiling and warm room lights for interior views
  if (full && opt.ceiling !== false) {
    for (const r of p.rooms) {
      if (r.type === 'terrace') continue;
      b.tag = null;
      b.B(root, r.w + WALL_T, 0.08, r.d + WALL_T, r.x + r.w / 2, H, r.z + r.d / 2, WALL, { shadow: true });
      const L = new THREE.PointLight(0xffd8a8, 0.9, 6, 2);
      L.position.set(r.x + r.w / 2, H - 0.35, r.z + r.d / 2);
      L.userData.roomLight = true;
      root.add(L);
    }
  }
  if (f) furnish(root, b, p, f, H, models);
  return root;
}

function furnish(root: THREE.Group, b: Builder, _proj: Project, f: Furnish, H: number, models: Models) {
  const M = b.M;
  const mat = (p: Product | undefined, def: string, kind?: Kind, two = false) => {
    const hex = two ? p?.hex2 || p?.hex || def : hexOf(p, def);
    return M.get(hex, kind || (isWood(hex) ? 'wood' : 'lacquer'));
  };
  const at = (pl: Placement, d: number) => {
    const nx = Math.sin(pl.rot),
      nz = Math.cos(pl.rot);
    return b.group(root, pl.x + (nx * d) / 2, pl.z + (nz * d) / 2, pl.rot);
  };
  const each = (s: SlotId, fn: (pl: Placement) => void) => {
    for (const pl of f.layout.placements) {
      if (pl.slot !== s) continue;
      b.tag = s;
      fn(pl);
      b.tag = null;
    }
  };
  const C: FurnishCtx = {
    root,
    b,
    M,
    f,
    H,
    full: H > 2,
    models,
    BLACK: M.get('#1d1e20', 'lacquer', { roughness: 0.5 }),
    mat,
    at,
    each,
    has: s => !!f.product(s),
  };
  living(C);
  kitchen(C);
  dining(C);
  bedroom(C);
  rest(C);
  b.tag = null;
}

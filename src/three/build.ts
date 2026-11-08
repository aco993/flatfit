import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Placement, Product, Project, SlotId } from '../types';
import { WALL_T, deriveWalls, edgeOf, inward } from '../domain/geometry';
import type { Dims, Layout } from '../domain/layout';
import { type Materials, isWood, type Kind } from './materials';
import type { Models } from './models';

export interface BuildOptions {
  /** wall height actually drawn: low "doll-house" walls for the overview, full height inside */
  wallH: number;
  lowPoly?: boolean;
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
  const WALL = M.get('#f2f1ed', 'plain', { roughness: 0.92 }),
    FRAME = M.get('#fafafa', 'plain', { roughness: 0.4 }),
    GLASS = M.get('#d8e6ee', 'glass');

  // floors and ground
  for (const r of p.rooms) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), M.floor(FLOOR[r.type] || 'oak', r.w, r.d));
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

const hexOf = (p: Product | undefined, def: string) => p?.hex || def;

function furnish(root: THREE.Group, b: Builder, _proj: Project, f: Furnish, H: number, models: Models) {
  const M = b.M,
    full = H > 2;
  const BLACK = M.get('#1d1e20', 'lacquer', { roughness: 0.5 });
  const mat = (p: Product | undefined, def: string, kind?: Kind, two = false) => {
    const hex = two ? p?.hex2 || p?.hex || def : hexOf(p, def);
    return M.get(hex, kind || (isWood(hex) ? 'wood' : 'lacquer'));
  };
  const at = (pl: Placement, d: number) => {
    const nx = Math.sin(pl.rot),
      nz = Math.cos(pl.rot);
    return b.group(root, pl.x + (nx * d) / 2, pl.z + (nz * d) / 2, pl.rot);
  };
  const pls = f.layout.placements;
  const each = (s: SlotId, fn: (pl: Placement) => void) =>
    pls
      .filter(x => x.slot === s)
      .forEach(pl => {
        b.tag = s;
        fn(pl);
        b.tag = null;
      });
  const has = (s: SlotId) => !!f.product(s);

  // ---------- living ----------
  each('sofa', pl => {
    const p = f.product('sofa');
    if (!p) return;
    const D = f.dims('sofa');
    const g = at(pl, Math.min(D.d, 1.05));
    const w = D.w,
      d = Math.min(D.d, p.corner ? 1.0 : 1.05),
      h = D.h,
      seat = 0.44,
      arm = 0.14,
      F = mat(p, '#9a9b9c', 'fabric');
    b.B(g, w, seat - 0.12, d, 0, 0.1, 0, F);
    b.B(g, w - 2 * arm, Math.max(0.2, h - seat), 0.22, 0, seat, -d / 2 + 0.11, F);
    b.B(g, arm, 0.52, d, -w / 2 + arm / 2, 0.1, 0, F);
    b.B(g, arm, 0.52, d, w / 2 - arm / 2, 0.1, 0, F);
    const inner = w - 2 * arm,
      n = inner > 1.75 ? 3 : 2,
      cw = inner / n;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      b.B(g, cw - 0.015, 0.13, d - 0.26, x, seat - 0.03, 0.1, F);
      b.B(g, cw - 0.03, Math.max(0.3, h - seat - 0.06), 0.2, x, seat + 0.06, -d / 2 + 0.32, F, { rx: -0.12 });
    }
    const acc = M.get(accentFor(p.hex), 'fabric');
    b.B(g, 0.4, 0.36, 0.13, -inner / 2 + 0.3, seat + 0.08, -d / 2 + 0.3, acc, { ry: 0.18 });
    b.B(g, 0.38, 0.34, 0.13, inner / 2 - 0.3, seat + 0.08, -d / 2 + 0.3, acc, { ry: -0.12 });
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].forEach(([sx, sz]) => {
      b.C(g, 0.02, 0.015, 0.1, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), BLACK, 8);
    });
    if (p.corner && D.d > 1.05) {
      const cd = D.d - d;
      b.B(g, 0.75, seat - 0.12, cd, w / 2 - 0.38, 0.1, d / 2 + cd / 2, F);
      b.B(g, 0.7, 0.12, cd - 0.05, w / 2 - 0.38, seat - 0.02, d / 2 + cd / 2, F);
    }
  });
  each('armchair', pl => {
    const p = f.product('armchair');
    if (!p) return;
    const D = f.dims('armchair');
    const g = b.group(root, pl.x, pl.z, pl.rot);
    const F = mat(p, '#c6c5c1', 'fabric');
    if (models.fit(g, 'modern_arm_chair_01', D.w, D.h, D.d, 0, 0, 0, hexOf(p, '#c6c5c1'), 'armchair')) return;
    b.B(g, D.w, 0.26, D.d, 0, 0.16, 0, F);
    b.B(g, D.w, Math.max(0.25, D.h - 0.4), 0.12, 0, 0.4, -D.d / 2 + 0.06, F);
    b.B(g, 0.08, 0.2, D.d - 0.1, -D.w / 2 + 0.04, 0.42, 0.02, F);
    b.B(g, 0.08, 0.2, D.d - 0.1, D.w / 2 - 0.04, 0.42, 0.02, F);
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].forEach(([sx, sz]) => {
      b.C(g, 0.016, 0.012, 0.16, sx * (D.w / 2 - 0.05), 0, sz * (D.d / 2 - 0.05), BLACK, 8);
    });
  });
  each('coffee', pl => {
    const p = f.product('coffee');
    if (!p) return;
    const D = f.dims('coffee');
    const g = b.group(root, pl.x, pl.z, pl.rot);
    const top = mat(p, '#b58a5c'),
      leg = mat(p, '#1d1e20', undefined, true);
    if (p.round && models.fit(g, 'coffee_table_round_01', D.w, D.h, D.d, 0, 0, 0, hexOf(p, '#b58a5c'), 'coffee')) {
      /* model */
    } else if (p.round) {
      b.C(g, D.w / 2, D.w / 2, 0.03, 0, D.h - 0.03, 0, top, 40);
      b.C(g, 0.03, 0.03, D.h - 0.03, 0, 0, 0, leg, 10);
    } else {
      b.B(g, D.w, 0.035, D.d, 0, D.h - 0.035, 0, top);
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].forEach(([sx, sz]) => {
        b.B(g, 0.035, D.h - 0.035, 0.035, sx * (D.w / 2 - 0.04), 0, sz * (D.d / 2 - 0.04), leg);
      });
      b.B(g, D.w - 0.06, 0.02, D.d - 0.06, 0, 0.12, 0, leg);
    }
    b.tag = null;
    models.place(g, 'ceramic_vase_01', D.w * 0.2, D.h, 0, { h: 0.2 });
  });
  each('rug', pl => {
    const p = f.product('rug');
    if (!p) return;
    const D = f.dims('rug');
    const g = b.group(root, pl.x, pl.z, pl.rot);
    b.B(g, D.w, 0.012, D.d, 0, 0, 0, mat(p, '#d6c8b0', 'fabric'), { shadow: false });
  });
  each('tvunit', pl => {
    const p = f.product('tvunit');
    if (!p) return;
    const D = f.dims('tvunit');
    const g = at(pl, D.d);
    if (!models.fit(g, 'modern_wooden_cabinet', D.w, D.h, D.d, 0, 0, 0, hexOf(p, '#f2f1ec'), 'tvunit')) {
      b.B(g, D.w, D.h - 0.06, D.d, 0, 0.06, 0, mat(p, '#f2f1ec'));
      const fr = mat(p, '#f2f1ec', undefined, true);
      b.B(g, D.w / 2 - 0.02, D.h - 0.14, 0.012, -D.w / 4, 0.1, D.d / 2 + 0.006, fr);
      b.B(g, D.w / 2 - 0.02, D.h - 0.14, 0.012, D.w / 4, 0.1, D.d / 2 + 0.006, fr);
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].forEach(([sx, sz]) => {
        b.B(g, 0.03, 0.06, 0.03, sx * (D.w / 2 - 0.05), 0, sz * (D.d / 2 - 0.04), BLACK);
      });
    }
    const tv = f.product('tv');
    if (tv) {
      b.tag = 'tv';
      const T = f.dims('tv');
      b.B(g, T.w, T.h, 0.04, 0, D.h + 0.3, -D.d / 2 + 0.03, M.get('#151617', 'screen'));
    }
    b.tag = null;
    models.place(g, 'potted_plant_02', D.w / 2 + 0.3, 0, 0, { h: 1.0 });
  });
  each('floorlamp', pl => {
    const p = f.product('floorlamp');
    if (!p) return;
    const D = f.dims('floorlamp');
    const hh = Math.max(1.2, D.h);
    b.C(root, 0.14, 0.14, 0.02, pl.x, 0, pl.z, BLACK);
    b.C(root, 0.012, 0.012, hh - 0.25, pl.x, 0, pl.z, BLACK, 8);
    b.C(root, 0.13, 0.2, 0.26, pl.x, hh - 0.26, pl.z, mat(p, '#e9dfcd', 'lacquer'), 28);
  });
  if (full)
    each('pendant', pl => {
      const p = f.product('pendant');
      if (!p) return;
      if (!models.place(root, 'modern_ceiling_lamp_01', pl.x, H - 0.75, pl.z, { h: 0.75, tag: 'pendant' })) {
        b.C(root, 0.005, 0.005, 0.6, pl.x, H - 0.6, pl.z, M.get('#888888', 'metal'), 6);
        b.C(root, 0.17, 0.17, 0.12, pl.x, H - 0.72, pl.z, mat(p, '#f3efe6', 'lacquer'), 28);
      }
    });

  // ---------- kitchen ----------
  each('kitchen', pl => {
    const k = f.product('kitchen'),
      fr = f.product('fridge'),
      hood = f.product('hood');
    const ex = pl.extra?.[0];
    if (!ex) return;
    const runW = ex.w!,
      g = at(pl, 0.6),
      x0 = -runW / 2;
    const frD = fr ? f.dims('fridge') : null,
      frW = frD ? frD.w : 0;
    if (fr && frD) {
      b.tag = 'fridge';
      const light = !fr.hex || /^#(f|e|d)/i.test(fr.hex);
      b.B(g, frW, frD.h, 0.6, x0 + frW / 2, 0, 0, light ? M.get('#f1f3f4', 'gloss') : M.get('#a9adb1', 'metal'));
      b.B(g, 0.02, 0.4, 0.03, x0 + frW - 0.04, frD.h * 0.6, 0.31, M.get('#c4c4c1', 'metal'));
    }
    if (!k) return;
    const kw = Math.min(f.dims('kitchen').w, runW - frW - 0.01),
      a = x0 + frW + 0.01,
      kd = 0.57,
      fz = -0.3 + kd / 2;
    const units = Math.max(2, Math.round(kw / 0.6)),
      uw = kw / units,
      ovenI = units >= 3 ? units - 2 : units - 1,
      sinkI = 0;
    const front = mat(k, '#f2f1ec'),
      handle = M.get(k.hex && /^#[0-3]/.test(k.hex) ? '#111214' : '#c4c4c1', 'metal');
    b.tag = 'kitchen';
    b.B(g, kw, 0.1, kd - 0.05, a + kw / 2, 0, fz - 0.03, M.get('#2b2b2b', 'plain'));
    for (let i = 0; i < units; i++) {
      const ux = a + uw * (i + 0.5);
      if (i === ovenI && has('oven')) {
        b.B(g, uw - 0.006, 0.14, kd, ux, 0.72, fz, front);
        b.B(g, uw - 0.006, 0.1, kd, ux, 0.1, fz, front);
        b.tag = 'oven';
        b.B(g, uw - 0.02, 0.5, 0.02, ux, 0.21, fz + kd / 2 + 0.004, M.get('#141516', 'gloss'));
        b.tag = 'kitchen';
        continue;
      }
      b.B(g, uw - 0.006, 0.76, kd, ux, 0.1, fz, front);
      b.B(g, uw * 0.45, 0.012, 0.02, ux, 0.8, fz + kd / 2 + 0.012, handle);
    }
    const wt = f.product('worktop'),
      wtHex = wt?.hex || k.hex2 || '#c9b79c';
    b.tag = wt ? 'worktop' : 'kitchen';
    b.B(g, kw + 0.01, 0.035, 0.62, a + kw / 2, 0.86, 0, M.get(wtHex, isWood(wtHex) ? 'wood' : 'stone'));
    const sx = a + uw * (sinkI + 0.5);
    if (has('sink')) {
      const s = f.product('sink')!;
      b.tag = 'sink';
      b.B(g, 0.46, 0.006, 0.38, sx, 0.897, 0, M.get(s.hex || '#b9bcbe', /inox|edelstahl|stahl/i.test(s.color) ? 'metal' : 'stone'));
    }
    if (has('faucet') || f.product('sink')?.includesFaucet) {
      b.tag = has('faucet') ? 'faucet' : 'sink';
      const fm = M.get(f.product('faucet')?.hex || '#c0c3c5', 'metal');
      b.C(g, 0.016, 0.016, 0.3, sx, 0.9, -0.24, fm, 10);
      b.B(g, 0.03, 0.03, 0.18, sx, 1.18, -0.15, fm);
    }
    const ox = a + uw * (ovenI + 0.5);
    if (has('hob')) {
      b.tag = 'hob';
      b.B(g, 0.58, 0.008, 0.5, ox, 0.9, 0, M.get('#0f1011', 'gloss'));
    }
    if (full) {
      b.tag = 'kitchen';
      for (let i = 0; i < units; i++) {
        const ux = a + uw * (i + 0.5);
        if (hood?.chimney && i === ovenI) continue;
        b.B(g, uw - 0.006, 0.7, 0.33, ux, 1.48, -0.135, front);
        b.B(g, uw * 0.45, 0.012, 0.02, ux, 1.52, 0.04, handle);
      }
      if (hood) {
        b.tag = 'hood';
        const hm = M.get(hood.hex || '#b9bcbe', /edelstahl|inox|stahl/i.test(hood.color) ? 'metal' : 'lacquer');
        if (hood.chimney) {
          b.B(g, 0.6, 0.07, 0.46, ox, 1.5, -0.07, hm);
          b.B(g, 0.26, H - 1.57, 0.22, ox, 1.57, -0.19, hm);
        } else b.B(g, Math.min(0.6, uw) - 0.02, 0.05, 0.3, ox, 1.43, -0.13, hm);
      }
      b.tag = null;
      b.B(
        g,
        kw,
        0.008,
        0.03,
        a + kw / 2,
        1.47,
        0,
        M.get('#fff3d6', 'emissive', { emissive: new THREE.Color('#ffdca0'), emissiveIntensity: 0.9 }),
      );
    }
  });

  // ---------- dining ----------
  each('table', pl => {
    const t = f.product('table');
    if (!t) return;
    const D = f.dims('table');
    const g = b.group(root, pl.x, pl.z, pl.rot);
    const top = mat(t, '#b58a5c'),
      leg = mat(t, '#1d1e20', undefined, true);
    if (t.round) {
      b.C(g, D.w / 2, D.w / 2, 0.035, 0, D.h - 0.035, 0, top, 48);
      b.C(g, 0.05, 0.06, D.h - 0.05, 0, 0.02, 0, leg, 16);
      b.C(g, 0.28, 0.3, 0.02, 0, 0, 0, leg, 32);
    } else {
      b.B(g, D.w, 0.035, D.d, 0, D.h - 0.035, 0, top);
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].forEach(([sx, sz]) => {
        b.B(g, 0.045, D.h - 0.035, 0.045, sx * (D.w / 2 - 0.06), 0, sz * (D.d / 2 - 0.06), leg);
      });
    }
    b.tag = null;
    models.place(g, 'ceramic_vase_01', 0.12, D.h, 0, { h: 0.22 });
    const ch = f.product('chairs');
    if (!t.includesChairs && !ch) return;
    b.tag = ch ? 'chairs' : 'table';
    const seatHex = ch?.hex || '#d9d6d0',
      legHex = ch?.hex2 || ch?.hex || '#1d1e20';
    const seatM = M.get(seatHex, isWood(seatHex) ? 'wood' : 'lacquer'),
      legM = M.get(legHex, isWood(legHex) ? 'wood' : 'metal');
    const r = (t.round ? D.w / 2 : D.d / 2) + 0.26;
    const seats: [number, number, number][] =
      !t.round && D.w >= 1.1
        ? [
            [-D.w / 4, -r, 0],
            [D.w / 4, -r, 0],
            [-D.w / 4, r, Math.PI],
            [D.w / 4, r, Math.PI],
          ]
        : [
            [0, -r, 0],
            [0, r, Math.PI],
            [-((t.round ? D.w : D.w) / 2 + 0.26), 0, Math.PI / 2],
            [D.w / 2 + 0.26, 0, -Math.PI / 2],
          ];
    const CD = f.dims('chairs');
    for (const [x, z, ry] of seats) {
      if (!models.fit(b.group(g, x, z, ry), 'dining_chair_02', CD.w, CD.h, CD.d, 0, 0, 0, seatHex, b.tag))
        chair(b, g, x, z, ry, seatM, legM);
    }
  });

  // ---------- bedroom ----------
  each('bed', pl => {
    const bed = f.product('bed');
    if (!bed) return;
    const D = f.dims('bed'),
      MD = f.dims('mattress');
    const g = at(pl, D.d);
    const frameH = 0.3,
      F = mat(bed, '#d8ccb9');
    b.B(g, D.w, frameH, D.d - 0.06, 0, 0.04, 0.03, F);
    b.tag = has('mattress') ? 'mattress' : 'bed';
    b.B(g, Math.min(MD.w, D.w - 0.04), MD.h, Math.min(MD.d, D.d - 0.08), 0, 0.04 + frameH - 0.02, 0.02, M.get('#f7f6f2', 'fabric'));
    b.tag = 'bed';
    const top = 0.04 + frameH - 0.02 + MD.h;
    b.B(g, D.w - 0.04, 0.07, 1.4, 0, top, D.d / 2 - 0.72, M.get('#f4f2ec', 'fabric'));
    b.B(g, D.w - 0.02, 0.03, 0.45, 0, top + 0.06, D.d / 2 - 0.45, M.get(accentFor(bed.hex), 'fabric'));
    b.B(g, 0.62, 0.14, 0.36, -0.38, top, -D.d / 2 + 0.3, M.get('#fbfaf7', 'fabric'));
    b.B(g, 0.62, 0.14, 0.36, 0.38, top, -D.d / 2 + 0.3, M.get('#fbfaf7', 'fabric'));
    b.B(g, D.w, Math.max(0.6, D.h), 0.07, 0, 0.02, -D.d / 2 + 0.035, mat(bed, '#d8ccb9', undefined, true));
  });
  each('night', pl => {
    const n = f.product('night');
    if (!n) return;
    const D = f.dims('night');
    for (const e of pl.extra || []) {
      const g = b.group(root, e.x + (Math.sin(e.rot) * D.d) / 2, e.z + (Math.cos(e.rot) * D.d) / 2, e.rot);
      b.tag = 'night';
      if (!models.fit(g, 'side_table_01', D.w, D.h, D.d, 0, 0, 0, hexOf(n, '#f2f1ec'), 'night')) {
        b.B(g, D.w, D.h, D.d, 0, 0, 0, mat(n, '#f2f1ec'));
        if (n.hex2 && n.hex2 !== n.hex)
          b.B(g, D.w - 0.04, D.h * 0.35, 0.01, 0, D.h * 0.55, D.d / 2 + 0.005, mat(n, '#f2f1ec', undefined, true));
      }
      const lp = f.product('lamps');
      if (lp) {
        b.tag = 'lamps';
        b.C(g, 0.05, 0.065, 0.06, 0, D.h, 0, M.get('#ece7dd', 'gloss'));
        b.C(g, 0.012, 0.012, 0.16, 0, D.h + 0.06, 0, M.get('#c9c9c6', 'metal'), 6);
        b.C(g, 0.08, 0.12, 0.15, 0, D.h + 0.2, 0, mat(lp, '#f3efe6', 'lacquer'), 24);
      }
    }
  });
  each('wardrobe', pl => {
    const w = f.product('wardrobe');
    if (!w) return;
    const D = f.dims('wardrobe');
    const g = at(pl, D.d);
    b.B(g, D.w, D.h, D.d, 0, 0, 0, mat(w, '#f2f1ec'));
    const nd = Math.max(2, Math.round(D.w / 0.48));
    for (let i = 1; i < nd; i++)
      b.B(g, 0.006, D.h - 0.08, 0.006, -D.w / 2 + (D.w * i) / nd, 0.04, D.d / 2 + 0.002, M.get('#8a8680', 'plain'));
    if (w.hex2 && w.hex2 !== w.hex)
      b.B(g, D.w / nd - 0.02, D.h - 0.06, 0.01, D.w / 2 - D.w / nd / 2, 0.03, D.d / 2 + 0.004, mat(w, '#f2f1ec', undefined, true));
    for (let i = 0; i < nd; i++)
      b.B(g, 0.015, 0.28, 0.02, -D.w / 2 + (D.w * (i + 0.5)) / nd + 0.1, 1.0, D.d / 2 + 0.012, M.get('#c4c4c1', 'metal'));
  });

  // ---------- hall, bathroom, terrace ----------
  each('hall', pl => {
    const h = f.product('hall');
    if (!h) return;
    const D = f.dims('hall');
    const g = at(pl, D.d);
    b.B(g, D.w, D.h, D.d, 0, 0, 0, mat(h, '#f2f1ec'));
    const hk = f.product('hooks');
    if (hk && full) {
      b.tag = 'hooks';
      b.B(g, Math.max(0.4, f.dims('hooks').w), 0.05, 0.03, 0, 1.75, -D.d / 2 + 0.015, mat(hk, '#b58a5c'));
    }
  });
  each('washer', pl => {
    const w = f.product('washer');
    if (!w) return;
    const D = f.dims('washer');
    const g = at(pl, D.d);
    b.B(g, D.w, D.h, D.d, 0, 0, 0, M.get('#f4f4f2', 'gloss'));
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 32), M.get('#2a2d30', 'gloss'));
    port.rotation.x = Math.PI / 2;
    port.position.set(0, D.h * 0.53, D.d / 2 + 0.005);
    port.userData.slot = 'washer';
    g.add(port);
  });
  each('terrace', pl => {
    const t = f.product('terrace');
    if (!t) return;
    if (
      !models.place(root, 'outdoor_table_chair_set_01', pl.x, 0, pl.z, {
        w: Math.min(1.25, Math.max(pl.maxW, 0.9)),
        ry: 0.2,
        tint: t.hex,
        tag: 'terrace',
      })
    ) {
      const tm = M.get(t.hex || '#3d4044', 'metal');
      b.C(root, 0.3, 0.3, 0.025, pl.x, 0.7, pl.z, tm, 32);
      b.C(root, 0.02, 0.02, 0.7, pl.x, 0, pl.z, tm, 8);
      chair(b, root, pl.x, pl.z + 0.5, Math.PI, tm, tm);
      chair(b, root, pl.x - 0.6, pl.z, Math.PI / 2, tm, tm);
    }
  });
  for (const fx of f.layout.fixtures) {
    b.tag = null;
    const g = b.group(root, fx.x, fx.z, fx.rot),
      WHITE = M.get('#fbfbfb', 'gloss'),
      BLK = M.get('#151617', 'metal');
    if (fx.kind === 'wc') {
      b.B(g, 0.38, 0.4, 0.55, 0, 0, 0.3, WHITE);
      b.B(g, 0.36, 0.06, 0.2, 0, 0.4, 0.12, WHITE);
    }
    if (fx.kind === 'vanity') {
      b.B(g, 0.5, 0.72, 0.4, 0, 0.02, 0.2, M.get('#f4f4f2', 'lacquer'));
      b.B(g, 0.52, 0.14, 0.42, 0, 0.72, 0.21, WHITE);
      if (full) {
        const mr = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.02, 48),
          M.get('#dde6ea', 'metal', { roughness: 0.05, metalness: 0.4 }),
        );
        mr.rotation.x = Math.PI / 2;
        mr.position.set(0, 1.5, 0.015);
        g.add(mr);
      }
    }
    if (fx.kind === 'shower') {
      const GL = M.get('#d8e6ee', 'glass');
      b.B(g, 0.012, Math.min(2.0, H - 0.02), 0.9, -0.45, 0.02, 0.45, GL, { shadow: false });
      b.B(g, 0.02, Math.min(2.0, H - 0.02), 0.02, -0.45, 0.02, 0.9, BLK);
      if (H > 2.05) {
        b.B(g, 0.025, 1.1, 0.025, 0, 0.95, 0.03, BLK);
        b.B(g, 0.25, 0.012, 0.25, 0, 2.0, 0.3, BLK);
      }
    }
  }
  // curtains at every window of living rooms and bedrooms
  const cur = f.product('curtains'),
    rods = f.product('rods');
  if (cur)
    for (const c of f.layout.curtains) {
      b.tag = 'curtains';
      const g = b.group(root, c.x, c.z, c.rot),
        ch = Math.min(2.45, H - 0.05);
      const panel = Math.min(0.55, Math.max(0.35, c.w * 0.22)),
        cm = mat(cur, '#d6c8b0', 'drape');
      drape(b, g, -c.w / 2 - panel / 2 + 0.12, panel, ch, cm);
      drape(b, g, c.w / 2 + panel / 2 - 0.12, panel, ch, cm);
      if (full) {
        b.tag = rods ? 'rods' : 'curtains';
        b.B(g, c.w + 2 * panel, 0.025, 0.025, 0, ch + 0.01, -0.02, M.get(rods?.hex || '#c9c9c6', 'metal'));
      }
    }
  b.tag = null;
}

function chair(b: Builder, parent: THREE.Object3D, x: number, z: number, ry: number, seat: THREE.Material, leg: THREE.Material) {
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

function drape(b: Builder, g: THREE.Object3D, x: number, w: number, h: number, mat: THREE.Material) {
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
function accentFor(hex?: string) {
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

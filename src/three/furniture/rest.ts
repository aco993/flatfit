import * as THREE from 'three';
import { type FurnishCtx, chair, drape } from './context';

/** Hall, bathroom and terrace pieces, the fixtures the contractor built in, curtains at every window. */
export function rest(C: FurnishCtx) {
  const { root, b, M, f, H, full, models, mat, at, each } = C;
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

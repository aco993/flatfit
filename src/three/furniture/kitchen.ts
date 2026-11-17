import * as THREE from 'three';
import { isWood } from '../materials';
import type { FurnishCtx } from './context';

/** Kitchen run: units, worktop, sink and tap, hob, oven, hood, fridge. */
export function kitchen(C: FurnishCtx) {
  const { b, M, f, H, full, mat, at, each, has } = C;
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
}

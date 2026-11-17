import { isWood } from '../materials';
import { type FurnishCtx, chair } from './context';

/** Dining table and chairs. */
export function dining(C: FurnishCtx) {
  const { root, b, M, f, models, mat, each } = C;
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
}

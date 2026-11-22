import { type FurnishCtx, accentFor, hexOf } from './context';

/** Living room: sofa, armchair, coffee table, TV bench and TV, rug, floor lamp. */
export function living(C: FurnishCtx) {
  const { root, b, M, f, H, full, models, BLACK, mat, at, each } = C;
  each('sofa', pl => {
    const p = f.product('sofa');
    if (!p) return;
    const D = f.dims('sofa');
    const g = at(pl, Math.min(D.d, 1.05));
    const w = D.w,
      d = Math.min(D.d, p.corner ? 1.0 : 1.05),
      h = D.h,
      legH = 0.12,
      seat = 0.44,
      arm = 0.16,
      armTop = Math.min(h - 0.1, 0.64),
      F = mat(p, '#9a9b9c', 'fabric');
    const corner = !!p.corner && D.d > 1.05,
      cd = corner ? D.d - d : 0,
      inner = w - 2 * arm;
    // on slim legs: a base set back under the seat cushions, a padded back and padded arms a little lower than it
    b.B(g, inner + 0.02, seat - 0.04 - legH, d - 0.06, 0, legH, -0.03, F);
    b.P(g, inner + 0.02, h - 0.04 - legH, 0.2, 0, legH, -d / 2 + 0.1, F, { puff: 0.012 });
    for (const sx of [-1, 1]) {
      const ad = sx > 0 ? d + cd : d;
      b.P(g, arm, armTop - legH, ad, sx * (w / 2 - arm / 2), legH, (ad - d) / 2, F, { puff: 0.012 });
    }
    const n = inner > 1.75 ? 3 : 2,
      cw = inner / n,
      sd = d - 0.23,
      sz = d / 2 - 0.03 - sd / 2;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      b.P(g, cw - 0.015, 0.14, sd, x, seat - 0.04, sz, F);
      b.P(g, cw - 0.03, Math.max(0.3, h - seat - 0.06), 0.2, x, seat + 0.06, -d / 2 + 0.3, F, { rx: -0.12 });
    }
    const acc = M.get(accentFor(p.hex), 'fabric');
    // cushions in front of the back cushions, not inside them
    b.P(g, 0.4, 0.36, 0.13, -inner / 2 + 0.28, seat + 0.07, -d / 2 + 0.47, acc, { ry: 0.2, rx: -0.25, puff: 0.04 });
    b.P(g, 0.38, 0.34, 0.13, inner / 2 - 0.28, seat + 0.07, -d / 2 + 0.47, acc, { ry: -0.15, rx: -0.25, puff: 0.04 });
    const legs: [number, number][] = [
      [-w / 2 + 0.09, -d / 2 + 0.09],
      [w / 2 - 0.09, -d / 2 + 0.09],
      [-w / 2 + 0.09, d / 2 - 0.09],
      [w / 2 - 0.09, d / 2 + cd - 0.09],
    ];
    if (corner) {
      // the chaise: one long seat cushion running forward from the last seat
      const chw = Math.min(0.8, cw + 0.1),
        x = inner / 2 - chw / 2;
      b.B(g, chw, seat - 0.04 - legH, cd + 0.03, x, legH, d / 2 + cd / 2 - 0.045, F);
      b.P(g, chw - 0.015, 0.14, cd + 0.03, x, seat - 0.04, d / 2 + cd / 2 - 0.045, F);
      legs.push([inner / 2 - chw + 0.06, d / 2 + cd - 0.09]);
    }
    for (const [x, z] of legs) b.C(g, 0.022, 0.014, legH, x, 0, z, BLACK, 10);
  });
  each('armchair', pl => {
    const p = f.product('armchair');
    if (!p) return;
    const D = f.dims('armchair');
    const g = b.group(root, pl.x, pl.z, pl.rot);
    const F = mat(p, '#c6c5c1', 'fabric');
    if (models.fit(g, 'modern_arm_chair_01', D.w, D.h, D.d, 0, 0, 0, hexOf(p, '#c6c5c1'), 'armchair')) return;
    b.P(g, D.w, 0.26, D.d, 0, 0.16, 0, F);
    b.P(g, D.w, Math.max(0.25, D.h - 0.4), 0.12, 0, 0.4, -D.d / 2 + 0.06, F);
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
}

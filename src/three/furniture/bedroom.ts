import { type FurnishCtx, accentFor, hexOf } from './context';

/** Bedroom: bed with base and mattress, wardrobe, bedside tables and lamps. */
export function bedroom(C: FurnishCtx) {
  const { root, b, M, f, models, mat, at, each, has } = C;
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
    b.P(g, Math.min(MD.w, D.w - 0.04), MD.h, Math.min(MD.d, D.d - 0.08), 0, 0.04 + frameH - 0.02, 0.02, M.get('#f7f6f2', 'fabric'), {
      puff: 0.012,
    });
    b.tag = 'bed';
    const top = 0.04 + frameH - 0.02 + MD.h;
    // duvet over the lower part of the bed, folded over its top edge
    b.P(g, D.w - 0.02, 0.08, 1.45, 0, top - 0.01, D.d / 2 - 0.74, M.get('#f4f2ec', 'fabric'), { puff: 0.03 });
    b.B(g, D.w - 0.02, 0.03, 0.45, 0, top + 0.06, D.d / 2 - 0.45, M.get(accentFor(bed.hex), 'fabric'));
    b.P(g, 0.62, 0.14, 0.38, -0.38, top, -D.d / 2 + 0.3, M.get('#fbfaf7', 'fabric'), { rx: -0.12, puff: 0.045 });
    b.P(g, 0.62, 0.14, 0.38, 0.38, top, -D.d / 2 + 0.3, M.get('#fbfaf7', 'fabric'), { rx: -0.12, puff: 0.045 });
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
    // carcass on a recessed plinth, then the doors as separate panels with 3 mm gaps between them
    const body = mat(w, '#f2f1ec'),
      plinth = 0.06,
      doorD = 0.018;
    b.B(g, D.w - 0.04, plinth, D.d - 0.06, 0, 0, -0.02, M.get('#2e2d2b', 'plain'));
    b.B(g, D.w, D.h - plinth, D.d - doorD, 0, plinth, -doorD / 2, body);
    const nd = Math.max(2, Math.round(D.w / 0.48)),
      dw = D.w / nd,
      gap = 0.003;
    for (let i = 0; i < nd; i++) {
      // a two-colour wardrobe (body and fronts) shows its second colour on the outer door
      const front = w.hex2 && w.hex2 !== w.hex && i === nd - 1 ? mat(w, '#f2f1ec', undefined, true) : body;
      const x = -D.w / 2 + dw * (i + 0.5);
      b.B(g, dw - gap, D.h - plinth - gap, doorD, x, plinth + gap / 2, D.d / 2 - doorD / 2, front);
      // handles on the edges where two doors meet
      const side = i % 2 === 0 ? 1 : -1;
      b.B(g, 0.012, 0.3, 0.02, x + side * (dw / 2 - 0.04), 0.95, D.d / 2 + 0.01, M.get('#c4c4c1', 'metal'));
    }
  });
}

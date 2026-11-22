import { bedShape, drawerLayout, wardrobeShape } from '../../domain/shape';
import { type FurnishCtx, accentFor, hexOf } from './context';

const dark = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.35;
};

/** Bedroom: bed with base and mattress, wardrobe, bedside tables and lamps. */
export function bedroom(C: FurnishCtx) {
  const { root, b, M, f, models, mat, at, each, has, BLACK } = C;
  each('bed', pl => {
    const bed = f.product('bed');
    if (!bed) return;
    const D = f.dims('bed'),
      MD = f.dims('mattress'),
      S = bedShape(bed);
    const g = at(pl, D.d);
    const F = S.upholstered ? mat(bed, '#d8ccb9', 'fabric') : mat(bed, '#d8ccb9');
    // a two-tone bed shows its second colour on the headboard (oak headboard on a grey frame)
    const HB = S.upholstered ? F : mat(bed, '#d8ccb9', undefined, true);
    const head = D.h >= 0.5,
      headT = !head ? 0 : S.upholstered ? 0.09 : 0.045,
      legH = S.storage ? 0 : 0.1,
      railH = S.storage ? 0.3 : 0.2,
      railTop = legH + railH;
    // the frame round the mattress; on legs, so the floor shows under it, unless it has storage down to the floor
    b.B(g, D.w, railH, D.d - headT, 0, legH, headT / 2, F);
    if (S.storage) {
      const dl = (D.d - headT - 0.12) / 2;
      for (const sx of [-1, 1])
        for (const k of [0, 1]) {
          const z = -D.d / 2 + headT + 0.06 + dl * (k + 0.5);
          b.B(g, 0.012, railH - 0.08, dl - 0.012, sx * (D.w / 2 + 0.006), 0.05, z, HB);
          b.B(g, 0.016, 0.014, 0.16, sx * (D.w / 2 + 0.016), railH - 0.075, z, BLACK);
        }
    } else {
      const LEG = S.upholstered ? M.get('#4b3a2c', 'wood') : F;
      for (const sx of [-1, 1])
        for (const z of [-D.d / 2 + headT + 0.08, D.d / 2 - 0.08]) b.C(g, 0.022, 0.016, legH, sx * (D.w / 2 - 0.08), 0, z, LEG, 12);
    }
    if (head) {
      const top = Math.max(railTop + 0.25, D.h);
      if (S.upholstered) {
        // a padded headboard in vertical channels
        b.B(g, D.w, top - 0.02, headT * 0.45, 0, 0, -D.d / 2 + headT * 0.225, F);
        const n = Math.max(4, Math.round(D.w / 0.2)),
          cw = D.w / n;
        for (let i = 0; i < n; i++)
          b.P(g, cw - 0.006, top - railTop, headT * 0.6, -D.w / 2 + cw * (i + 0.5), railTop - 0.02, -D.d / 2 + headT * 0.65, F, {
            puff: 0.014,
          });
      } else b.B(g, D.w, top, headT, 0, 0, -D.d / 2 + headT / 2, HB);
    }
    // the mattress lies a little into the frame
    b.tag = has('mattress') ? 'mattress' : 'bed';
    const mw = Math.min(MD.w, D.w - 0.06),
      md = Math.min(MD.d, D.d - headT - 0.04),
      mz = headT / 2,
      mTop = railTop - 0.06 + MD.h;
    b.P(g, mw, MD.h, md, 0, railTop - 0.06, mz, M.get('#f7f6f2', 'fabric'), { puff: 0.012 });
    b.tag = 'bed';
    // duvet over the lower part of the bed, hanging over the sides and the foot, its top edge folded back
    const DUV = M.get('#f4f2ec', 'fabric'),
      ACC = M.get(accentFor(bed.hex), 'fabric');
    const dw = mw + 0.08,
      dl = md - 0.48,
      foot = mz + md / 2 + 0.03,
      zc = foot - dl / 2,
      drop = Math.min(0.24, mTop - legH - 0.05);
    b.P(g, dw, 0.06, dl, 0, mTop - 0.01, zc, DUV, { puff: 0.025 });
    for (const sx of [-1, 1]) b.P(g, 0.035, drop, dl, sx * (dw / 2 - 0.0175), mTop - drop + 0.03, zc, DUV, { puff: 0.008 });
    b.P(g, dw, drop, 0.035, 0, mTop - drop + 0.03, foot - 0.0175, DUV, { puff: 0.008 });
    b.P(g, dw - 0.02, 0.08, 0.3, 0, mTop + 0.01, foot - dl + 0.15, DUV, { puff: 0.03 });
    // a throw across the foot
    b.P(g, dw + 0.012, 0.022, 0.45, 0, mTop + 0.045, foot - 0.26, ACC, { puff: 0.004 });
    for (const sx of [-1, 1]) b.B(g, 0.014, drop * 0.85, 0.45, sx * (dw / 2 + 0.012), mTop + 0.06 - drop * 0.85, foot - 0.26, ACC);
    // pillows against the headboard, and a cushion in front of them
    const pz = mz - md / 2 + 0.24,
      pw = Math.min(0.62, mw / 2 - 0.04),
      PIL = M.get('#fbfaf7', 'fabric');
    const xs = mw < 1.2 ? [0] : [-mw / 4, mw / 4];
    for (const x of xs) b.P(g, xs.length > 1 ? pw : Math.min(0.62, mw - 0.1), 0.15, 0.4, x, mTop - 0.01, pz, PIL, { rx: -0.2, puff: 0.05 });
    b.P(g, 0.45, 0.32, 0.12, 0, mTop - 0.01, pz + 0.24, ACC, { rx: -0.32, puff: 0.04 });
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
    const D = f.dims('wardrobe'),
      S = wardrobeShape(w, D.w),
      DL = drawerLayout(S);
    const g = at(pl, D.d);
    // carcass on a recessed plinth, a dark reveal behind the fronts so the gaps between them read as lines
    const body = mat(w, '#f2f1ec'),
      two = !!w.hex2 && w.hex2 !== w.hex,
      second = two ? mat(w, '#f2f1ec', undefined, true) : body,
      plinth = 0.06,
      doorD = 0.018,
      gap = 0.007,
      fz = D.d / 2 - doorD / 2,
      H0 = plinth,
      H1 = D.h;
    const HANDLE = dark(hexOf(w, '#f2f1ec')) ? M.get('#c4c4c1', 'metal') : BLACK,
      MIRROR = M.get('#dfe6ea', 'metal', { roughness: 0.03 });
    b.B(g, D.w - 0.04, plinth, D.d - 0.06, 0, 0, -0.02, M.get('#2e2d2b', 'plain'));
    b.B(g, D.w, D.h - plinth, D.d - doorD, 0, plinth, -doorD / 2, body);
    b.B(g, D.w - 0.02, H1 - H0 - 0.02, 0.002, 0, H0 + 0.01, D.d / 2 - doorD + 0.001, M.get('#3a3936', 'plain'), { shadow: false });
    if (S.sliding) {
      // overlapping panels on two tracks, each with a full-height grip profile on its edge
      const n = S.doors,
        pw = D.w / n + 0.02,
        mid = Math.floor(n / 2);
      for (let i = 0; i < n; i++) {
        const x = Math.max(-D.w / 2 + pw / 2, Math.min(D.w / 2 - pw / 2, -D.w / 2 + (D.w / n) * (i + 0.5))),
          z = fz + (i % 2 ? 0 : doorD + 0.004),
          fr = i === n - 1 ? second : body;
        b.B(g, pw, H1 - H0 - 0.01, doorD, x, H0 + 0.005, z, fr);
        if (S.mirror && i === mid) b.B(g, pw - 0.08, H1 - H0 - 0.12, 0.004, x, H0 + 0.06, z + doorD / 2 + 0.002, MIRROR);
        const edge = i === 0 ? 1 : -1;
        b.B(g, 0.018, H1 - H0 - 0.01, doorD + 0.006, x + edge * (pw / 2 - 0.009), H0 + 0.005, z, HANDLE);
      }
      return;
    }
    const cols = S.cols,
      cw = D.w / cols,
      drH = Math.min(0.2, (H1 - H0) / 8),
      topH = S.rows > 1 ? Math.min(0.42, (H1 - H0) * 0.22) : 0,
      mirrorCol = S.mirror ? Math.floor(cols / 2) : -1;
    const knob = (x: number, y: number, z: number) => b.B(g, 0.16, 0.012, 0.02, x, y, z + doorD / 2 + 0.01, HANDLE);
    for (let c = 0; c < cols; c++) {
      const x = -D.w / 2 + cw * (c + 0.5),
        last = c === cols - 1,
        fr = last ? second : body;
      // drawers: rows under every column, or a stack under the last one
      const nd = DL.rows + (last ? DL.inLastCol : 0);
      for (let k = 0; k < nd; k++) {
        const y = H0 + k * drH + gap / 2;
        b.B(g, cw - gap, drH - gap, doorD, x, y, fz, two ? second : body);
        knob(x, y + drH - 0.05, fz);
      }
      const y0 = H0 + nd * drH,
        y1 = H1 - topH,
        dh = y1 - y0 - gap;
      b.B(g, cw - gap, dh, doorD, x, y0 + gap / 2, fz, fr);
      if (c === mirrorCol) b.B(g, cw - 0.1, dh - 0.12, 0.004, x, y0 + 0.06, fz + doorD / 2 + 0.002, MIRROR);
      // long slim handles on the edges where two doors meet
      const side = cols === 1 ? -1 : c % 2 === 0 && !last ? 1 : -1,
        hl = Math.min(0.5, dh * 0.3);
      b.B(
        g,
        0.012,
        hl,
        0.02,
        x + side * (cw / 2 - 0.04),
        Math.min(y1 - hl - 0.25, Math.max(y0 + 0.2, 1.05 - hl / 2)),
        fz + doorD / 2 + 0.01,
        HANDLE,
      );
    }
    // short doors over the tall ones
    const nTop = S.doors - cols;
    if (topH > 0 && nTop > 0) {
      const tw = D.w / nTop;
      for (let i = 0; i < nTop; i++) {
        const x = -D.w / 2 + tw * (i + 0.5);
        b.B(g, tw - gap, topH - gap, doorD, x, H1 - topH + gap / 2, fz, body);
        knob(x, H1 - topH + 0.05, fz);
      }
    }
  });
}

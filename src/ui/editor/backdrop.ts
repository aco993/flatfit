import { t } from '../../i18n';
import { bounds } from '../../domain/geometry';
import { r2 } from '../../domain/planedit';
import { $, esc, toast } from '../dom';
import { fmtNum } from '../format';
import type { EditorState } from './state';

/** The picture of a plan under the rooms: load, opacity, size and position, scale from two clicked points. */
export function backdropPanel(S: EditorState) {
  const host = $('#ed-bd', S.dlg),
    bd = S.draft.backdrop;
  if (
    host.contains(document.activeElement) &&
    document.activeElement?.tagName === 'INPUT' &&
    (document.activeElement as HTMLInputElement).type !== 'file'
  )
    return; // keep typing undisturbed
  host.innerHTML = !bd
    ? `<p class="muted small">${esc(t('bd.hint'))}</p><label class="btn ghost file"><input type="file" accept="image/png,image/jpeg,image/webp" id="ed-bd-file" class="sr-only">${esc(t('bd.load'))}</label>`
    : `<label class="field"><span>${esc(t('bd.opacity'))}</span><input type="range" min="0.1" max="1" step="0.05" data-bd="opacity" value="${bd.opacity}"></label>
        <div class="grid4"><label class="field"><span>${esc(t('bd.width'))}</span><input type="number" step="0.05" min="1" data-bd="w" value="${r2(bd.w)}"></label>
        <label class="field"><span>${esc(t('editor.x'))}</span><input type="number" step="0.05" data-bd="x" value="${r2(bd.x)}"></label>
        <label class="field"><span>${esc(t('editor.z'))}</span><input type="number" step="0.05" data-bd="z" value="${r2(bd.z)}"></label></div>
        <div class="row"><button type="button" class="btn ghost" id="ed-bd-cal" aria-pressed="${S.mode === 'cal'}">${esc(t('bd.measure'))}</button><button type="button" class="btn ghost" id="ed-bd-move" aria-pressed="${S.mode === 'move'}">${esc(t('bd.move'))}</button><button type="button" class="btn ghost danger" id="ed-bd-del">${esc(t('bd.remove'))}</button></div>
        ${S.mode === 'cal' ? `<p class="note small" role="status">${esc(t('bd.calHint'))}</p>` : ''}
        ${S.mode === 'cal' && S.calPts.length === 2 ? `<div class="row"><label class="field"><span>${esc(t('bd.calDist'))}</span><input type="number" step="0.01" min="0.1" id="ed-bd-dist"></label><button type="button" class="btn primary" id="ed-bd-apply">${esc(t('bd.apply'))}</button></div>` : ''}`;
  if (S.mode === 'cal' && S.calPts.length === 2) (host.querySelector('#ed-bd-dist') as HTMLInputElement | null)?.focus();
}

/** Shrink the picture so it fits in browser storage (max 1600 px, JPEG), then ask for its scale. */
export async function loadBackdrop(S: EditorState, f: File) {
  try {
    const url = URL.createObjectURL(f),
      im = new Image();
    await new Promise((ok, bad) => {
      im.onload = ok;
      im.onerror = bad;
      im.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)),
      c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k);
    c.height = Math.round(im.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const b = bounds(S.draft.rooms),
      w = Math.max(6, Math.round((b.x2 - b.x1 + 2) * 2) / 2);
    S.draft.backdrop = {
      src: c.toDataURL('image/jpeg', 0.82),
      x: S.draft.rooms.length ? b.x1 - 1 : 0,
      z: S.draft.rooms.length ? b.z1 - 1 : 0,
      w,
      ar: c.height / c.width,
      opacity: 0.55,
    };
    S.mode = 'cal';
    S.calPts = [];
    S.redraw();
  } catch {
    toast(t('bd.fail'));
  }
}

/** The two clicked points are `real` metres apart: scale the picture about the first point. */
export function applyScale(S: EditorState, real: number) {
  const bd = S.draft.backdrop;
  if (!bd || S.calPts.length !== 2 || !(real > 0)) return;
  const [a, b] = S.calPts,
    drawn = Math.hypot(b.x - a.x, b.z - a.z);
  if (drawn < 0.01) return;
  // scale about the first point so it stays where the user clicked
  const k = real / drawn;
  bd.x = r2(a.x - (a.x - bd.x) * k);
  bd.z = r2(a.z - (a.z - bd.z) * k);
  bd.w = Math.round(bd.w * k * 1000) / 1000;
  S.mode = 'none';
  S.calPts = [];
  S.redraw();
  toast(t('bd.done', { w: fmtNum(bd.w, 2) }));
}

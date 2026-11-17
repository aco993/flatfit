import { t, type Key } from '../i18n';
import { COATS, LAMINATE_WASTE, PAINT_L_PER_M2, packs, surfaces } from '../domain/surfaces';
import type { App } from './app';
import { $, esc } from './dom';
import { fmtNum } from './format';
import { WOOD, type WoodTone } from '../three/materials';

const TONES = Object.keys(WOOD) as WoodTone[];
const toneHex = (t: WoodTone) => `rgb(${WOOD[t].map(v => v + 15).join(',')})`;
/** dark text on light wood, white on dark wood */
const toneInk = (t: WoodTone) => (WOOD[t][0] * 0.3 + WOOD[t][1] * 0.59 + WOOD[t][2] * 0.11 > 140 ? '#1d1f22' : '#ffffff');

/** paint buckets and laminate packs in the sizes shops sell most (the sheet says it is an assumption) */
const BUCKET_L = 15;
const LAMINATE_PACK_M2 = 2.2;
/** wall colours offered as a start; any colour can be picked */
const SWATCHES = ['#f2f1ed', '#e9e3d6', '#dcd3c3', '#cfd6cf', '#c9d3dc', '#b7aea2', '#8e9c8b', '#5f6b73'];

/**
 * "Walls and floor": paint, laminate and skirting worked out from the plan, and the wall colour shown in 3D.
 * Bathrooms and terraces are left out (usually tiled), kitchens get no laminate.
 */
export function openFinish(app: App) {
  const d = $('#finish-dlg') as HTMLDialogElement;
  const s = surfaces(app.project);
  const m2 = (v: number) => `${fmtNum(v, 1)} m²`;
  const rows = s.rooms
    .filter(r => r.walls || r.floor)
    .map(
      r =>
        `<tr><th scope="row">${esc(app.roomName(r.room))}</th><td>${r.walls ? m2(r.walls) : '–'}</td><td>${r.ceiling ? m2(r.ceiling) : '–'}</td><td>${r.floor ? m2(r.floor) : '–'}</td><td>${r.skirting ? `${fmtNum(r.skirting, 1)} m` : '–'}</td></tr>`,
    )
    .join('');
  const current = app.wall || SWATCHES[0];
  d.innerHTML = `<div class="dlg-head"><h2 id="finish-title">${esc(t('fin.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <ul class="fin-sum">
      <li><b>${esc(t('fin.paint', { l: s.paintLitres, n: packs(s.paintLitres, BUCKET_L), size: BUCKET_L }))}</b><span class="muted small">${esc(t('fin.paintHow', { m2: fmtNum(s.walls + s.ceiling, 1), coats: COATS, rate: fmtNum(PAINT_L_PER_M2, 2) }))}</span></li>
      <li><b>${esc(t('fin.laminate', { m2: fmtNum(s.laminate, 1), n: packs(s.laminate, LAMINATE_PACK_M2), size: fmtNum(LAMINATE_PACK_M2, 1) }))}</b><span class="muted small">${esc(t('fin.laminateHow', { m2: fmtNum(s.floor, 1), waste: Math.round(LAMINATE_WASTE * 100) }))}</span></li>
      <li><b>${esc(t('fin.skirting', { m: Math.ceil(s.skirting * 1.05) }))}</b><span class="muted small">${esc(t('fin.skirtingHow'))}</span></li>
    </ul>
    <div class="tblwrap"><table class="fin-table"><thead><tr><th scope="col">${esc(t('fin.room'))}</th><th scope="col">${esc(t('fin.walls'))}</th><th scope="col">${esc(t('fin.ceiling'))}</th><th scope="col">${esc(t('fin.floor'))}</th><th scope="col">${esc(t('fin.skirtingCol'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <fieldset class="fin-colour"><legend>${esc(t('fin.colour'))}</legend>
      <div class="row">${SWATCHES.map(h => `<button type="button" class="sw-btn" data-wall="${h}" style="background:${h}" aria-label="${h}" aria-pressed="${h === current}"></button>`).join('')}
      <label class="field"><span class="sr-only">${esc(t('fin.colour'))}</span><input type="color" value="${esc(current)}" data-wall-pick></label></div>
    </fieldset>
    <fieldset class="fin-colour fin-floor"><legend>${esc(t('fin.floorTone'))}</legend>
      <div class="row">${TONES.map(k => `<button type="button" class="sw-btn wide" data-floor="${k}" style="background:${toneHex(k)};color:${toneInk(k)}" aria-pressed="${k === (app.floor || 'natural')}"><span>${esc(t(('fin.tone.' + k) as Key))}</span></button>`).join('')}</div>
    </fieldset>
    <p class="muted small">${esc(t('fin.note'))}</p>`;
  const setWall = (hex: string) => {
    app.wall = hex === SWATCHES[0] ? '' : hex.toLowerCase();
    app.saveChoice();
    app.rebuild();
    d.querySelectorAll<HTMLElement>('[data-wall]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.wall === hex));
    });
  };
  d.querySelector('.fin-colour')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wall]');
    if (b) {
      setWall(b.dataset.wall!);
      (d.querySelector('[data-wall-pick]') as HTMLInputElement).value = b.dataset.wall!;
    }
  });
  d.querySelector('[data-wall-pick]')!.addEventListener('input', e => setWall((e.target as HTMLInputElement).value));
  d.querySelector('.fin-floor')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-floor]');
    if (!b) return;
    const tone = b.dataset.floor as WoodTone;
    app.floor = tone === 'natural' ? '' : tone;
    app.saveChoice();
    app.rebuild();
    d.querySelectorAll<HTMLElement>('[data-floor]').forEach(x => {
      x.setAttribute('aria-pressed', String(x === b));
    });
  });
  d.showModal();
}

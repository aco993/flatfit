import type { OpeningKind, RoomType, Side, WallItemKind } from '../../types';
import { t, type Key } from '../../i18n';
import { bounds, deriveWalls, edgeOf, openingProblems, overlaps, roomArea } from '../../domain/geometry';
import { r2, touches } from '../../domain/planedit';
import { $, esc } from '../dom';
import { fmtNum } from '../format';
import { aiPanel } from './ai';
import { backdropPanel } from './backdrop';
import { type EditorState, isOpenPair, roomLabel, selRoom } from './state';

export const TYPES: RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'terrace'];
export const KINDS: OpeningKind[] = ['door', 'entry', 'window', 'balcony'];
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const WI_KINDS: WallItemKind[] = ['radiator', 'tv'];
const FILL: Record<RoomType, string> = {
  living: '#e9d8c2',
  kitchen: '#d9e4d4',
  dining: '#efe3cf',
  bedroom: '#dcd8ec',
  bathroom: '#d3e3ea',
  hall: '#e7e3dc',
  terrace: '#d8d5cf',
};

/** Draws the plan (grid, picture, rooms, walls, openings, wall items, calibration, rubber band) and the panels. */
export function draw(S: EditorState) {
  const { draft, svg, dlg } = S;
  S.nameIn.value = draft.name;
  S.hIn.value = String(draft.wallHeight);
  const bd = draft.backdrop;
  const b0 = bounds(draft.rooms),
    b = bd
      ? {
          x1: Math.min(b0.x1, bd.x),
          z1: Math.min(b0.z1, bd.z),
          x2: Math.max(b0.x2, bd.x + bd.w),
          z2: Math.max(b0.z2, bd.z + bd.w * bd.ar),
        }
      : b0,
    m = 1.2;
  const vb = [b.x1 - m, b.z1 - m, Math.max(4, b.x2 - b.x1) + 2 * m, Math.max(4, b.z2 - b.z1) + 2 * m];
  svg.setAttribute('viewBox', vb.join(' '));
  let g = '';
  for (let x = Math.floor(vb[0]); x <= vb[0] + vb[2]; x += 0.5)
    g += `<line x1="${x}" y1="${vb[1]}" x2="${x}" y2="${vb[1] + vb[3]}" class="${x % 1 ? 'g2' : 'g1'}"/>`;
  for (let z = Math.floor(vb[1]); z <= vb[1] + vb[3]; z += 0.5)
    g += `<line x1="${vb[0]}" y1="${z}" x2="${vb[0] + vb[2]}" y2="${z}" class="${z % 1 ? 'g2' : 'g1'}"/>`;
  const rooms = draft.rooms
    .map(
      r => `<g class="room ${r.id === S.selId ? 'sel' : ''}" data-id="${esc(r.id)}" tabindex="0" role="button" aria-pressed="${r.id === S.selId}" aria-label="${esc(roomLabel(r))}, ${fmtNum(r.w, 2)} × ${fmtNum(r.d, 2)} m">
        <rect x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="${FILL[r.type]}"/>
        <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2 - 0.08}" class="t1">${esc(roomLabel(r))}</text>
        <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2 + 0.22}" class="t2">${fmtNum(roomArea(r), 2)} m² · ${fmtNum(r.w, 2)}×${fmtNum(r.d, 2)}</text>
        ${r.id === S.selId ? `<rect class="handle" data-h="br" x="${r.x + r.w - 0.12}" y="${r.z + r.d - 0.12}" width="0.24" height="0.24"/><rect class="handle" data-h="tl" x="${r.x - 0.12}" y="${r.z - 0.12}" width="0.24" height="0.24"/>` : ''}
      </g>`,
    )
    .join('');
  const walls = deriveWalls(draft)
    .map(w => {
      const [x1, z1, x2, z2] = w.axis === 'x' ? [w.a1, w.c, w.a2, w.c] : [w.c, w.a1, w.c, w.a2];
      return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="wall ${w.kind}"/>`;
    })
    .join('');
  const ops = draft.openings
    .map(o => {
      const r = draft.rooms.find(x => x.id === o.room);
      if (!r) return '';
      const e = edgeOf(r, o.side);
      const a = e.a1 + o.at,
        bb = a + o.width;
      const [x1, z1, x2, z2] = e.axis === 'x' ? [a, e.c, bb, e.c] : [e.c, a, e.c, bb];
      return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="op ${o.kind}"><title>${esc(t(('kind.' + o.kind) as Key))}</title></line>`;
    })
    .join('');
  const wis = (draft.wallItems || [])
    .map(w => {
      const r = draft.rooms.find(x => x.id === w.room);
      if (!r) return '';
      const e = edgeOf(r, w.side),
        n = (w.side === 'n' || w.side === 'w' ? 1 : -1) * 0.16,
        a = e.a1 + w.at,
        bb = a + w.width;
      const title = `<title>${esc(t(('wi.' + w.kind) as Key))}</title>`;
      if (w.kind === 'tv') {
        const mid = (a + bb) / 2;
        const [cx, cz] = e.axis === 'x' ? [mid, e.c + n] : [e.c + n, mid];
        return `<g class="wi tv">${title}<rect x="${cx - 0.09}" y="${cz - 0.09}" width="0.18" height="0.18" rx="0.03"/><text x="${cx}" y="${cz + 0.05}" class="t3">TV</text></g>`;
      }
      const [x1, z1, x2, z2] = e.axis === 'x' ? [a, e.c + n, bb, e.c + n] : [e.c + n, a, e.c + n, bb];
      return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="wi radiator">${title}</line>`;
    })
    .join('');
  const img = bd
    ? `<image class="backdrop ${S.mode === 'move' ? 'moving' : ''}" href="${bd.src}" x="${bd.x}" y="${bd.z}" width="${bd.w}" height="${bd.w * bd.ar}" opacity="${bd.opacity}" preserveAspectRatio="none"/>`
    : '';
  const cal = S.calPts
    .map(
      (p, i) =>
        `<circle class="cal" cx="${p.x}" cy="${p.z}" r="0.08"/>${i ? `<line class="cal" x1="${S.calPts[0].x}" y1="${S.calPts[0].z}" x2="${p.x}" y2="${p.z}"/>` : ''}`,
    )
    .join('');
  const rb = S.rubber;
  const rubber = rb
    ? `<rect class="rubber" x="${Math.min(rb.x0, rb.x1)}" y="${Math.min(rb.z0, rb.z1)}" width="${Math.abs(rb.x1 - rb.x0)}" height="${Math.abs(rb.z1 - rb.z0)}"/>`
    : '';
  svg.innerHTML = `<g class="grid">${g}</g>${img}<g class="${bd ? 'traced' : ''}">${rooms}</g>${walls}${ops}${wis}${cal}${rubber}`;
  svg.classList.toggle('cal-mode', S.mode === 'cal' || S.mode === 'draw' || S.mode === 'op');
  svg.classList.toggle('img-mode', S.mode === 'move');
  backdropPanel(S);
  tools(S);
  aiPanel(S);
  const area = draft.rooms.reduce((s, r) => s + (r.type === 'terrace' ? 0 : roomArea(r)), 0),
    terr = draft.rooms.filter(r => r.type === 'terrace').reduce((s, r) => s + roomArea(r), 0);
  $('#ed-total', dlg).textContent =
    t('editor.total', { a: fmtNum(area, 2) }) + (terr ? ` + ${t('room.terrace').toLowerCase()} ${fmtNum(terr, 2)} m²` : '');
  side(S);
  problems(S);
}

/** The selected room's fields, open-plan neighbours, openings and wall items. */
export function side(S: EditorState) {
  const r = selRoom(S),
    host = $('#ed-room', S.dlg);
  if (!r) {
    host.innerHTML = '';
    return;
  }
  const neigh = S.draft.rooms.filter(x => x.id !== r.id && touches(r, x));
  const ops = S.draft.openings.filter(o => o.room === r.id),
    wis = (S.draft.wallItems || []).filter(w => w.room === r.id);
  host.innerHTML = `<fieldset><legend>${esc(roomLabel(r))}</legend>
      <label class="field"><span>${esc(t('editor.type'))}</span><select data-f="type">${TYPES.map(x => `<option value="${x}" ${x === r.type ? 'selected' : ''}>${esc(t(('room.' + x) as Key))}</option>`).join('')}</select></label>
      <label class="field"><span>${esc(t('editor.name'))}</span><input data-f="name" value="${esc(r.name || '')}" maxlength="40"></label>
      <div class="grid4">${(['x', 'z', 'w', 'd'] as const).map(k => `<label class="field"><span>${esc(t(('editor.' + k) as Key))}</span><input type="number" step="0.05" ${k === 'w' || k === 'd' ? 'min="0.5"' : ''} data-f="${k}" value="${r2(r[k])}"></label>`).join('')}</div>
      ${neigh.length ? `<div class="field"><span>${esc(t('editor.open'))}</span>${neigh.map(n => `<label class="check"><input type="checkbox" data-open="${esc(n.id)}" ${isOpenPair(S, r.id, n.id) ? 'checked' : ''}> ${esc(roomLabel(n))}</label>`).join('')}</div>` : ''}
      <h4>${esc(t('editor.openings'))}</h4>
      <ul class="ops">${ops
        .map(
          o => `<li data-op="${esc(o.id)}">
        <select data-o="kind" aria-label="${esc(t('editor.kind'))}">${KINDS.map(k => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${esc(t(('kind.' + k) as Key))}</option>`).join('')}</select>
        <select data-o="side" aria-label="${esc(t('editor.side'))}">${SIDES.map(s => `<option value="${s}" ${s === o.side ? 'selected' : ''}>${esc(t(('side.' + s) as Key))}</option>`).join('')}</select>
        <label><span class="sr-only">${esc(t('editor.at'))}</span><input type="number" step="0.05" min="0" data-o="at" value="${r2(o.at)}" title="${esc(t('editor.at'))}"></label>
        <label><span class="sr-only">${esc(t('editor.width'))}</span><input type="number" step="0.05" min="0.4" data-o="width" value="${r2(o.width)}" title="${esc(t('editor.width'))}"></label>
        <button type="button" class="icon" data-o="del" aria-label="${esc(t('editor.removeOpening'))}">✕</button></li>`,
        )
        .join('')}</ul>
      <div class="row"><button type="button" class="btn ghost" id="ed-addop">+ ${esc(t('editor.addOpening'))}</button></div>
      <h4>${esc(t('editor.wallItems'))}</h4><p class="muted small">${esc(t('editor.wiHint'))}</p>
      <ul class="ops">${wis
        .map(
          w => `<li data-wi="${esc(w.id)}">
        <select data-w="kind" aria-label="${esc(t('editor.kind'))}">${WI_KINDS.map(k => `<option value="${k}" ${k === w.kind ? 'selected' : ''}>${esc(t(('wi.' + k) as Key))}</option>`).join('')}</select>
        <select data-w="side" aria-label="${esc(t('editor.side'))}">${SIDES.map(s => `<option value="${s}" ${s === w.side ? 'selected' : ''}>${esc(t(('side.' + s) as Key))}</option>`).join('')}</select>
        <label><span class="sr-only">${esc(t('editor.at'))}</span><input type="number" step="0.05" min="0" data-w="at" value="${r2(w.at)}" title="${esc(t('editor.at'))}"></label>
        <label><span class="sr-only">${esc(t('editor.width'))}</span><input type="number" step="0.05" min="0.1" data-w="width" value="${r2(w.width)}" title="${esc(t('editor.width'))}"></label>
        <button type="button" class="icon" data-w="del" aria-label="${esc(t('editor.removeOpening'))}">✕</button></li>`,
        )
        .join('')}</ul>
      <div class="row"><button type="button" class="btn ghost" id="ed-addwi">+ ${esc(t('editor.addWallItem'))}</button><button type="button" class="btn ghost danger" id="ed-del">${esc(t('editor.delete'))}</button></div>
    </fieldset>`;
}

/** Draw-a-room and click-to-add tools above the plan, and the hint for the current mode. */
function tools(S: EditorState) {
  $('#ed-tools', S.dlg).innerHTML =
    `<button type="button" class="btn ghost" id="ed-draw" aria-pressed="${S.mode === 'draw'}">▭ ${esc(t('tool.draw'))}</button>
      <button type="button" class="btn ghost" id="ed-opmode" aria-pressed="${S.mode === 'op'}">🚪 ${esc(t('tool.op'))}</button>
      <select id="ed-opkind" aria-label="${esc(t('tool.opKind'))}">${KINDS.map(k => `<option value="${k}" ${k === S.opKind ? 'selected' : ''}>${esc(t(('kind.' + k) as Key))}</option>`).join('')}</select>`;
  $('#ed-hint', S.dlg).textContent = t(S.mode === 'draw' ? 'tool.drawHint' : S.mode === 'op' ? 'tool.opHint' : 'editor.hint');
}

/** Overlapping rooms and openings on no wall; saving is blocked while rooms overlap. */
function problems(S: EditorState) {
  const { draft } = S;
  const out: string[] = [];
  if (!draft.rooms.length) out.push(t('editor.noRooms'));
  const name = (id: string) => {
    const r = draft.rooms.find(x => x.id === id);
    return r ? roomLabel(r) : id;
  };
  for (const [a, b] of overlaps(draft.rooms)) out.push(t('editor.overlap', { a: name(a), b: name(b) }));
  for (const p of openingProblems(draft))
    if (p.endsWith(':nowall')) {
      const o = draft.openings.find(x => x.id === p.split(':')[0]);
      out.push(t('editor.noWall', { id: o ? `${t(('kind.' + o.kind) as Key)} · ${name(o.room)}` : p }));
    }
  $('#ed-problems', S.dlg).innerHTML = out.map(s => `<li class="hard">${esc(s)}</li>`).join('');
  ($('#ed-save', S.dlg) as HTMLButtonElement).disabled = !draft.rooms.length || overlaps(draft.rooms).length > 0;
}

import type { App } from './app';
import { fmtNum } from './app';
import type { Opening, OpeningKind, Project, Room, RoomType, Side } from '../types';
import { t, type Key } from '../i18n';
import { $, esc } from './dom';
import { bounds, deriveWalls, edgeOf, openingProblems, overlaps, roomArea } from '../domain/geometry';
import { fromTemplate, type TemplateId } from '../data/templates';

const TYPES: RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'terrace'];
const KINDS: OpeningKind[] = ['door', 'entry', 'window', 'balcony'];
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const FILL: Record<RoomType, string> = { living: '#e9d8c2', kitchen: '#d9e4d4', dining: '#efe3cf', bedroom: '#dcd8ec', bathroom: '#d3e3ea', hall: '#e7e3dc', terrace: '#d8d5cf' };
const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const r2 = (v: number) => Math.round(v * 100) / 100;
const uid = (p: string, list: { id: string }[]) => { let i = list.length + 1; while (list.some(x => x.id === p + i)) i++; return p + i; };

/** Opens the floor-plan editor. `src` null = new apartment (choose a template). */
export function openEditor(app: App, src: Project | null) {
  const dlg = $('#editor-dlg') as HTMLDialogElement;
  const isNew = !src;
  let draft: Project = src ? structuredClone(src) : fromTemplate('tworoom', t('proj.untitled'), app.prefs.country || 'rs');
  if (draft.demo) { draft = { ...draft, id: 'p-' + Math.random().toString(36).slice(2, 9), name: t('proj.demo') + ' *', demo: false }; }
  let selId: string | null = draft.rooms[0]?.id || null;

  dlg.innerHTML = `
    <div class="dlg-head"><h2 id="editor-title">${esc(t('editor.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('editor.cancel'))}">✕</button></div>
    <div class="ed">
      <div class="ed-canvas"><svg id="ed-svg" tabindex="0" role="application" aria-label="${esc(t('editor.title'))}"></svg><p class="muted small">${esc(t('editor.hint'))}</p></div>
      <div class="ed-side">
        ${src?.demo ? `<p class="note">${esc(t('proj.demoCopy'))}</p>` : ''}
        ${isNew ? `<fieldset class="tpl"><legend>${esc(t('tpl.title'))}</legend>${(['tworoom', 'studio', 'demo', 'empty'] as TemplateId[]).map(k => `<button type="button" class="chip" data-tpl="${k}">${esc(t(('tpl.' + k) as Key))}</button>`).join('')}</fieldset>` : ''}
        <label class="field"><span>${esc(t('editor.projectName'))}</span><input id="ed-name" maxlength="60"></label>
        <label class="field"><span>${esc(t('editor.wallH'))}</span><input id="ed-wallh" type="number" min="2.2" max="4" step="0.05"></label>
        <p id="ed-total" class="muted"></p>
        <div class="row"><button type="button" class="btn" id="ed-add">+ ${esc(t('editor.add'))}</button></div>
        <div id="ed-room"></div>
        <ul id="ed-problems" class="issues"></ul>
        <div class="row end"><button type="button" class="btn ghost" data-close>${esc(t('editor.cancel'))}</button><button type="button" class="btn primary" id="ed-save">${esc(t('editor.save'))}</button></div>
      </div>
    </div>`;
  const svg = $('#ed-svg', dlg) as unknown as SVGSVGElement;
  const nameIn = $('#ed-name', dlg) as HTMLInputElement, hIn = $('#ed-wallh', dlg) as HTMLInputElement;

  const sel = () => draft.rooms.find(r => r.id === selId) || null;
  const roomLabel = (r: Room) => r.name || t(('room.' + r.type) as Key);

  function draw() {
    nameIn.value = draft.name; hIn.value = String(draft.wallHeight);
    const b = bounds(draft.rooms), m = 1.2;
    const vb = [b.x1 - m, b.z1 - m, Math.max(4, b.x2 - b.x1) + 2 * m, Math.max(4, b.z2 - b.z1) + 2 * m];
    svg.setAttribute('viewBox', vb.join(' '));
    let g = '';
    for (let x = Math.floor(vb[0]); x <= vb[0] + vb[2]; x += 0.5) g += `<line x1="${x}" y1="${vb[1]}" x2="${x}" y2="${vb[1] + vb[3]}" class="${x % 1 ? 'g2' : 'g1'}"/>`;
    for (let z = Math.floor(vb[1]); z <= vb[1] + vb[3]; z += 0.5) g += `<line x1="${vb[0]}" y1="${z}" x2="${vb[0] + vb[2]}" y2="${z}" class="${z % 1 ? 'g2' : 'g1'}"/>`;
    const rooms = draft.rooms.map(r => `<g class="room ${r.id === selId ? 'sel' : ''}" data-id="${esc(r.id)}" tabindex="0" role="button" aria-pressed="${r.id === selId}" aria-label="${esc(roomLabel(r))}, ${fmtNum(r.w, 2)} × ${fmtNum(r.d, 2)} m">
        <rect x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="${FILL[r.type]}"/>
        <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2 - 0.08}" class="t1">${esc(roomLabel(r))}</text>
        <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2 + 0.22}" class="t2">${fmtNum(roomArea(r), 2)} m² · ${fmtNum(r.w, 2)}×${fmtNum(r.d, 2)}</text>
        ${r.id === selId ? `<rect class="handle" data-h="br" x="${r.x + r.w - 0.12}" y="${r.z + r.d - 0.12}" width="0.24" height="0.24"/><rect class="handle" data-h="tl" x="${r.x - 0.12}" y="${r.z - 0.12}" width="0.24" height="0.24"/>` : ''}
      </g>`).join('');
    const walls = deriveWalls(draft).map(w => {
      const [x1, z1, x2, z2] = w.axis === 'x' ? [w.a1, w.c, w.a2, w.c] : [w.c, w.a1, w.c, w.a2];
      return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="wall ${w.kind}"/>`;
    }).join('');
    const ops = draft.openings.map(o => {
      const r = draft.rooms.find(x => x.id === o.room); if (!r) return '';
      const e = edgeOf(r, o.side); const a = e.a1 + o.at, bb = a + o.width;
      const [x1, z1, x2, z2] = e.axis === 'x' ? [a, e.c, bb, e.c] : [e.c, a, e.c, bb];
      return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="op ${o.kind}"><title>${esc(t(('kind.' + o.kind) as Key))}</title></line>`;
    }).join('');
    svg.innerHTML = `<g class="grid">${g}</g>${rooms}${walls}${ops}`;
    const area = draft.rooms.reduce((s, r) => s + (r.type === 'terrace' ? 0 : roomArea(r)), 0), terr = draft.rooms.filter(r => r.type === 'terrace').reduce((s, r) => s + roomArea(r), 0);
    $('#ed-total', dlg).textContent = t('editor.total', { a: fmtNum(area, 2) }) + (terr ? ` + ${t('room.terrace').toLowerCase()} ${fmtNum(terr, 2)} m²` : '');
    side(); problems();
  }

  function side() {
    const r = sel(), host = $('#ed-room', dlg);
    if (!r) { host.innerHTML = ''; return; }
    const neigh = draft.rooms.filter(x => x.id !== r.id && touches(r, x));
    const ops = draft.openings.filter(o => o.room === r.id);
    host.innerHTML = `<fieldset><legend>${esc(roomLabel(r))}</legend>
      <label class="field"><span>${esc(t('editor.type'))}</span><select data-f="type">${TYPES.map(x => `<option value="${x}" ${x === r.type ? 'selected' : ''}>${esc(t(('room.' + x) as Key))}</option>`).join('')}</select></label>
      <label class="field"><span>${esc(t('editor.name'))}</span><input data-f="name" value="${esc(r.name || '')}" maxlength="40"></label>
      <div class="grid4">${(['x', 'z', 'w', 'd'] as const).map(k => `<label class="field"><span>${esc(t(('editor.' + k) as Key))}</span><input type="number" step="0.05" ${k === 'w' || k === 'd' ? 'min="0.5"' : ''} data-f="${k}" value="${r2(r[k])}"></label>`).join('')}</div>
      ${neigh.length ? `<div class="field"><span>${esc(t('editor.open'))}</span>${neigh.map(n => `<label class="check"><input type="checkbox" data-open="${esc(n.id)}" ${isOpen(r.id, n.id) ? 'checked' : ''}> ${esc(roomLabel(n))}</label>`).join('')}</div>` : ''}
      <h4>${esc(t('editor.openings'))}</h4>
      <ul class="ops">${ops.map(o => `<li data-op="${esc(o.id)}">
        <select data-o="kind" aria-label="${esc(t('editor.kind'))}">${KINDS.map(k => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${esc(t(('kind.' + k) as Key))}</option>`).join('')}</select>
        <select data-o="side" aria-label="${esc(t('editor.side'))}">${SIDES.map(s => `<option value="${s}" ${s === o.side ? 'selected' : ''}>${esc(t(('side.' + s) as Key))}</option>`).join('')}</select>
        <label><span class="sr-only">${esc(t('editor.at'))}</span><input type="number" step="0.05" min="0" data-o="at" value="${r2(o.at)}" title="${esc(t('editor.at'))}"></label>
        <label><span class="sr-only">${esc(t('editor.width'))}</span><input type="number" step="0.05" min="0.4" data-o="width" value="${r2(o.width)}" title="${esc(t('editor.width'))}"></label>
        <button type="button" class="icon" data-o="del" aria-label="${esc(t('editor.removeOpening'))}">✕</button></li>`).join('')}</ul>
      <div class="row"><button type="button" class="btn ghost" id="ed-addop">+ ${esc(t('editor.addOpening'))}</button><button type="button" class="btn ghost danger" id="ed-del">${esc(t('editor.delete'))}</button></div>
    </fieldset>`;
  }

  function problems() {
    const out: string[] = [];
    if (!draft.rooms.length) out.push(t('editor.noRooms'));
    const name = (id: string) => { const r = draft.rooms.find(x => x.id === id); return r ? roomLabel(r) : id; };
    for (const [a, b] of overlaps(draft.rooms)) out.push(t('editor.overlap', { a: name(a), b: name(b) }));
    for (const p of openingProblems(draft)) if (p.endsWith(':nowall')) { const o = draft.openings.find(x => x.id === p.split(':')[0]); out.push(t('editor.noWall', { id: o ? `${t(('kind.' + o.kind) as Key)} · ${name(o.room)}` : p })); }
    $('#ed-problems', dlg).innerHTML = out.map(s => `<li class="hard">${esc(s)}</li>`).join('');
    ($('#ed-save', dlg) as HTMLButtonElement).disabled = !draft.rooms.length || overlaps(draft.rooms).length > 0;
  }

  const isOpen = (a: string, b: string) => draft.open.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  function touches(a: Room, b: Room) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
    return (Math.abs(ox) < 0.01 && oz > 0.05) || (Math.abs(oz) < 0.01 && ox > 0.05);
  }

  // ---- pointer editing ----
  const pt = (e: PointerEvent) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM()!.inverse()); return { x: q.x, z: q.y }; };
  let drag: { id: string; mode: 'move' | 'br' | 'tl'; sx: number; sz: number; r0: Room } | null = null;
  svg.onpointerdown = e => {
    const el = e.target as Element, g = el.closest('.room') as SVGGElement | null; if (!g) return;
    selId = g.dataset.id!; const r = sel()!; const p = pt(e);
    drag = { id: r.id, mode: (el as SVGElement).dataset.h as 'br' | 'tl' || 'move', sx: p.x, sz: p.z, r0: { ...r } };
    svg.setPointerCapture(e.pointerId); draw();
  };
  svg.onpointermove = e => {
    if (!drag) return; const r = draft.rooms.find(x => x.id === drag!.id)!; const p = pt(e), dx = p.x - drag.sx, dz = p.z - drag.sz, o = drag.r0;
    if (drag.mode === 'move') { r.x = snap(o.x + dx); r.z = snap(o.z + dz); }
    else if (drag.mode === 'br') { r.w = Math.max(0.5, snap(o.w + dx)); r.d = Math.max(0.5, snap(o.d + dz)); }
    else { const nx = snap(o.x + dx), nz = snap(o.z + dz); r.w = Math.max(0.5, r2(o.x + o.w - nx)); r.d = Math.max(0.5, r2(o.z + o.d - nz)); r.x = r2(o.x + o.w - r.w); r.z = r2(o.z + o.d - r.d); }
    draw();
  };
  svg.onpointerup = () => { drag = null; };
  svg.onkeydown = e => {
    const r = sel(); if (!r) return;
    const d: Record<string, [number, number]> = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] };
    if (!d[e.key]) return; e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) { r.w = Math.max(0.5, r2(r.w + d[e.key][0])); r.d = Math.max(0.5, r2(r.d + d[e.key][1])); } else { r.x = r2(r.x + d[e.key][0]); r.z = r2(r.z + d[e.key][1]); }
    draw(); (svg.querySelector(`[data-id="${CSS.escape(r.id)}"]`) as SVGGElement | null)?.focus();
  };
  svg.addEventListener('focusin', e => { const g = (e.target as Element).closest('.room') as SVGGElement | null; if (g && g.dataset.id !== selId) { selId = g.dataset.id!; side(); svg.querySelectorAll('.room').forEach(x => x.classList.toggle('sel', (x as SVGGElement).dataset.id === selId)); } });

  // ---- side panel ----
  dlg.oninput = e => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el === nameIn) { draft.name = nameIn.value; return; }
    if (el === hIn) { const v = parseFloat(hIn.value); if (v >= 2.2 && v <= 4) draft.wallHeight = v; return; }
    const r = sel(); if (!r) return;
    const f = el.dataset.f, of = el.dataset.o;
    if (f) {
      if (f === 'type') r.type = el.value as RoomType; else if (f === 'name') r.name = el.value || undefined;
      else { const v = parseFloat(el.value); if (!isFinite(v)) return; (r as any)[f] = f === 'w' || f === 'd' ? Math.max(0.5, v) : v; }
      redrawKeepFocus(el); return;
    }
    if (of) {
      const li = el.closest('li') as HTMLElement, o = draft.openings.find(x => x.id === li.dataset.op)!;
      if (of === 'kind') o.kind = el.value as OpeningKind; else if (of === 'side') o.side = el.value as Side;
      else { const v = parseFloat(el.value); if (isFinite(v)) (o as any)[of] = Math.max(of === 'width' ? 0.4 : 0, v); }
      redrawKeepFocus(el);
    }
    if (el.dataset.open) {
      const other = el.dataset.open; draft.open = draft.open.filter(([a, b]) => !((a === r.id && b === other) || (a === other && b === r.id)));
      if ((el as HTMLInputElement).checked) draft.open.push([r.id, other]);
      draw();
    }
  };
  function redrawKeepFocus(el: HTMLElement) {
    const key = el.dataset.f ? `[data-f="${el.dataset.f}"]` : `[data-op="${(el.closest('li') as HTMLElement).dataset.op}"] [data-o="${el.dataset.o}"]`;
    draw(); const again = dlg.querySelector<HTMLElement>(key); again?.focus();
  }
  dlg.onclick = e => {
    const el = e.target as HTMLElement;
    const tpl = el.closest<HTMLElement>('[data-tpl]');
    if (tpl) { draft = fromTemplate(tpl.dataset.tpl as TemplateId, draft.name || t('proj.untitled'), app.prefs.country || 'rs'); selId = draft.rooms[0]?.id || null; draw(); return; }
    if (el.closest('#ed-add')) {
      const b = bounds(draft.rooms), id = uid('r', draft.rooms);
      draft.rooms.push({ id, type: 'bedroom', x: draft.rooms.length ? snap(b.x2) : 0, z: draft.rooms.length ? snap(b.z1) : 0, w: 3, d: 3 }); selId = id; draw(); return;
    }
    if (el.closest('#ed-del')) { const r = sel(); if (!r) return; draft.rooms = draft.rooms.filter(x => x.id !== r.id); draft.openings = draft.openings.filter(o => o.room !== r.id); draft.open = draft.open.filter(p => !p.includes(r.id)); selId = draft.rooms[0]?.id || null; draw(); return; }
    if (el.closest('#ed-addop')) { const r = sel(); if (!r) return; const o: Opening = { id: uid('o', draft.openings), kind: 'window', room: r.id, side: 'n', at: snap(Math.max(0.2, r.w / 2 - 0.6)), width: Math.min(1.2, r.w - 0.4) }; draft.openings.push(o); draw(); return; }
    const del = el.closest<HTMLElement>('[data-o="del"]');
    if (del) { const id = (del.closest('li') as HTMLElement).dataset.op; draft.openings = draft.openings.filter(o => o.id !== id); draw(); return; }
    if (el.closest('#ed-save')) {
      draft.name = draft.name.trim() || t('proj.untitled'); draft.rooms.forEach(r => { r.x = r2(r.x); r.z = r2(r.z); r.w = r2(r.w); r.d = r2(r.d); });
      dlg.close(); app.projectSaved(draft);
    }
  };
  draw();
  if (!dlg.open) dlg.showModal();
}

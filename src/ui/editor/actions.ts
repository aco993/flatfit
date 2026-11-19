import type { Opening, OpeningKind, RoomType, Side, WallItem, WallItemKind } from '../../types';
import { t } from '../../i18n';
import { bounds } from '../../domain/geometry';
import { extensionSpot, r2, snap, uid } from '../../domain/planedit';
import { fromTemplate, type TemplateId } from '../../data/templates';
import { $ } from '../dom';
import { openMeasureSheet } from '../measure';
import type { Provider } from '../planai';
import { aiProvider, forgetKey, runAi } from './ai';
import { applyScale, loadBackdrop } from './backdrop';
import { type EditorState, selRoom } from './state';

/** Typing in the side panel: name, ceiling height, the room's fields, openings, wall items, picture, open plan. */
export function bindInputs(S: EditorState) {
  const { dlg } = S;
  dlg.oninput = e => {
    const { draft } = S;
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === 'ed-opkind') {
      S.opKind = el.value as OpeningKind;
      S.mode = 'op';
      S.redraw();
      return;
    }
    if ((el as HTMLInputElement).name === 'ed-ai-prov') {
      aiProvider(S, el.value as Provider);
      return;
    }
    if (el.closest('#ed-ai')) return;
    if (el === S.nameIn) {
      draft.name = S.nameIn.value;
      return;
    }
    if (el === S.hIn) {
      const v = parseFloat(S.hIn.value);
      if (v >= 2.2 && v <= 4) draft.wallHeight = v;
      return;
    }
    const r = selRoom(S);
    if (!r) return;
    const f = el.dataset.f,
      of = el.dataset.o,
      wf = el.dataset.w,
      bf = el.dataset.bd;
    if (bf && draft.backdrop) {
      const v = parseFloat(el.value);
      if (Number.isFinite(v) && (bf !== 'w' || v >= 1)) (draft.backdrop as unknown as Record<string, number>)[bf] = v;
      S.redraw();
      return;
    }
    if (el.id === 'ed-bd-file') {
      const fl = (el as HTMLInputElement).files?.[0];
      if (fl) loadBackdrop(S, fl);
      return;
    }
    if (wf) {
      const li = el.closest('li') as HTMLElement,
        w = (draft.wallItems || []).find(x => x.id === li.dataset.wi)!;
      if (wf === 'kind') {
        w.kind = el.value as WallItemKind;
        if (w.kind === 'tv') w.width = 0.1;
      } else if (wf === 'side') w.side = el.value as Side;
      else {
        const v = parseFloat(el.value);
        if (Number.isFinite(v)) (w as unknown as Record<string, number>)[wf] = Math.max(wf === 'width' ? 0.1 : 0, v);
      }
      redrawKeepFocus(S, el);
      return;
    }
    if (f) {
      if (f === 'type') {
        r.type = el.value as RoomType;
        // the extensions of an L- or U-shaped room have its type
        for (const x of draft.rooms) if (x.part === r.id) x.type = r.type;
      } else if (f === 'name') r.name = el.value || undefined;
      else {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        (r as unknown as Record<string, number>)[f] = f === 'w' || f === 'd' ? Math.max(0.5, v) : v;
      }
      redrawKeepFocus(S, el);
      return;
    }
    if (of) {
      const li = el.closest('li') as HTMLElement,
        o = draft.openings.find(x => x.id === li.dataset.op)!;
      if (of === 'kind') o.kind = el.value as OpeningKind;
      else if (of === 'side') o.side = el.value as Side;
      else {
        const v = parseFloat(el.value);
        if (Number.isFinite(v)) (o as unknown as Record<string, number>)[of] = Math.max(of === 'width' ? 0.4 : 0, v);
      }
      redrawKeepFocus(S, el);
    }
    if (el.dataset.open) {
      const other = el.dataset.open;
      draft.open = draft.open.filter(([a, b]) => !((a === r.id && b === other) || (a === other && b === r.id)));
      if ((el as HTMLInputElement).checked) draft.open.push([r.id, other]);
      S.redraw();
    }
  };
}

/** Redraw, then put the focus back on the field that was being edited (the panel is drawn anew). */
function redrawKeepFocus(S: EditorState, el: HTMLElement) {
  const li = el.closest('li') as HTMLElement | null;
  const key = el.dataset.f
    ? `[data-f="${el.dataset.f}"]`
    : el.dataset.w
      ? `[data-wi="${li!.dataset.wi}"] [data-w="${el.dataset.w}"]`
      : `[data-op="${li!.dataset.op}"] [data-o="${el.dataset.o}"]`;
  S.redraw();
  S.dlg.querySelector<HTMLElement>(key)?.focus();
}

/** Buttons: templates, add or delete rooms, openings and wall items, tools, picture, AI, measuring sheet, save. */
export function bindClicks(S: EditorState) {
  const { dlg, app } = S;
  const toggle = (m: EditorState['mode']) => {
    S.mode = S.mode === m ? 'none' : m;
    S.calPts = [];
    S.redraw();
  };
  dlg.onclick = e => {
    const { draft } = S;
    const el = e.target as HTMLElement;
    const tpl = el.closest<HTMLElement>('[data-tpl]');
    if (tpl) {
      S.draft = fromTemplate(tpl.dataset.tpl as TemplateId, draft.name || t('proj.untitled'), app.prefs.country || 'rs');
      S.selId = S.draft.rooms[0]?.id || null;
      S.redraw();
      return;
    }
    if (el.closest('#ed-add')) {
      const b = bounds(draft.rooms),
        id = uid('r', draft.rooms);
      draft.rooms.push({ id, type: 'bedroom', x: draft.rooms.length ? snap(b.x2) : 0, z: draft.rooms.length ? snap(b.z1) : 0, w: 3, d: 3 });
      S.selId = id;
      S.redraw();
      return;
    }
    if (el.closest('#ed-draw')) return toggle('draw');
    if (el.closest('#ed-opmode')) return toggle('op');
    if (el.closest('#ed-bd-cal')) return toggle('cal');
    if (el.closest('#ed-bd-move')) return toggle('move');
    if (el.closest('#ed-ai-send')) {
      runAi(S);
      return;
    }
    if (el.closest('#ed-ai-forget')) {
      forgetKey(S);
      return;
    }
    if (el.closest('#ed-measure')) {
      openMeasureSheet(draft);
      return;
    }
    if (el.closest('#ed-bd-del')) {
      delete draft.backdrop;
      S.mode = 'none';
      S.calPts = [];
      S.redraw();
      return;
    }
    if (el.closest('#ed-bd-apply')) {
      applyScale(S, parseFloat(($('#ed-bd-dist', dlg) as HTMLInputElement).value));
      return;
    }
    if (el.closest('#ed-addwi')) {
      const r = selRoom(S);
      if (!r) return;
      draft.wallItems ??= [];
      const w: WallItem = {
        id: uid('h', draft.wallItems),
        kind: 'radiator',
        room: r.id,
        side: 'n',
        at: snap(Math.max(0.2, r.w / 2 - 0.5)),
        width: Math.min(1.0, r.w - 0.4),
      };
      draft.wallItems.push(w);
      S.redraw();
      return;
    }
    const wdel = el.closest<HTMLElement>('[data-w="del"]');
    if (wdel) {
      const id = (wdel.closest('li') as HTMLElement).dataset.wi;
      draft.wallItems = (draft.wallItems || []).filter(w => w.id !== id);
      S.redraw();
      return;
    }
    if (el.closest('#ed-addpart')) {
      const r = selRoom(S);
      if (!r || r.part) return;
      // a free place against one of its sides (right first); drag it or type its size to make the L or U
      const spot = extensionSpot(draft.rooms, r) || {
          x: r2(r.x + r.w),
          z: r2(r.z + r.d - Math.min(1.5, r.d)),
          w: 1.5,
          d: Math.min(1.5, r.d),
        },
        id = uid('r', draft.rooms);
      draft.rooms.push({ id, type: r.type, ...spot, part: r.id });
      S.selId = id;
      S.redraw();
      return;
    }
    if (el.closest('#ed-detach')) {
      const r = selRoom(S);
      if (!r) return;
      delete r.part;
      S.redraw();
      return;
    }
    if (el.closest('#ed-del')) {
      const r = selRoom(S);
      if (!r) return;
      // deleting a room deletes its extensions with it
      const gone = new Set([r.id, ...draft.rooms.filter(x => x.part === r.id).map(x => x.id)]);
      draft.rooms = draft.rooms.filter(x => !gone.has(x.id));
      draft.openings = draft.openings.filter(o => !gone.has(o.room));
      draft.wallItems = (draft.wallItems || []).filter(w => !gone.has(w.room));
      draft.open = draft.open.filter(p => !p.some(id => gone.has(id)));
      S.selId = draft.rooms[0]?.id || null;
      S.redraw();
      return;
    }
    if (el.closest('#ed-addop')) {
      const r = selRoom(S);
      if (!r) return;
      const o: Opening = {
        id: uid('o', draft.openings),
        kind: 'window',
        room: r.id,
        side: 'n',
        at: snap(Math.max(0.2, r.w / 2 - 0.6)),
        width: Math.min(1.2, r.w - 0.4),
      };
      draft.openings.push(o);
      S.redraw();
      return;
    }
    const del = el.closest<HTMLElement>('[data-o="del"]');
    if (del) {
      const id = (del.closest('li') as HTMLElement).dataset.op;
      draft.openings = draft.openings.filter(o => o.id !== id);
      S.redraw();
      return;
    }
    if (el.closest('#ed-save')) {
      draft.name = draft.name.trim() || t('proj.untitled');
      for (const r of draft.rooms) {
        r.x = r2(r.x);
        r.z = r2(r.z);
        r.w = r2(r.w);
        r.d = r2(r.d);
      }
      dlg.close();
      app.projectSaved(draft);
    }
  };
}

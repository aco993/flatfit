import type { OpeningKind } from '../../types';
import { SNAP, dragRoom, edgeSnap, nearestWall, placeOpening, r2, uid } from '../../domain/planedit';
import { side } from './view';
import { type EditorState, selRoom } from './state';

const DEFAULT_W: Record<OpeningKind, number> = { door: 0.8, entry: 0.9, window: 1.2, balcony: 0.9 };

/**
 * Mouse, touch and keyboard on the plan: drag or resize a room, drag out a new one, click a wall to put a door or
 * window there, move the picture, click the two calibration points, arrows to nudge and Shift+arrows to resize.
 */
export function bindPointer(S: EditorState) {
  const { svg } = S;
  const pt = (e: PointerEvent) => {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: q.x, z: q.y };
  };
  svg.onpointerdown = e => {
    const { draft } = S,
      bd = draft.backdrop;
    if (S.mode === 'draw') {
      const p = pt(e),
        x = edgeSnap(draft.rooms, p.x, 'x'),
        z = edgeSnap(draft.rooms, p.z, 'z');
      S.rubber = { x0: x, z0: z, x1: x, z1: z };
      svg.setPointerCapture(e.pointerId);
      S.redraw();
      return;
    }
    if (S.mode === 'op') {
      const hit = nearestWall(draft.rooms, pt(e));
      if (!hit || hit.len < 0.6) return;
      const o = placeOpening(draft, hit, DEFAULT_W[S.opKind]);
      if (o.width < 0.4) return;
      draft.openings.push({ id: uid('o', draft.openings), kind: S.opKind, ...o });
      S.selId = o.room;
      S.redraw();
      return;
    }
    if (bd && S.mode === 'cal') {
      if (S.calPts.length >= 2) S.calPts = [];
      S.calPts.push(pt(e));
      S.redraw();
      return;
    }
    if (bd && S.mode === 'move') {
      const p = pt(e);
      S.imgDrag = { sx: p.x, sz: p.z, x0: bd.x, z0: bd.z };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const el = e.target as Element,
      g = el.closest('.room') as SVGGElement | null;
    if (!g) return;
    S.selId = g.dataset.id!;
    const r = selRoom(S)!;
    const p = pt(e);
    // the extensions of an L- or U-shaped room follow its main rectangle
    const parts = S.draft.rooms.filter(x => x.part === r.id).map(x => ({ ...x }));
    S.drag = { id: r.id, mode: ((el as SVGElement).dataset.h as 'br' | 'tl') || 'move', sx: p.x, sz: p.z, r0: { ...r }, parts };
    svg.setPointerCapture(e.pointerId);
    S.redraw();
  };
  svg.onpointermove = e => {
    const { draft } = S;
    if (S.rubber) {
      const p = pt(e);
      S.rubber.x1 = edgeSnap(draft.rooms, p.x, 'x');
      S.rubber.z1 = edgeSnap(draft.rooms, p.z, 'z');
      S.redraw();
      return;
    }
    if (S.imgDrag && draft.backdrop) {
      const p = pt(e);
      draft.backdrop.x = r2(S.imgDrag.x0 + p.x - S.imgDrag.sx);
      draft.backdrop.z = r2(S.imgDrag.z0 + p.z - S.imgDrag.sz);
      S.redraw();
      return;
    }
    const drag = S.drag;
    if (!drag) return;
    const r = draft.rooms.find(x => x.id === drag.id)!;
    const p = pt(e);
    Object.assign(r, dragRoom(drag.r0, drag.mode, p.x - drag.sx, p.z - drag.sz));
    if (drag.mode === 'move')
      for (const q of drag.parts) {
        const part = draft.rooms.find(x => x.id === q.id);
        if (part) Object.assign(part, { x: r2(q.x + r.x - drag.r0.x), z: r2(q.z + r.z - drag.r0.z) });
      }
    S.redraw();
  };
  svg.onpointerup = () => {
    S.drag = null;
    S.imgDrag = null;
    const rb = S.rubber;
    if (!rb) return;
    const x = Math.min(rb.x0, rb.x1),
      z = Math.min(rb.z0, rb.z1),
      w = r2(Math.abs(rb.x1 - rb.x0)),
      d = r2(Math.abs(rb.z1 - rb.z0));
    S.rubber = null;
    if (w >= 0.5 && d >= 0.5) {
      const id = uid('r', S.draft.rooms);
      S.draft.rooms.push({ id, type: S.draft.rooms.length ? 'bedroom' : 'living', x: r2(x), z: r2(z), w, d });
      S.selId = id;
    }
    S.redraw();
  };
  svg.onkeydown = e => {
    const r = selRoom(S);
    if (!r) return;
    const d: Record<string, [number, number]> = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] };
    if (!d[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      r.w = Math.max(0.5, r2(r.w + d[e.key][0]));
      r.d = Math.max(0.5, r2(r.d + d[e.key][1]));
    } else {
      r.x = r2(r.x + d[e.key][0]);
      r.z = r2(r.z + d[e.key][1]);
    }
    S.redraw();
    (svg.querySelector(`[data-id="${CSS.escape(r.id)}"]`) as SVGGElement | null)?.focus();
  };
  svg.addEventListener('focusin', e => {
    const g = (e.target as Element).closest('.room') as SVGGElement | null;
    if (g && g.dataset.id !== S.selId) {
      S.selId = g.dataset.id!;
      side(S);
      svg.querySelectorAll('.room').forEach(x => {
        x.classList.toggle('sel', (x as SVGGElement).dataset.id === S.selId);
      });
    }
  });
}

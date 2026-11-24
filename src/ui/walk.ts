import type { SlotId } from '../types';
import { mainId } from '../domain/geometry';
import { footprints } from '../domain/moves';
import { canStep, roomAt, standable, walkSpots } from '../domain/walk';
import type { App } from './app';

/**
 * Walking through the flat: rings on the floor lead into the next room, a click on the floor or W A S D walks
 * inside a room. The rules (doorways, walls, furniture) are in domain/walk.ts; this wires them to the 3D view.
 */

// things one walks over or that hang on the walls
const OVER = new Set<SlotId>(['rug', 'curtains', 'rods', 'pendant', 'lamps', 'hooks', 'tv', 'mattress', 'base']);
// the camera is the eye; a person passes a 50 cm gap between a bed and a wardrobe
const BODY = 0.12;

/** Where a person cannot stand: furniture, with room for the body. */
export function walkBlocked(app: App) {
  const layout = app.layout;
  if (!layout) return () => false;
  const rects = layout.placements.filter(pl => !OVER.has(pl.slot) && app.product(pl.slot)).flatMap(pl => footprints(pl, app.D));
  return (x: number, z: number) => rects.some(r => x > r.x1 - BODY && x < r.x2 + BODY && z > r.z1 - BODY && z < r.z2 + BODY);
}

/**
 * The room a camera stands in. A view's camera can stand exactly on the line between two open-plan rooms, or
 * outside the front door looking in (a hall seen from the stairwell): then it counts as in the nearest room.
 */
function nearRoom(app: App, x: number, z: number) {
  const here = roomAt(app.project, x, z);
  if (here) return here;
  let best: string | null = null,
    bd = 1.0;
  for (const r of app.project.rooms) {
    const d = Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.z - z, 0, z - r.z - r.d));
    if (d < bd) {
      bd = d;
      best = roomAt(app.project, r.x + r.w / 2, r.z + r.d / 2);
    }
  }
  return best;
}

/** Walk to a floor point, if one can get there in a straight line and stand there. */
export function walkTo(app: App, x: number, z: number) {
  const v = app.viewer;
  if (!v?.interior) return false;
  const s = v.standing;
  // from the front door (outside the flat) the first step in needs no doorway check: the view stands in it
  const outside = !roomAt(app.project, s.x, s.z);
  if ((!outside && !canStep(app.project, [s.x, s.z], [x, z])) || !standable(app.project, x, z, walkBlocked(app))) return false;
  v.walkTo(x, z);
  return true;
}

/** A step forward (1), back (-1) or to the side, from where the camera stands and the way it faces. */
export function step(app: App, forward: number, side: number) {
  const v = app.viewer;
  if (!v?.interior) return false;
  const { x, z, yaw } = v.standing,
    fx = Math.sin(yaw),
    fz = Math.cos(yaw);
  // right of the way the camera faces is (-fz, fx)
  for (const d of [0.5, 0.25]) if (walkTo(app, x + (fx * forward - fz * side) * d, z + (fz * forward + fx * side) * d)) return true;
  return false;
}

/**
 * Rings for the room at a point (where a view puts the camera, or where a walk ended). After a walk the tab of
 * the room one has walked into is marked, without moving the camera.
 */
export function refreshWalk(app: App, at: [number, number] | null, markTab = false) {
  const v = app.viewer;
  if (!v) return;
  if (at) app.walkAt = at;
  const room = app.walkAt && v.interior ? nearRoom(app, ...app.walkAt) : null;
  if (!room) {
    v.setWalk([]);
    return;
  }
  const blocked = walkBlocked(app);
  v.setWalk(
    walkSpots(app.project, room, blocked).map(s => ({
      x: s.x,
      z: s.z,
      lx: s.door[0],
      lz: s.door[1],
      label: app.roomName(s.room),
      // first to the ring in front of the doorway, then straight through it
      go: () => v.walkTo(s.x, s.z, true, s.path.slice(), s.look),
    })),
  );
  if (!markTab) return;
  const cur = app.views[app.viewIdx];
  // the tab of the room one is in; back from the terrace, the living room's tab is marked again
  const i =
    cur?.room && mainId(app.project, cur.room) === room
      ? app.viewIdx
      : app.views.findIndex(w => w.room && mainId(app.project, w.room) === room);
  if (i >= 0) app.markTab(i, !app.views[i].interior);
}

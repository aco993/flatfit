import type { OpeningKind, Project, Room } from '../../types';
import { t, type Key } from '../../i18n';
import type { App } from '../app';
import type { Provider } from '../planai';

/**
 * Everything the floor-plan editor keeps while it is open. The editor's parts (view, pointer, side panel,
 * picture, AI reading) share this one object and call redraw() after a change.
 */
export interface EditorState {
  app: App;
  dlg: HTMLDialogElement;
  svg: SVGSVGElement;
  nameIn: HTMLInputElement;
  hIn: HTMLInputElement;
  /** the plan being edited (a copy: nothing changes until Save) */
  draft: Project;
  selId: string | null;
  /**
   * pointer mode: 'move' drags the picture, 'cal' collects two points to set its scale,
   * 'draw' drags out a new room, 'op' puts a door or window where a wall is clicked
   */
  mode: 'none' | 'move' | 'cal' | 'draw' | 'op';
  opKind: OpeningKind;
  rubber: { x0: number; z0: number; x1: number; z1: number } | null;
  calPts: { x: number; z: number }[];
  drag: { id: string; mode: 'move' | 'br' | 'tl'; sx: number; sz: number; r0: Room } | null;
  imgDrag: { sx: number; sz: number; x0: number; z0: number } | null;
  /** the picture the AI panel was drawn for (it is drawn once per picture, so typed text survives redraws) */
  aiFor: string | null;
  aiBusy: boolean;
  prov: Provider;
  redraw: () => void;
}

export const selRoom = (S: EditorState) => S.draft.rooms.find(r => r.id === S.selId) || null;
export const roomLabel = (r: Room) => r.name || t(('room.' + r.type) as Key);
export const isOpenPair = (S: EditorState, a: string, b: string) =>
  S.draft.open.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

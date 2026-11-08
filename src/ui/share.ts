import LZString from 'lz-string';
import type { Lang, Moves, Project, SlotId } from '../types';
import { DICT } from '../i18n';
import { COUNTRIES } from '../data/countries';
import { MOVABLE, type Pose } from '../domain/moves';
import { isProject } from '../store';

/**
 * Share links: #c=<country>&l=<language>&p=<flat id>&s=<selection>, plus `plan` (a whole custom floor plan)
 * or `m` (furniture moved in the demo). Everything is compressed with lz-string; links can be edited by hand,
 * so every part is validated and a broken part is ignored.
 */
export interface LinkState {
  country?: string;
  lang?: Lang;
  plan?: Project;
  projectId?: string;
  moves?: Moves;
  selection?: string;
}

const unpack = (s: string) => JSON.parse(LZString.decompressFromEncodedURIComponent(s) || '');
const pack = (v: unknown) => LZString.compressToEncodedURIComponent(JSON.stringify(v));

export function readLink(hash: string): LinkState {
  const h = new URLSearchParams(hash.replace(/^#/, '')),
    out: LinkState = {};
  const c = h.get('c'),
    l = h.get('l');
  if (c && COUNTRIES.some(x => x.id === c)) out.country = c;
  if (l && DICT[l as Lang]) out.lang = l as Lang;
  const plan = h.get('plan');
  if (plan) {
    try {
      const p = unpack(plan);
      if (isProject(p)) out.plan = { ...p, demo: false };
    } catch {
      /* ignore a broken plan */
    }
  } else if (h.get('p')) out.projectId = h.get('p')!;
  const m = h.get('m');
  if (m) {
    try {
      const mv = unpack(m);
      if (mv && typeof mv === 'object') out.moves = cleanMoves(mv);
    } catch {
      /* ignore broken moves */
    }
  }
  out.selection = h.get('s') || undefined;
  return out;
}

export function makeLink(base: string, o: { country: string; lang: Lang; project: Project; selection: string }) {
  const h = new URLSearchParams({ c: o.country, l: o.lang, p: o.project.id, s: o.selection });
  if (!o.project.demo) {
    // the plan travels in the link; choices and a traced image stay in this browser
    const { choices, backdrop, ...plan } = o.project;
    void choices;
    void backdrop;
    h.set('plan', pack(plan));
  } else if (o.project.moves && Object.keys(o.project.moves).length) h.set('m', pack(o.project.moves));
  return base.split('#')[0] + '#' + h.toString();
}

/** Keep only well-formed moves of movable pieces. */
export function cleanMoves(raw: Record<string, unknown>): Moves {
  const out: Moves = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = v as Pose;
    if (MOVABLE[k as SlotId] && m && [m.x, m.z, m.rot].every(n => typeof n === 'number' && Number.isFinite(n)))
      out[k as SlotId] = { x: m.x, z: m.z, rot: m.rot };
  }
  return out;
}

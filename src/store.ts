import type { Lang, Project } from './types';
import type { Quality } from './three/pathtrace';
import { DEMO } from './data/demo';
import type { Updates } from './data/refresh';

/** Everything the viewer keeps between visits. Storage can be missing (private mode), so every access is guarded. */
export interface Prefs { lang?: Lang; country?: string; project?: string; theme?: 'light' | 'dark' | 'auto'; quality?: Quality }

const KEY_PREFS = 'flatfit.prefs', KEY_PROJECTS = 'flatfit.projects', KEY_DEMO = 'flatfit.demo-choices', KEY_PRICES = 'flatfit.prices.';

function read<T>(k: string, def: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : def; } catch { return def; } }
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

export const loadPrefs = () => read<Prefs>(KEY_PREFS, {});
/** prices refreshed in this browser, per country (see data/refresh.ts) */
export const loadPriceUpdates = (country: string) => read<Updates>(KEY_PRICES + country, {});
export const savePriceUpdates = (country: string, u: Updates) => write(KEY_PRICES + country, u);
export const savePrefs = (p: Prefs) => write(KEY_PREFS, p);

/** The demo flat is built in; only the furniture choices for it are stored. */
export function loadProjects(): Project[] {
  const own = read<Project[]>(KEY_PROJECTS, []).filter(isProject);
  const demo: Project = { ...structuredClone(DEMO), choices: read(KEY_DEMO, {}) };
  return [demo, ...own];
}
export function saveProject(p: Project) {
  if (p.demo) { write(KEY_DEMO, p.choices || {}); return; }
  const own = read<Project[]>(KEY_PROJECTS, []).filter(isProject);
  const i = own.findIndex(x => x.id === p.id);
  p.updatedAt = Date.now();
  if (i >= 0) own[i] = p; else own.push(p);
  write(KEY_PROJECTS, own);
}
export function deleteProject(id: string) { write(KEY_PROJECTS, read<Project[]>(KEY_PROJECTS, []).filter(p => p.id !== id)); }

/** Minimal shape check for imported or shared plans. */
export function isProject(x: any): x is Project {
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.rooms) && Array.isArray(x.openings) && Array.isArray(x.open)
    && x.rooms.every((r: any) => typeof r.id === 'string' && ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'terrace'].includes(r.type) && [r.x, r.z, r.w, r.d].every(n => typeof n === 'number' && isFinite(n)) && r.w > 0 && r.d > 0)
    && x.openings.every((o: any) => typeof o.room === 'string' && ['n', 's', 'e', 'w'].includes(o.side) && ['door', 'entry', 'window', 'balcony'].includes(o.kind) && typeof o.at === 'number' && typeof o.width === 'number')
    && (x.backdrop === undefined || (typeof x.backdrop === 'object' && typeof x.backdrop.src === 'string' && /^data:image\/(png|jpeg|webp);/.test(x.backdrop.src) && [x.backdrop.x, x.backdrop.z, x.backdrop.w, x.backdrop.ar].every((n: unknown) => typeof n === 'number' && isFinite(n as number))))
    && (x.wallItems === undefined || (Array.isArray(x.wallItems) && x.wallItems.every((w: any) => typeof w.room === 'string' && ['n', 's', 'e', 'w'].includes(w.side) && ['radiator', 'tv'].includes(w.kind) && typeof w.at === 'number' && typeof w.width === 'number')));
}

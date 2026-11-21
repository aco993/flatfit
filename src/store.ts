import type { Lang, Product, Project } from './types';
import type { Quality } from './three/quality';
import { DEMO } from './data/demo';
import type { Updates } from './data/refresh';

/** Everything the viewer keeps between visits. Storage can be missing (private mode), so every access is guarded. */
export interface Prefs {
  lang?: Lang;
  country?: string;
  project?: string;
  theme?: 'light' | 'dark' | 'auto';
  quality?: Quality;
  /** draw the 3D view even where the device has no graphics card (software rendering), as the person asked once */
  gl3d?: 'always';
  /** the first-visit introduction was closed */
  intro?: boolean;
}

const KEY_PREFS = 'flatfit.prefs',
  KEY_PROJECTS = 'flatfit.projects',
  KEY_DEMO = 'flatfit.demo-choices',
  KEY_PRICES = 'flatfit.prices.',
  KEY_OWN = 'flatfit.own.';

function read<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}

export const loadPrefs = () => read<Prefs>(KEY_PREFS, {});
/** prices refreshed in this browser, per country (see data/refresh.ts) */
export const loadPriceUpdates = (country: string) => read<Updates>(KEY_PRICES + country, {});
export const savePriceUpdates = (country: string, u: Updates) => write(KEY_PRICES + country, u);
export const savePrefs = (p: Prefs) => write(KEY_PREFS, p);
/** products the user added from other stores, per country (see domain/own.ts) */
export const loadOwn = (country: string) => read<unknown>(KEY_OWN + country, []);
export const saveOwn = (country: string, list: Product[]) => write(KEY_OWN + country, list);

/** The demo flat is built in; only the furniture choices for it are stored. */
export function loadProjects(): Project[] {
  const own = read<Project[]>(KEY_PROJECTS, []).filter(isProject);
  const demo: Project = { ...structuredClone(DEMO), choices: read(KEY_DEMO, {}) };
  return [demo, ...own];
}
export function saveProject(p: Project) {
  if (p.demo) {
    write(KEY_DEMO, p.choices || {});
    return;
  }
  const own = read<Project[]>(KEY_PROJECTS, []).filter(isProject);
  const i = own.findIndex(x => x.id === p.id);
  p.updatedAt = Date.now();
  if (i >= 0) own[i] = p;
  else own.push(p);
  write(KEY_PROJECTS, own);
}
export function deleteProject(id: string) {
  write(
    KEY_PROJECTS,
    read<Project[]>(KEY_PROJECTS, []).filter(p => p.id !== id),
  );
}

/** Untrusted JSON (an imported file, a shared link) read field by field. */
type Loose = Record<string, unknown>;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Minimal shape check for imported or shared plans. */
export function isProject(input: unknown): input is Project {
  const x = input as Loose & { rooms: Loose[]; openings: Loose[]; wallItems?: Loose[]; backdrop?: Loose };
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    Array.isArray(x.rooms) &&
    Array.isArray(x.openings) &&
    Array.isArray(x.open) &&
    x.rooms.every(
      r =>
        typeof r.id === 'string' &&
        (r.part === undefined || typeof r.part === 'string') &&
        ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'terrace'].includes(r.type as string) &&
        [r.x, r.z, r.w, r.d].every(num) &&
        (r.w as number) > 0 &&
        (r.d as number) > 0,
    ) &&
    x.openings.every(
      o =>
        typeof o.room === 'string' &&
        ['n', 's', 'e', 'w'].includes(o.side as string) &&
        ['door', 'entry', 'window', 'balcony'].includes(o.kind as string) &&
        typeof o.at === 'number' &&
        typeof o.width === 'number',
    ) &&
    (x.backdrop === undefined ||
      (typeof x.backdrop === 'object' &&
        typeof x.backdrop.src === 'string' &&
        /^data:image\/(png|jpeg|webp);/.test(x.backdrop.src as string) &&
        [x.backdrop.x, x.backdrop.z, x.backdrop.w, x.backdrop.ar].every(num))) &&
    (x.wallItems === undefined ||
      (Array.isArray(x.wallItems) &&
        x.wallItems.every(
          w =>
            typeof w.room === 'string' &&
            ['n', 's', 'e', 'w'].includes(w.side as string) &&
            ['radiator', 'tv'].includes(w.kind as string) &&
            typeof w.at === 'number' &&
            typeof w.width === 'number',
        )))
  );
}

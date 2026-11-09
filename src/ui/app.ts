import * as THREE from 'three';
import type { Lang, Moves, Product, Project, SlotId, View } from '../types';
import { LANGS, detectLang, getLang, setLang, t, tt, type Key } from '../i18n';
import { COUNTRIES, country, loadCatalog, money } from '../data/countries';
import { RS_PRESETS, RS_PRESET_BASE } from '../data/demo';
import { applyUpdates } from '../data/refresh';
import { activeSlots } from '../domain/slots';
import { autoLayout, autoViews, type Layout } from '../domain/layout';
import { MOVABLE, applyMoves, moveIssues, moveKey, snapPose, turnPose, type Pose } from '../domain/moves';
import { bounds, roomArea } from '../domain/geometry';
import { withinBudget } from '../domain/budget';
import {
  decodeSelection,
  dimsOf,
  encodeSelection,
  fixDeps,
  generate,
  indexCatalog,
  ownProducts,
  type Index,
  type Selection,
  type Style,
} from '../domain/selection';
import { deleteProject, loadPrefs, loadPriceUpdates, loadProjects, savePrefs, saveProject, type Prefs } from '../store';
import { Viewer } from '../three/viewer';
import { Materials } from '../three/materials';
import { Models } from '../three/models';
import { buildApartment } from '../three/build';
import { RenderDialog } from './render';
import { openEditor } from './editor';
import { $, esc, toast } from './dom';
import { fmtNum, localeOf, today } from './format';
import { makeLink, readLink } from './share';
import { History } from './history';
import { renderList } from './list';
import { renderCard } from './card';
import { onKey, showHelp } from './keyboard';
import { exportCsv, manageProjects } from './projects';
import { PriceRefresh } from './prices';
import { openListing } from './listing';

export { fmtNum, fmtDate, dimTxt, localeOf } from './format';

const BASE = import.meta.env.BASE_URL;
const STYLES: Style[] = ['cheap', 'light', 'warm', 'dark', 'color'];

interface Snapshot {
  sel: Selection;
  preset: string;
  moves: Moves;
}

/**
 * The page's state and the glue between its parts: catalogue and choices, layout and moves, the 3D viewer,
 * and the list. Rendering of the list, the card, keyboard shortcuts, projects and price refresh live in their
 * own modules and call back into this class.
 */
export class App {
  prefs: Prefs = loadPrefs();
  projects: Project[] = loadProjects();
  project!: Project;
  ix: Index | null = null;
  sel: Selection = {};
  preset = 'custom';
  budget = 0;
  layout: Layout | null = null;
  /** planner layout before the user's moves */
  baseLayout: Layout | null = null;
  /** undo / redo of product choices and moves, for the current flat and country */
  history = new History<Snapshot>();
  views: View[] = [];
  viewIdx = 0;
  selected: SlotId | null = null;
  viewer: Viewer | null = null;
  M = new Materials();
  models = new Models();
  render = new RenderDialog(this);
  prices = new PriceRefresh(this);
  /** the last photoreal image made in this session, for the listing sheet */
  lastRender: { url: string; view: string } | null = null;
  private rebuildTimer = 0;
  private hashSel: string | null = null;
  private loadToken = 0;

  async start() {
    setLang(this.prefs.lang || detectLang());
    const link = readLink(location.hash);
    if (link.country) this.prefs.country = link.country;
    if (link.lang) setLang(link.lang);
    if (link.plan) {
      if (!this.projects.some(x => x.id === link.plan!.id)) {
        this.projects.push(link.plan);
        saveProject(link.plan);
      }
      this.project = this.projects.find(x => x.id === link.plan!.id)!;
    } else if (link.projectId) this.project = this.projects.find(x => x.id === link.projectId)!;
    this.project ||= this.projects.find(p => p.id === this.prefs.project) || this.projects[0];
    // moved furniture applies to whichever flat the link resolves to (the demo when it names none)
    if (link.moves) this.project.moves = link.moves;
    this.hashSel = link.selection || null;
    this.prefs.country ||= this.project.country;

    try {
      this.viewer = new Viewer($('#viewer'), $('#labels'));
      this.viewer.onPick = s => this.select(s, false);
      this.viewer.drag = this.dragHandler();
    } catch (e) {
      // no WebGL (old GPU, blocked, headless browser): the list and prices still work without the 3D view
      console.warn('3D view unavailable:', e);
      $('#nogl').hidden = false;
      $('#render-btn').hidden = true;
    }
    this.bindChrome();
    this.applyLang();
    await this.loadCountry(this.prefs.country!, this.hashSel);
    this.loadModelsLater();
    window.addEventListener('keydown', e => onKey(this, e));
  }

  /**
   * Furniture models and decoration (about 5 MB) are not needed to read the list or place furniture:
   * fetch them on the first interaction, or once the page has been quiet for a few seconds.
   */
  private loadModelsLater() {
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const go = () => {
      for (const ev of events) window.removeEventListener(ev, go);
      clearTimeout(quiet);
      this.models.load(BASE).then(async () => {
        if (this.viewer) await this.viewer.warm(this.models.sample());
        const rebuild = () => this.rebuild();
        if ('requestIdleCallback' in window) requestIdleCallback(rebuild, { timeout: 2000 });
        else setTimeout(rebuild, 200);
      });
    };
    for (const ev of events) window.addEventListener(ev, go, { passive: true });
    const quiet = window.setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 3000 }) : go()), 6000);
  }

  shareUrl() {
    return makeLink(location.href, {
      country: this.prefs.country!,
      lang: getLang(),
      project: this.project,
      selection: encodeSelection(this.sel),
    });
  }

  // ---------- data ----------
  async loadCountry(id: string, fromHash?: string | null) {
    // a slower, older load (another flat, another country) must not finish over this one
    const token = ++this.loadToken;
    let ix: Index;
    try {
      ix = indexCatalog(applyUpdates(await loadCatalog(id), loadPriceUpdates(id)));
    } catch {
      if (token === this.loadToken) $('#summary').textContent = t('misc.catalogFail');
      return;
    }
    if (token !== this.loadToken) return;
    // the country changes together with its catalogue, so nothing in between saves one country's products under another
    this.prefs.country = id;
    savePrefs(this.prefs);
    this.ix = ix;
    const saved = this.project.choices?.[id],
      fromLink = fromHash ? decodeSelection(fromHash, this.ix) : null;
    if (fromLink && Object.keys(fromLink).length) {
      this.sel = fixDeps(fromLink, this.ix);
      this.preset = 'custom';
    } else if (!fromHash && saved && ownProducts(saved.sel, this.ix)) {
      this.sel = fixDeps(saved.sel as Selection, this.ix);
      this.preset = saved.preset;
      this.budget = saved.budget || 0;
      if (this.preset === 'budget' && !this.budget) this.preset = 'custom';
    } else this.applyPreset(this.defaultPreset(), false);
    this.hashSel = null;
    this.history.clear();
    this.prices.reset();
    this.afterChange(true);
  }
  defaultPreset() {
    return this.prefs.country === 'rs' && this.project.demo ? 'scandi' : 'light';
  }
  presetKeys(): string[] {
    return [...(this.prefs.country === 'rs' ? Object.keys(RS_PRESETS) : []), ...STYLES];
  }
  isGenerated(key: string) {
    return STYLES.includes(key as Style);
  }
  presetName(key: string) {
    return key === 'budget' ? t('preset.budget', { v: this.fmt(this.budget) }) : tt('preset.' + key);
  }
  applyPreset(key: string, update = true) {
    if (!this.ix) return;
    if (update) this.remember();
    let sel: Selection;
    if (RS_PRESETS[key]) {
      const baseKey = RS_PRESET_BASE[key];
      sel = { ...(baseKey ? RS_PRESETS[baseKey] : {}), ...RS_PRESETS[key] };
      for (const k of Object.keys(sel) as SlotId[]) if (!sel[k] || !this.ix.byId.has(sel[k]!)) delete sel[k];
      // a hand-picked look may lack slots this flat needs: fill them with the cheapest fitting piece
      const gen = generate('light', this.project, this.ix, today());
      for (const sd of activeSlots(this.project))
        if (!(sd.id in sel) && !sd.optional && gen[sd.id] && !(sd.id in RS_PRESETS[key])) sel[sd.id] = gen[sd.id];
    } else sel = generate(key as Style, this.project, this.ix, today());
    this.sel = fixDeps(sel, this.ix);
    this.preset = key;
    if (update) this.afterChange();
  }
  /** Best setup that costs at most `amount` (see domain/budget.ts). */
  applyBudget(amount: number) {
    if (!this.ix || !(amount > 0)) return;
    this.remember();
    const r = withinBudget(amount, this.project, this.ix, today());
    this.sel = r.sel;
    this.preset = r.reached ? 'budget' : 'cheap';
    this.budget = amount;
    toast(r.reached ? t('budget.done', { v: this.fmt(r.total), b: this.fmt(amount) }) : t('budget.min', { v: this.fmt(r.minimum) }));
    this.afterChange();
  }
  setSlot(slot: SlotId, id: string) {
    if (!this.ix) return;
    this.remember();
    const s = { ...this.sel };
    if (id) s[slot] = id;
    else delete s[slot];
    this.sel = fixDeps(s, this.ix);
    this.preset = 'custom';
    this.afterChange();
    this.select(slot, false);
  }
  /** After every change: save the choice, lay the flat out again, redraw the list and (soon) the 3D view. */
  afterChange(newViews = false) {
    if (!this.ix) return;
    this.project.choices ??= {};
    this.project.choices[this.prefs.country!] = {
      preset: this.preset,
      sel: this.sel,
      ...(this.preset === 'budget' ? { budget: this.budget } : {}),
    };
    saveProject(this.project);
    this.baseLayout = autoLayout(this.project, this.D);
    this.layout = applyMoves(this.baseLayout, this.project.moves);
    if (newViews) {
      this.views = autoViews(this.project);
      this.viewIdx = Math.min(this.viewIdx, this.views.length - 1);
      this.renderViews();
    }
    this.renderList();
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      if (newViews) this.setView(this.viewIdx, true, true);
      else this.rebuild();
      document.body.dataset.ready = '1';
    }, 20);
    this.renderHistory();
  }
  refreshPrices() {
    return this.prices.run();
  }
  product = (s: SlotId): Product | undefined => {
    const id = this.sel[s];
    return id ? this.ix?.byId.get(id) : undefined;
  };
  storeName(id: string) {
    return this.ix?.cat.stores.find(s => s.id === id)?.name || id;
  }
  fmt(v: number) {
    return money(v, country(this.prefs.country!), localeOf());
  }

  // ---------- undo / redo ----------
  private snap(): Snapshot {
    return { sel: { ...this.sel }, preset: this.preset, moves: structuredClone(this.project.moves || {}) };
  }
  private restore(s: Snapshot) {
    this.sel = s.sel;
    this.preset = s.preset;
    this.project.moves = s.moves;
    this.afterChange();
    if (this.selected) this.select(this.selected, false);
  }
  /** Call before every change the user makes. */
  remember() {
    this.history.push(this.snap());
  }
  undo() {
    const s = this.history.undo(this.snap());
    if (!s) return;
    this.restore(s);
    toast(t('act.undone'));
  }
  redo() {
    const s = this.history.redo(this.snap());
    if (!s) return;
    this.restore(s);
    toast(t('act.redone'));
  }
  renderHistory() {
    ($('#undo') as HTMLButtonElement).disabled = !this.history.canUndo;
    ($('#redo') as HTMLButtonElement).disabled = !this.history.canRedo;
  }

  // ---------- moving furniture ----------
  private D = (s: SlotId) => dimsOf(this.product(s), s);
  pose(key: SlotId): Pose | null {
    const p = this.layout?.placements.find(x => x.slot === key);
    return p ? { x: p.x, z: p.z, rot: p.rot } : null;
  }
  /** Where a piece may go and whether it fits there (used live while dragging). */
  tryPose(key: SlotId, x: number, z: number, rot: number) {
    const pose = snapPose(this.project, key, x, z, rot, this.D);
    const L = applyMoves(this.baseLayout!, { ...this.project.moves, [key]: pose });
    const ok = !moveIssues(this.project, L, this.D, s => !!this.product(s)).some(i => i.slot === key);
    return { pose, ok };
  }
  movePiece(key: SlotId, pose: Pose | null) {
    this.remember();
    const mv: Moves = { ...this.project.moves };
    if (pose) mv[key] = { x: round3(pose.x), z: round3(pose.z), rot: pose.rot };
    else delete mv[key];
    this.project.moves = mv;
    this.afterChange();
    if (this.selected) this.select(this.selected, false);
  }
  private dragHandler() {
    return {
      grab: (slot: SlotId) => {
        const key = moveKey(slot);
        if (!key || !this.selected || moveKey(this.selected) !== key || !this.product(key)) return null;
        const pose = this.pose(key);
        if (!pose) return null;
        return { key, group: [key, ...(MOVABLE[key] || [])], pose };
      },
      move: (key: SlotId, x: number, z: number, rot: number) => this.tryPose(key, x, z, rot),
      drop: (key: SlotId, pose: Pose) => this.movePiece(key, pose),
    };
  }
  /** Keyboard: T turns the selected piece, Shift+arrows nudge it 5 cm in the direction the camera sees as left/right/away/toward. */
  nudge(dx: number, dz: number, turn = false) {
    const key = this.selected && moveKey(this.selected);
    if (!key || !this.product(key)) return false;
    const p = this.pose(key);
    if (!p) return false;
    if (turn) {
      this.movePiece(key, turnPose(key, p, this.D));
      return true;
    }
    const dir = new THREE.Vector3();
    this.viewer?.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const v = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(dx).add(dir.clone().multiplyScalar(-dz)),
      step = 0.05;
    // step along the world axis closest to that direction, so the piece stays on the grid
    const [sx, sz] = Math.abs(v.x) >= Math.abs(v.z) ? [Math.sign(v.x) * step, 0] : [0, Math.sign(v.z) * step];
    this.movePiece(key, { x: round3(p.x + sx), z: round3(p.z + sz), rot: p.rot });
    return true;
  }

  // ---------- 3D ----------
  wallH() {
    return this.views[this.viewIdx]?.interior ? this.project.wallHeight : 1.05;
  }
  buildRoot(lowPoly = false, wallH = this.wallH()) {
    const f = this.layout && this.ix ? { product: this.product, dims: this.D, layout: this.layout } : null;
    return buildApartment(this.project, f, { wallH, lowPoly: lowPoly || !!this.viewer?.soft }, this.M, this.models);
  }
  rebuild() {
    if (!this.viewer) return;
    const b = bounds(this.project.rooms);
    this.viewer.setRoot(this.buildRoot(), new THREE.Box3(new THREE.Vector3(b.x1, 0, b.z1), new THREE.Vector3(b.x2, 3, b.z2)));
    const labels = this.views[this.viewIdx]?.interior
      ? []
      : this.project.rooms.map(r => ({
          text: `${this.roomName(r.id)} · ${t('misc.area', { a: fmtNum(roomArea(r), 1) })}`,
          x: r.x + r.w / 2,
          z: r.z + r.d / 2,
        }));
    this.viewer.setLabels(labels);
  }
  setView(i: number, instant = false, forceBuild = false) {
    if (!this.views[i]) return;
    const wasInterior = this.views[this.viewIdx]?.interior;
    this.viewIdx = i;
    $('#views')
      .querySelectorAll('button')
      .forEach((b, k) => {
        b.setAttribute('aria-selected', String(k === i));
        b.tabIndex = k === i ? 0 : -1;
      });
    if (wasInterior !== this.views[i].interior || forceBuild) this.rebuild();
    this.viewer?.setView(this.views[i], instant);
    $('#viewer').classList.toggle('interior', this.views[i].interior);
  }
  roomName(id: string) {
    const r = this.project.rooms.find(x => x.id === id);
    if (!r) return id;
    if (r.name) return r.name;
    const same = this.project.rooms.filter(x => x.type === r.type);
    return t(('room.' + r.type) as Key) + (same.length > 1 ? ' ' + (same.indexOf(r) + 1) : '');
  }
  select(slot: SlotId | null, moveCam: boolean) {
    this.selected = slot;
    this.viewer?.highlight(slot);
    document.querySelectorAll('.slot').forEach(el => {
      el.classList.toggle('on', (el as HTMLElement).dataset.slot === slot);
    });
    if (slot && moveCam) {
      const pl = this.layout?.placements.find(p => p.slot === slot);
      const vi = pl ? this.views.findIndex(v => v.room === pl.room && v.interior) : -1;
      if (vi >= 0 && vi !== this.viewIdx) this.setView(vi);
      setTimeout(
        () => {
          const c = this.viewer?.slotCenter(slot);
          if (c) this.viewer?.lookAtPoint(c);
        },
        vi >= 0 ? 700 : 0,
      );
    }
    renderCard(this);
  }
  /** Lamp positions for the path tracer: one warm light under each room ceiling. */
  lamps(): [number, number, number][] {
    return this.project.rooms.filter(r => r.type !== 'terrace').map(r => [r.x + r.w / 2, this.project.wallHeight - 0.35, r.z + r.d / 2]);
  }

  // ---------- page chrome ----------
  applyLang() {
    const L = getLang();
    document.documentElement.lang = L === 'sr' ? 'sr-Latn' : L;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
      el.textContent = tt(el.dataset.i18n!);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(el => {
      const s = tt(el.dataset.i18nLabel!);
      el.setAttribute('aria-label', s);
      el.title = s;
    });
    $('#list').setAttribute('aria-label', t('list.label'));
    document.title = `FlatFit · ${t('app.tagline')}`;
    this.renderSelects();
    this.renderViews();
    this.renderList();
    this.rebuild();
    this.render.applyLang();
  }
  renderList() {
    renderList(this);
  }
  renderSelects() {
    const opt = (v: string, label: string, on: boolean) => `<option value="${esc(v)}" ${on ? 'selected' : ''}>${esc(label)}</option>`;
    ($('#project') as HTMLSelectElement).innerHTML =
      this.projects.map(p => opt(p.id, p.demo ? t('proj.demo') : p.name, p.id === this.project?.id)).join('') +
      opt('__new', t('nav.new'), false) +
      (this.projects.length > 1 ? opt('__manage', t('nav.projects') + '…', false) : '');
    ($('#country') as HTMLSelectElement).innerHTML = COUNTRIES.map(c =>
      opt(c.id, `${t(('country.' + c.id) as Key)} · ${c.currency}`, c.id === this.prefs.country),
    ).join('');
    ($('#lang') as HTMLSelectElement).innerHTML = LANGS.map(l => opt(l.id, l.label, l.id === getLang())).join('');
  }
  renderViews() {
    const host = $('#views');
    host.innerHTML = this.views
      .map(
        (v, i) =>
          `<button type="button" role="tab" id="view-${esc(v.id)}" aria-selected="${i === this.viewIdx}" tabindex="${i === this.viewIdx ? 0 : -1}"><kbd>${i}</kbd>${esc(v.room ? this.roomName(v.room) : t('view.overview'))}</button>`,
      )
      .join('');
    host.querySelectorAll('button').forEach((b, i) => {
      b.addEventListener('click', () => this.setView(i));
    });
    host.onkeydown = e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const i = (this.viewIdx + d + this.views.length) % this.views.length;
      this.setView(i);
      (host.children[i] as HTMLElement).focus();
    };
  }
  bindChrome() {
    $('#presets').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]');
      if (b) this.applyPreset(b.dataset.k!);
    });
    $('#slots').addEventListener('change', e => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.slot) this.setSlot(s.dataset.slot as SlotId, s.value);
    });
    $('#slots').addEventListener('click', e => {
      const el = e.target as HTMLElement;
      if (el.closest('a,select')) return;
      const sl = el.closest<HTMLElement>('.slot');
      if (sl) this.select(sl.dataset.slot as SlotId, true);
    });
    $('#summary').addEventListener('click', e => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-refresh]')) {
        this.refreshPrices();
        return;
      }
      const a = el.closest<HTMLElement>('[data-goto]');
      if (!a) return;
      e.preventDefault();
      const s = a.dataset.goto as SlotId;
      document.getElementById('sel-' + s)?.focus();
      this.select(s, true);
    });
    $('#card').addEventListener('click', e => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-close]')) this.select(null, false);
      const alt = el.closest<HTMLElement>('[data-alt]');
      if (alt && this.selected) this.setSlot(this.selected, alt.dataset.alt!);
      if (el.closest('[data-turn-piece]')) this.nudge(0, 0, true);
      const key = this.selected && moveKey(this.selected);
      if (el.closest('[data-reset-piece]') && key) this.movePiece(key, null);
    });
    $('#budget').addEventListener('submit', e => {
      e.preventDefault();
      this.applyBudget(Number(($('#budget-in') as HTMLInputElement).value));
    });
    $('#undo').addEventListener('click', () => this.undo());
    $('#redo').addEventListener('click', () => this.redo());
    $('#country').addEventListener('change', e => {
      this.loadCountry((e.target as HTMLSelectElement).value);
    });
    $('#lang').addEventListener('change', e => {
      this.setLanguage((e.target as HTMLSelectElement).value as Lang);
    });
    $('#project').addEventListener('change', e => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === '__new') {
        this.renderSelects();
        openEditor(this, null);
        return;
      }
      if (v === '__manage') {
        this.renderSelects();
        manageProjects(this);
        return;
      }
      this.switchProject(v);
    });
    $('#edit-plan').addEventListener('click', () => openEditor(this, this.project));
    $('#theme').addEventListener('click', () => this.toggleTheme());
    $('#help').addEventListener('click', () => showHelp());
    $('#share').addEventListener('click', async () => {
      const url = this.shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        toast(t('act.copied'));
      } catch {
        prompt(t('act.share'), url);
      }
    });
    $('#csv').addEventListener('click', () => exportCsv(this));
    $('#listing').addEventListener('click', () => openListing(this));
    $('#render-btn').addEventListener('click', () => this.render.open());
    document.querySelectorAll<HTMLElement>('[data-turn]').forEach(b => {
      b.addEventListener('click', () => this.viewer?.turn(b.dataset.turn === 'left' ? 0.35 : -0.35, 0));
    });
    for (const d of document.querySelectorAll('dialog')) {
      d.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('[data-close]')) d.close();
      });
    }
  }
  setLanguage(l: Lang) {
    setLang(l);
    this.prefs.lang = l;
    savePrefs(this.prefs);
    this.applyLang();
  }
  toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    this.prefs.theme = next;
    savePrefs(this.prefs);
  }

  // ---------- flats ----------
  switchProject(id: string) {
    const p = this.projects.find(x => x.id === id);
    if (!p) return;
    this.project = p;
    this.prefs.project = id;
    savePrefs(this.prefs);
    this.viewIdx = 0;
    this.selected = null;
    this.history.clear();
    this.renderSelects();
    this.loadCountry(this.prefs.country!);
  }
  /** Called by the editor after saving. */
  projectSaved(p: Project) {
    const i = this.projects.findIndex(x => x.id === p.id);
    // furniture moved by hand belongs to the old walls: start over from the planner when the plan changed
    const shape = (q: Project) => JSON.stringify([q.rooms, q.openings, q.open]);
    if (i >= 0 && shape(this.projects[i]) !== shape(p)) delete p.moves;
    if (i >= 0) this.projects[i] = p;
    else this.projects.push(p);
    saveProject(p);
    this.switchProject(p.id);
  }
  removeProject(id: string) {
    deleteProject(id);
    this.projects = this.projects.filter(p => p.id !== id);
    if (this.project.id === id) this.switchProject(this.projects[0].id);
    else this.renderSelects();
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

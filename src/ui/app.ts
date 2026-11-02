import * as THREE from 'three';
import LZString from 'lz-string';
import type { Lang, Moves, Product, Project, SlotId, View } from '../types';
import { DICT, LANGS, detectLang, getLang, setLang, t, tt, type Key } from '../i18n';
import { COUNTRIES, country, loadCatalog, money } from '../data/countries';
import { RS_PRESETS, RS_PRESET_BASE } from '../data/demo';
import { activeSlots, GROUPS, slotDef } from '../domain/slots';
import { autoLayout, autoViews, type Layout } from '../domain/layout';
import { MOVABLE, applyMoves, moveIssues, moveKey, snapPose, turnPose, type Pose } from '../domain/moves';
import { bounds, roomArea } from '../domain/geometry';
import {
  decodeSelection, dimsOf, effectivePrice, encodeSelection, fitIssues, fixDeps, generate, indexCatalog, lines, total,
  type Index, type Issue, type Selection, type Style,
} from '../domain/selection';
import { deleteProject, isProject, loadPrefs, loadPriceUpdates, loadProjects, savePrefs, savePriceUpdates, saveProject, type Prefs } from '../store';
import { applyUpdates, refreshPrices } from '../data/refresh';
import { Viewer } from '../three/viewer';
import { Materials } from '../three/materials';
import { Models } from '../three/models';
import { buildApartment } from '../three/build';
import { RenderDialog } from './render';
import { openEditor } from './editor';
import { $, esc, toast } from './dom';

const BASE = import.meta.env.BASE_URL;
const STYLES: Style[] = ['cheap', 'light', 'warm', 'dark', 'color'];
const today = () => new Date().toISOString().slice(0, 10);

export class App {
  prefs: Prefs = loadPrefs();
  projects: Project[] = loadProjects();
  project!: Project;
  ix: Index | null = null;
  sel: Selection = {};
  preset = 'custom';
  layout: Layout | null = null;
  /** planner layout before the user's moves */
  baseLayout: Layout | null = null;
  /** undo / redo of product choices and moves, for the current flat and country */
  history: { undo: Snapshot[]; redo: Snapshot[] } = { undo: [], redo: [] };
  views: View[] = [];
  viewIdx = 0;
  selected: SlotId | null = null;
  viewer: Viewer | null = null;
  M = new Materials();
  models = new Models();
  render = new RenderDialog(this);
  private rebuildTimer = 0;

  async start() {
    setLang(this.prefs.lang || detectLang());
    this.readHash();
    this.project ||= this.projects.find(p => p.id === this.prefs.project) || this.projects[0];
    if (this.hashMoves) { this.project.moves = this.hashMoves; this.hashMoves = null; }
    this.prefs.country ||= this.project.country;
    try { this.viewer = new Viewer($('#viewer'), $('#labels')); this.viewer.onPick = s => this.select(s, false); this.viewer.drag = this.dragHandler(); }
    catch (e) { console.error(e); $('#nogl').hidden = false; $('#render-btn').hidden = true; }
    this.bindChrome();
    this.applyLang();
    await this.loadCountry(this.prefs.country!, this.hashSel);
    // decorative models (plants, lamp, vase) arrive later; add them when the browser is idle
    this.models.load(BASE).then(async () => {
      if (this.viewer) await this.viewer.warm(this.models.sample());
      const go = () => this.rebuild(); 'requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 2000 }) : setTimeout(go, 200);
    });
    window.addEventListener('keydown', e => this.key(e));
  }

  // ---------- URL: #c=de&p=demo&s=<selection>[&plan=<project>] ----------
  private hashSel: string | null = null;
  private hashMoves: Moves | null = null;
  private readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('c') && COUNTRIES.some(c => c.id === h.get('c'))) this.prefs.country = h.get('c')!;
    if (h.get('l') && DICT[h.get('l') as Lang]) setLang(h.get('l') as Lang);
    const plan = h.get('plan');
    if (plan) { try { const p = JSON.parse(LZString.decompressFromEncodedURIComponent(plan) || ''); if (isProject(p)) { p.demo = false; const ex = this.projects.find(x => x.id === p.id); if (!ex) { this.projects.push(p); saveProject(p); } this.project = this.projects.find(x => x.id === p.id)!; } } catch { /* ignore broken link */ } }
    else if (h.get('p')) this.project = this.projects.find(x => x.id === h.get('p'))!;
    // moved furniture applies to whichever flat the link resolves to (the demo when it names none)
    const m = h.get('m');
    if (m) { try { const mv = JSON.parse(LZString.decompressFromEncodedURIComponent(m) || '{}'); if (mv && typeof mv === 'object') this.hashMoves = cleanMoves(mv); } catch { /* ignore broken link */ } }
    this.hashSel = h.get('s');
  }
  shareUrl() {
    const h = new URLSearchParams({ c: this.prefs.country!, l: getLang(), p: this.project.id, s: encodeSelection(this.sel) });
    if (!this.project.demo) { const { choices, backdrop, ...plan } = this.project; void choices; void backdrop; h.set('plan', LZString.compressToEncodedURIComponent(JSON.stringify(plan))); }
    else if (this.project.moves && Object.keys(this.project.moves).length) h.set('m', LZString.compressToEncodedURIComponent(JSON.stringify(this.project.moves)));
    return location.href.split('#')[0] + '#' + h.toString();
  }

  // ---------- data ----------
  async loadCountry(id: string, fromHash?: string | null) {
    this.prefs.country = id; savePrefs(this.prefs);
    try { this.ix = indexCatalog(applyUpdates(await loadCatalog(id), loadPriceUpdates(id))); }
    catch { $('#summary').textContent = t('misc.catalogFail'); return; }
    const saved = this.project.choices?.[id];
    if (fromHash) { const s = decodeSelection(fromHash, this.ix); if (Object.keys(s).length) { this.sel = fixDeps(s, this.ix); this.preset = 'custom'; } else this.applyPreset(this.defaultPreset(), false); }
    else if (saved && Object.keys(saved.sel).length) { this.sel = fixDeps(saved.sel as Selection, this.ix); this.preset = saved.preset; }
    else this.applyPreset(this.defaultPreset(), false);
    this.hashSel = null; this.history = { undo: [], redo: [] }; this.refreshNote = '';
    this.afterChange(true);
  }
  defaultPreset() { return this.prefs.country === 'rs' && this.project.demo ? 'scandi' : 'light'; }
  presetKeys(): string[] { return [...(this.prefs.country === 'rs' ? Object.keys(RS_PRESETS) : []), ...STYLES]; }
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
      for (const sd of activeSlots(this.project)) if (!(sd.id in sel) && !sd.optional && gen[sd.id] && !(sd.id in RS_PRESETS[key])) sel[sd.id] = gen[sd.id];
    } else sel = generate(key as Style, this.project, this.ix, today());
    this.sel = fixDeps(sel, this.ix); this.preset = key;
    if (update) this.afterChange();
  }
  setSlot(slot: SlotId, id: string) {
    if (!this.ix) return;
    this.remember();
    const s = { ...this.sel }; if (id) s[slot] = id; else delete s[slot];
    this.sel = fixDeps(s, this.ix); this.preset = 'custom'; this.afterChange();
    this.select(slot, false);
  }
  afterChange(newViews = false) {
    if (!this.ix) return;
    (this.project.choices ||= {})[this.prefs.country!] = { preset: this.preset, sel: this.sel };
    saveProject(this.project);
    const D = (s: SlotId) => dimsOf(this.product(s), s);
    this.baseLayout = autoLayout(this.project, D);
    this.layout = applyMoves(this.baseLayout, this.project.moves);
    if (newViews) { this.views = autoViews(this.project); this.viewIdx = Math.min(this.viewIdx, this.views.length - 1); this.renderViews(); }
    this.renderList();
    clearTimeout(this.rebuildTimer); this.rebuildTimer = window.setTimeout(() => { if (newViews) this.setView(this.viewIdx, true, true); else this.rebuild(); document.body.dataset.ready = '1'; }, 20);
    this.renderHistory();
  }

  // ---------- live prices ----------
  private refreshing: AbortController | null = null;
  private refreshNote = '';
  /** Re-checks the current country's prices (IKEA live, other stores from the daily check) and keeps them in this browser. */
  async refreshPrices() {
    if (!this.ix || this.refreshing) return;
    const id = this.prefs.country!, ctl = new AbortController();
    this.refreshing = ctl; this.refreshNote = t('refresh.busy', { done: 0, total: '…' }); this.renderList();
    const note = (s: string) => { this.refreshNote = s; const el = document.getElementById('refresh-note'); if (el) el.textContent = s; };
    try {
      const { updates, report } = await refreshPrices(this.ix.cat, today(), { signal: ctl.signal, onProgress: (done, total) => note(t('refresh.busy', { done, total })) });
      if (this.prefs.country !== id || !this.ix) return;
      savePriceUpdates(id, { ...loadPriceUpdates(id), ...updates });
      this.ix = indexCatalog(applyUpdates(this.ix.cat, updates));
      // a piece the store stopped selling is swapped for the cheapest one in its place
      const sel = { ...this.sel };
      for (const [slot, pid] of Object.entries(sel) as [SlotId, string][]) if (pid && !this.ix.byId.has(pid)) { const alt = (this.ix.bySlot.get(slot) || []).slice().sort((a, b) => a.price - b.price)[0]; if (alt) sel[slot] = alt.id; else delete sel[slot]; }
      this.sel = fixDeps(sel, this.ix);
      const msg = !report.live && report.failed ? t('refresh.fail') : report.changed ? t('refresh.done', { changed: report.changed, sales: report.newSales }) : t('refresh.none');
      this.refreshNote = msg; toast(msg);
    } catch { this.refreshNote = t('refresh.fail'); }
    finally { if (this.refreshing === ctl) this.refreshing = null; this.afterChange(); }
  }

  // ---------- undo / redo ----------
  private snap(): Snapshot { return { sel: { ...this.sel }, preset: this.preset, moves: JSON.parse(JSON.stringify(this.project.moves || {})) }; }
  private restore(s: Snapshot) { this.sel = s.sel; this.preset = s.preset; this.project.moves = s.moves; this.afterChange(); if (this.selected) this.select(this.selected, false); }
  /** Call before every change the user makes. */
  remember() { this.history.undo.push(this.snap()); if (this.history.undo.length > 100) this.history.undo.shift(); this.history.redo = []; }
  undo() { const s = this.history.undo.pop(); if (!s) return; this.history.redo.push(this.snap()); this.restore(s); toast(t('act.undone')); }
  redo() { const s = this.history.redo.pop(); if (!s) return; this.history.undo.push(this.snap()); this.restore(s); toast(t('act.redone')); }
  renderHistory() { ($('#undo') as HTMLButtonElement).disabled = !this.history.undo.length; ($('#redo') as HTMLButtonElement).disabled = !this.history.redo.length; }

  // ---------- moving furniture ----------
  private D = (s: SlotId) => dimsOf(this.product(s), s);
  pose(key: SlotId): Pose | null { const p = this.layout?.placements.find(x => x.slot === key); return p ? { x: p.x, z: p.z, rot: p.rot } : null; }
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
    if (pose) mv[key] = { x: round3(pose.x), z: round3(pose.z), rot: pose.rot }; else delete mv[key];
    this.project.moves = mv; this.afterChange();
    if (this.selected) this.select(this.selected, false);
  }
  private dragHandler() {
    return {
      grab: (slot: SlotId) => {
        const key = moveKey(slot);
        if (!key || !this.selected || moveKey(this.selected) !== key || !this.product(key)) return null;
        const pose = this.pose(key); if (!pose) return null;
        return { key, group: [key, ...(MOVABLE[key] || [])], pose };
      },
      move: (key: SlotId, x: number, z: number, rot: number) => this.tryPose(key, x, z, rot),
      drop: (key: SlotId, pose: Pose) => this.movePiece(key, pose),
    };
  }
  /** Keyboard: T turns the selected piece, Shift+arrows nudge it 5 cm in the direction the camera sees as left/right/away/toward. */
  nudge(dx: number, dz: number, turn = false) {
    const key = this.selected && moveKey(this.selected); if (!key || !this.product(key)) return false;
    const p = this.pose(key); if (!p) return false;
    if (turn) { this.movePiece(key, turnPose(key, p, this.D)); return true; }
    const dir = new THREE.Vector3(); this.viewer?.camera.getWorldDirection(dir); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); dir.normalize();
    const v = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(dx).add(dir.clone().multiplyScalar(-dz)), step = 0.05;
    // step along the world axis closest to that direction, so the piece stays on the grid
    const [sx, sz] = Math.abs(v.x) >= Math.abs(v.z) ? [Math.sign(v.x) * step, 0] : [0, Math.sign(v.z) * step];
    this.movePiece(key, { x: round3(p.x + sx), z: round3(p.z + sz), rot: p.rot });
    return true;
  }
  product = (s: SlotId): Product | undefined => { const id = this.sel[s]; return id ? this.ix?.byId.get(id) : undefined; };

  // ---------- 3D ----------
  wallH() { return this.views[this.viewIdx]?.interior ? this.project.wallHeight : 1.05; }
  buildRoot(lowPoly = false, wallH = this.wallH()) {
    const f = this.layout && this.ix ? { product: this.product, dims: (s: SlotId) => dimsOf(this.product(s), s), layout: this.layout } : null;
    return buildApartment(this.project, f, { wallH, lowPoly: lowPoly || !!this.viewer?.soft }, this.M, this.models);
  }
  rebuild() {
    if (!this.viewer) return;
    const b = bounds(this.project.rooms);
    this.viewer.setRoot(this.buildRoot(), new THREE.Box3(new THREE.Vector3(b.x1, 0, b.z1), new THREE.Vector3(b.x2, 3, b.z2)));
    this.viewer.setLabels(this.views[this.viewIdx]?.interior ? [] : this.project.rooms.map(r => ({ text: `${this.roomName(r.id)} · ${t('misc.area', { a: fmtNum(roomArea(r), 1) })}`, x: r.x + r.w / 2, z: r.z + r.d / 2 })));
  }
  setView(i: number, instant = false, forceBuild = false) {
    if (!this.views[i]) return;
    const wasInterior = this.views[this.viewIdx]?.interior;
    this.viewIdx = i;
    $('#views').querySelectorAll('button').forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    if (wasInterior !== this.views[i].interior || forceBuild) this.rebuild();
    this.viewer?.setView(this.views[i], instant);
    $('#viewer').classList.toggle('interior', this.views[i].interior);
  }
  roomName(id: string) {
    const r = this.project.rooms.find(x => x.id === id); if (!r) return id;
    if (r.name) return r.name;
    const same = this.project.rooms.filter(x => x.type === r.type);
    return t(('room.' + r.type) as Key) + (same.length > 1 ? ' ' + (same.indexOf(r) + 1) : '');
  }
  select(slot: SlotId | null, moveCam: boolean) {
    this.selected = slot;
    this.viewer?.highlight(slot);
    document.querySelectorAll('.slot').forEach(el => el.classList.toggle('on', (el as HTMLElement).dataset.slot === slot));
    if (slot && moveCam) {
      const pl = this.layout?.placements.find(p => p.slot === slot);
      const vi = pl ? this.views.findIndex(v => v.room === pl.room && v.interior) : -1;
      if (vi >= 0 && vi !== this.viewIdx) this.setView(vi);
      setTimeout(() => { const c = this.viewer?.slotCenter(slot); if (c) this.viewer?.lookAtPoint(c); }, vi >= 0 ? 700 : 0);
    }
    this.renderCard();
  }

  // ---------- rendering the UI ----------
  applyLang() {
    const L = getLang();
    document.documentElement.lang = L === 'sr' ? 'sr-Latn' : L;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = tt(el.dataset.i18n!); });
    document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(el => { const s = tt(el.dataset.i18nLabel!); el.setAttribute('aria-label', s); el.title = s; });
    $('#list').setAttribute('aria-label', t('list.label'));
    document.title = `FlatFit · ${t('app.tagline')}`;
    this.renderSelects(); this.renderViews(); this.renderList(); this.rebuild(); this.render.applyLang();
  }
  renderSelects() {
    const ps = $('#project') as HTMLSelectElement;
    ps.innerHTML = this.projects.map(p => `<option value="${esc(p.id)}" ${p.id === this.project?.id ? 'selected' : ''}>${esc(p.demo ? t('proj.demo') : p.name)}</option>`).join('')
      + `<option value="__new">${esc(t('nav.new'))}</option>` + (this.projects.length > 1 ? `<option value="__manage">${esc(t('nav.projects'))}…</option>` : '');
    ($('#country') as HTMLSelectElement).innerHTML = COUNTRIES.map(c => `<option value="${c.id}" ${c.id === this.prefs.country ? 'selected' : ''}>${esc(t(('country.' + c.id) as Key))} · ${c.currency}</option>`).join('');
    ($('#lang') as HTMLSelectElement).innerHTML = LANGS.map(l => `<option value="${l.id}" ${l.id === getLang() ? 'selected' : ''}>${l.label}</option>`).join('');
  }
  renderViews() {
    const host = $('#views');
    host.innerHTML = this.views.map((v, i) => `<button type="button" role="tab" id="view-${esc(v.id)}" aria-selected="${i === this.viewIdx}" tabindex="${i === this.viewIdx ? 0 : -1}"><kbd>${i}</kbd>${esc(v.room ? this.roomName(v.room) : t('view.overview'))}</button>`).join('');
    host.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => this.setView(i)));
    host.onkeydown = (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); e.stopPropagation(); const i = (this.viewIdx + d + this.views.length) % this.views.length; this.setView(i); (host.children[i] as HTMLElement).focus(); };
  }
  fmt(v: number) { return money(v, country(this.prefs.country!), localeOf()); }
  /** The look buttons depend only on the country, so they are drawn before the catalogue arrives (no layout shift). */
  renderPresets() {
    $('#presets').innerHTML = this.presetKeys().map(k => `<button type="button" class="chip ${STYLES.includes(k as Style) ? 'gen' : ''}" data-k="${k}" aria-pressed="${k === this.preset}">${esc(tt('preset.' + k))}</button>`).join('');
  }
  renderList() {
    this.renderPresets();
    if (!this.ix) return;
    const C = country(this.prefs.country!), ls = lines(this.project, this.sel, this.ix, today()), sum = total(ls), iss = fitIssues(this.project, this.sel, this.ix, this.layout || undefined);
    this.renderPresets();
    const stores = [...new Set(ls.filter(l => l.units && l.product && l.product.store !== 'est').map(l => this.storeName(l.product!.store)))];
    const promos = ls.filter(l => l.promo).length, expired = ls.filter(l => l.expired && l.units).length;
    const eur = C.eurRate ? `<span class="muted">${t('sum.approx', { v: money(Math.round(sum / C.eurRate), country('de'), localeOf()) })}</span>` : '';
    $('#summary').innerHTML = `<div class="total"><span>${t('sum.total')} <span class="muted">${this.preset !== 'custom' ? esc(t('sum.for', { name: tt('preset.' + this.preset) })) : esc(t('preset.custom'))}</span></span><b data-testid="total">${this.fmt(sum)}</b>${eur}</div>
      <p class="muted small">${esc(t('sum.stores', { list: stores.join(', ') }))}${promos ? ' · ' + esc(t('sum.promos', { n: promos })) : ''}</p>
      <p class="refresh small"><button type="button" class="link" data-refresh ${this.refreshing ? 'disabled' : ''} title="${esc(t('refresh.how', { date: '' }))}">↻ ${esc(t('act.refresh'))}</button> <span class="muted" id="refresh-note">${esc(this.refreshNote)}</span></p>
      ${expired ? `<p class="warn small">${esc(t('sum.expired', { n: expired }))}</p>` : ''}
      <ul class="issues" data-testid="issues">${iss.length ? iss.map(i => `<li class="${i.hard ? 'hard' : 'soft'}"><a href="#slot-${i.slot}" data-goto="${i.slot}">${esc(t(('slot.' + i.slot) as Key))}</a>: ${esc(this.issueText(i))}</li>`).join('') : `<li class="ok">${esc(t('sum.fits'))}</li>`}</ul>`;
    const bySlot = new Map(ls.map(l => [l.slot, l]));
    const active = activeSlots(this.project);
    $('#slots').innerHTML = GROUPS.map(g => {
      const sl = active.filter(s => s.group === g); if (!sl.length) return '';
      const gt = sl.reduce((s, x) => s + (bySlot.get(x.id)?.total || 0), 0);
      return `<section class="group"><h3><span>${esc(t(('group.' + g) as Key))}</span><span class="muted">${this.fmt(gt)}</span></h3>${sl.map(sd => this.slotHtml(sd.id, bySlot.get(sd.id)!, iss.filter(i => i.slot === sd.id))).join('')}</section>`;
    }).join('');
    const old = ls.filter(l => l.units && l.product?.checked && l.product.checked < this.ix!.cat.checked).map(l => l.product!);
    const hand = old.length ? ' ' + t('sum.handChecked', { stores: [...new Set(old.map(p => this.storeName(p.store)))].join(', '), date: fmtDate(old.map(p => p.checked!).sort()[0]) }) : '';
    $('#foot').textContent = `${t('sum.checked', { date: fmtDate(this.ix.cat.checked) })}${hand} · ${t('misc.footer')}`;
    if (this.selected) this.select(this.selected, false);
  }
  slotHtml(slot: SlotId, l: ReturnType<typeof lines>[number], iss: Issue[]) {
    const p = l.product, sd = slotDef(slot), opts = (this.ix!.bySlot.get(slot) || []).slice().sort((a, b) => a.price - b.price);
    const none = sd.optional || sd.dependent ? `<option value="" ${!p ? 'selected' : ''}>${esc(t('item.none'))}</option>` : '';
    const options = none + opts.map(o => `<option value="${esc(o.id)}" ${o.id === p?.id ? 'selected' : ''}>${esc(o.name)} · ${esc(this.storeName(o.store))} · ${this.fmt(effectivePrice(o, today()).price)}</option>`).join('');
    return `<div class="slot ${l.units === 0 && p ? 'zero' : ''}" data-slot="${slot}" id="slot-${slot}">
      <label for="sel-${slot}"><span>${esc(t(('slot.' + slot) as Key))}</span>${p ? `<span class="price">${l.units > 1 ? `<span class="muted">${esc(t('item.units', { n: l.units }))} ${this.fmt(l.unitPrice)} = </span>` : ''}${this.fmt(l.total)}</span>` : ''}</label>
      <select id="sel-${slot}" data-slot="${slot}">${options}</select>
      ${p ? `<div class="meta">${p.hex ? `<i class="sw" style="background:${esc(p.hex)}"></i>` : ''}<span>${esc(p.color)}</span>${p.w ? `<span>${dimTxt(p)}</span>` : ''}${this.flags(p, l)}<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('item.open'))} ↗</a></div>` : ''}
      ${iss.map(i => `<p class="issue ${i.hard ? 'hard' : 'soft'}">${esc((i.hard ? t('issue.hard') : t('issue.soft')) + this.issueText(i))}</p>`).join('')}
    </div>`;
  }
  flags(p: Product, l: { expired: boolean }) {
    let f = '';
    if (p.until) f += `<span class="flag ${l.expired ? 'old' : 'sale'}">${esc(t(l.expired ? 'item.ended' : 'item.until', { date: fmtDate(p.until) }))}</span>`;
    if (p.storeOnly) f += `<span class="flag">${esc(t('item.storeOnly'))}</span>`;
    if (p.estimate) f += `<span class="flag est">${esc(t('item.estimate'))}</span>`;
    if (p.checked && daysBetween(p.checked, today()) > 14) f += `<span class="flag" title="${esc(t('item.checkedHand'))}">${esc(t('item.priceFrom', { date: fmtDate(p.checked) }))}</span>`;
    return f;
  }
  issueText(i: Issue) { const v = { ...i.v }; if (v.other) v.other = t(v.other as Key); return t(('issue.' + i.code) as Key, v as Record<string, string | number>); }
  storeName(id: string) { return this.ix?.cat.stores.find(s => s.id === id)?.name || id; }

  renderCard() {
    const card = $('#card'), slot = this.selected;
    if (!slot || !this.ix) { card.hidden = true; return; }
    const p = this.product(slot), l = lines(this.project, this.sel, this.ix, today()).find(x => x.slot === slot);
    const alts = (this.ix.bySlot.get(slot) || []).filter(o => o.id !== p?.id).sort((a, b) => Math.abs(a.price - (p?.price || 0)) - Math.abs(b.price - (p?.price || 0))).slice(0, 3);
    card.innerHTML = `<div class="card-head"><h3>${esc(t(('slot.' + slot) as Key))}</h3><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      ${p ? `<p class="pname">${esc(p.name)}</p><p class="muted small">${esc(this.storeName(p.store))}${p.w ? ' · ' + dimTxt(p) : ''} · ${esc(p.color)}</p>
      <p class="big">${l && l.units > 1 ? `<span class="muted small">${esc(t('item.units', { n: l.units }))} ${this.fmt(l.unitPrice)} = </span>` : ''}${this.fmt(l?.total ?? p.price)}</p>
      <p>${this.flags(p, l || { expired: false })}</p><a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('item.open'))} ↗</a>` : `<p class="muted">${esc(t('item.none'))}</p>`}
      ${this.moveControls(slot)}
      ${alts.length ? `<h4>${esc(t('item.alt'))}</h4><ul class="alts">${alts.map(a => `<li><button type="button" data-alt="${esc(a.id)}"><span>${esc(a.name)}</span><span class="muted">${esc(this.storeName(a.store))}${a.w ? ' · ' + dimTxt(a) : ''}</span><b>${this.fmt(effectivePrice(a, today()).price)}</b></button></li>`).join('')}</ul>` : ''}`;
    card.hidden = false;
  }

  moveControls(slot: SlotId) {
    const key = moveKey(slot); if (!key || !this.product(key) || !this.pose(key)) return '';
    const moved = !!this.project.moves?.[key];
    return `<div class="move"><p class="muted small">${esc(t('item.moveHint'))}</p><div class="row">
      <button type="button" class="btn ghost" data-turn-piece>${esc(t('item.turn'))}</button>
      ${moved ? `<button type="button" class="btn ghost" data-reset-piece>${esc(t('item.resetPos'))}</button>` : ''}</div></div>`;
  }

  // ---------- events ----------
  bindChrome() {
    $('#presets').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]'); if (b) this.applyPreset(b.dataset.k!); });
    $('#slots').addEventListener('change', e => { const s = e.target as HTMLSelectElement; if (s.dataset.slot) this.setSlot(s.dataset.slot as SlotId, s.value); });
    $('#slots').addEventListener('click', e => { const el = e.target as HTMLElement; if (el.closest('a,select')) return; const sl = el.closest<HTMLElement>('.slot'); if (sl) this.select(sl.dataset.slot as SlotId, true); });
    $('#summary').addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-refresh]')) { this.refreshPrices(); return; } const a = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]'); if (!a) return; e.preventDefault(); const s = a.dataset.goto as SlotId; document.getElementById('sel-' + s)?.focus(); this.select(s, true); });
    $('#card').addEventListener('click', e => { const el = e.target as HTMLElement; if (el.closest('[data-close]')) this.select(null, false); const alt = el.closest<HTMLElement>('[data-alt]'); if (alt && this.selected) this.setSlot(this.selected, alt.dataset.alt!);
      if (el.closest('[data-turn-piece]')) this.nudge(0, 0, true);
      const key = this.selected && moveKey(this.selected); if (el.closest('[data-reset-piece]') && key) this.movePiece(key, null); });
    $('#undo').addEventListener('click', () => this.undo());
    $('#redo').addEventListener('click', () => this.redo());
    $('#country').addEventListener('change', e => { this.loadCountry((e.target as HTMLSelectElement).value); });
    $('#lang').addEventListener('change', e => { this.setLanguage((e.target as HTMLSelectElement).value as Lang); });
    $('#project').addEventListener('change', e => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === '__new') { this.renderSelects(); openEditor(this, null); return; }
      if (v === '__manage') { this.renderSelects(); this.manageProjects(); return; }
      this.switchProject(v);
    });
    $('#edit-plan').addEventListener('click', () => openEditor(this, this.project));
    $('#theme').addEventListener('click', () => this.toggleTheme());
    $('#help').addEventListener('click', () => this.help());
    $('#share').addEventListener('click', async () => { const url = this.shareUrl(); try { await navigator.clipboard.writeText(url); toast(t('act.copied')); } catch { prompt(t('act.share'), url); } });
    $('#csv').addEventListener('click', () => this.csv());
    $('#render-btn').addEventListener('click', () => this.render.open());
    document.querySelectorAll<HTMLElement>('[data-turn]').forEach(b => b.addEventListener('click', () => this.viewer?.turn(b.dataset.turn === 'left' ? 0.35 : -0.35, 0)));
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-close]')) (d as HTMLDialogElement).close(); }));
  }
  setLanguage(l: Lang) { setLang(l); this.prefs.lang = l; savePrefs(this.prefs); this.applyLang(); }
  switchProject(id: string) {
    const p = this.projects.find(x => x.id === id); if (!p) return;
    this.project = p; this.prefs.project = id; savePrefs(this.prefs); this.viewIdx = 0; this.selected = null; this.history = { undo: [], redo: [] };
    this.renderSelects(); this.loadCountry(this.prefs.country!);
  }
  /** Called by the editor after saving. */
  projectSaved(p: Project) {
    const i = this.projects.findIndex(x => x.id === p.id);
    // furniture moved by hand belongs to the old walls: start over from the planner when the plan changed
    const shape = (q: Project) => JSON.stringify([q.rooms, q.openings, q.open]);
    if (i >= 0 && shape(this.projects[i]) !== shape(p)) delete p.moves;
    if (i >= 0) this.projects[i] = p; else this.projects.push(p);
    saveProject(p); this.switchProject(p.id);
  }
  removeProject(id: string) { deleteProject(id); this.projects = this.projects.filter(p => p.id !== id); if (this.project.id === id) this.switchProject(this.projects[0].id); else this.renderSelects(); }
  toggleTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; this.prefs.theme = next; savePrefs(this.prefs);
  }
  csv() {
    if (!this.ix) return;
    const rows = [['Group', 'Item', 'Product', 'Store', 'Colour', 'Size (cm)', 'Units', 'Unit price', 'Total', 'Currency', 'Link']];
    for (const l of lines(this.project, this.sel, this.ix, today())) if (l.product && l.units) rows.push([t(('group.' + slotDef(l.slot).group) as Key), t(('slot.' + l.slot) as Key), l.product.name, this.storeName(l.product.store), l.product.color, dimTxt(l.product), String(l.units), String(l.unitPrice), String(l.total), country(this.prefs.country!).currency, l.product.url]);
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `flatfit-${this.prefs.country}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  help() {
    const d = $('#help-dlg') as HTMLDialogElement;
    const rows: [string, Key][] = [['0–9', 'help.views'], ['← → ↑ ↓', 'help.look'], ['+ −', 'help.zoom'], ['R', 'help.render'], ['E', 'help.edit'], ['L', 'help.lang'], ['T · Shift+← → ↑ ↓', 'help.move'], ['Ctrl+Z · Ctrl+Y', 'help.undo'], ['Esc', 'help.esc'], ['?', 'help.help']];
    d.innerHTML = `<div class="dlg-head"><h2 id="help-title">${esc(t('help.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      <dl class="keys">${rows.map(([k, s]) => `<div><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(t(s))}</dd></div>`).join('')}</dl><p class="muted">${esc(t('help.about'))}</p>`;
    d.showModal();
  }
  manageProjects() {
    const d = $('#help-dlg') as HTMLDialogElement;
    const own = this.projects.filter(p => !p.demo);
    d.innerHTML = `<div class="dlg-head"><h2 id="help-title">${esc(t('nav.projects'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      <ul class="plist">${own.map(p => `<li data-id="${esc(p.id)}"><span>${esc(p.name)} <span class="muted small">${fmtNum(p.rooms.reduce((s, r) => s + (r.type === 'terrace' ? 0 : roomArea(r)), 0), 1)} m²</span></span>
        <span class="row"><button type="button" class="btn ghost" data-act="open">${esc(t('nav.edit'))}</button><button type="button" class="btn ghost" data-act="export">${esc(t('proj.export'))}</button><button type="button" class="btn ghost danger" data-act="delete">${esc(t('proj.delete'))}</button></span></li>`).join('')}</ul>
      <label class="btn"><input type="file" accept="application/json,.json" hidden id="import-file">${esc(t('proj.import'))}</label>`;
    d.querySelector('.plist')!.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
      const id = b.closest<HTMLElement>('li')!.dataset.id!, p = this.projects.find(x => x.id === id)!;
      if (b.dataset.act === 'open') { d.close(); this.switchProject(id); openEditor(this, p); }
      if (b.dataset.act === 'export') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' })); a.download = (p.name || 'flat').replace(/[^\w-]+/g, '_') + '.json'; a.click(); }
      if (b.dataset.act === 'delete' && confirm(t('proj.confirmDelete', { name: p.name }))) { this.removeProject(id); d.close(); }
    });
    d.querySelector('#import-file')!.addEventListener('change', async e => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      try { const p = JSON.parse(await f.text()); if (!isProject(p)) throw 0; p.demo = false; if (this.projects.some(x => x.id === p.id)) p.id = p.id + '-' + Date.now().toString(36); this.projectSaved(p); toast(t('proj.imported')); d.close(); }
      catch { toast(t('proj.importFail')); }
    });
    d.showModal();
  }

  key(e: KeyboardEvent) {
    const tg = e.target as HTMLElement;
    const typing = tg.closest('input,select,textarea,[contenteditable]') || document.querySelector('dialog[open]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
      const ck = e.key.toLowerCase();
      if (ck === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (ck === 'y' || (ck === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return; }
    }
    if (e.ctrlKey || e.metaKey || e.altKey || tg.closest('input,select,textarea,[contenteditable]') || document.querySelector('dialog[open]')) {
      if (e.key === 'Escape' && this.render.running) { this.render.cancel(); e.preventDefault(); }
      return;
    }
    const k = e.key;
    if (/^[0-9]$/.test(k)) { this.setView(+k); return; }
    const nud: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (e.shiftKey && nud[k] && !tg.closest('[role=tablist]') && this.nudge(...nud[k])) { e.preventDefault(); return; }
    if ((k === 't' || k === 'T') && this.nudge(0, 0, true)) return;
    const turn: Record<string, [number, number]> = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] };
    if (turn[k] && !tg.closest('[role=tablist]')) { e.preventDefault(); this.viewer?.turn(...turn[k]); return; }
    if (k === '+' || k === '=') { this.viewer?.zoom(1 / 1.1); return; }
    if (k === '-' || k === '_') { this.viewer?.zoom(1.1); return; }
    if (k === 'r' || k === 'R') { this.render.open(); return; }
    if (k === 'e' || k === 'E') { openEditor(this, this.project); return; }
    if (k === 'l' || k === 'L') { const i = LANGS.findIndex(l => l.id === getLang()); this.setLanguage(LANGS[(i + 1) % LANGS.length].id); return; }
    if (k === '?') { this.help(); return; }
    if (k === 'Escape') this.select(null, false);
  }

  /** Lamp positions for the path tracer: one warm light under each room ceiling. */
  lamps(): [number, number, number][] { return this.project.rooms.filter(r => r.type !== 'terrace').map(r => [r.x + r.w / 2, this.project.wallHeight - 0.35, r.z + r.d / 2]); }
}

interface Snapshot { sel: Selection; preset: string; moves: Moves }
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
/** Keep only well-formed moves of movable pieces (share links can be edited by hand). */
function cleanMoves(raw: Record<string, unknown>): Moves {
  const out: Moves = {};
  for (const [k, v] of Object.entries(raw)) { const m = v as Pose; if (MOVABLE[k as SlotId] && m && [m.x, m.z, m.rot].every(n => typeof n === 'number' && Number.isFinite(n))) out[k as SlotId] = { x: m.x, z: m.z, rot: m.rot }; }
  return out;
}

export const localeOf = () => LANGS.find(l => l.id === getLang())!.locale;
export const fmtNum = (v: number, d = 0) => new Intl.NumberFormat(localeOf(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
export const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Intl.DateTimeFormat(localeOf(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d)); };
export const dimTxt = (p: Product) => p.w ? [p.w, p.d, p.h].filter(Boolean).map(x => fmtNum(x!, x! % 1 ? 1 : 0)).join(' × ') + ' cm' : '';

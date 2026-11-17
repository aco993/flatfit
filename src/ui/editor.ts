import type { App } from './app';
import type { Project } from '../types';
import { t, type Key } from '../i18n';
import { $, esc } from './dom';
import { fromTemplate, type TemplateId } from '../data/templates';
import { savedProvider } from './planai';
import { bindClicks, bindInputs } from './editor/actions';
import { bindPointer } from './editor/pointer';
import type { EditorState } from './editor/state';
import { draw } from './editor/view';

/**
 * Opens the floor-plan editor. `src` null = new apartment (choose a template).
 * The editor is split by concern under ./editor: state, view (plan and side panel), pointer (mouse, touch,
 * keyboard), actions (typing and buttons), backdrop (a picture of the plan) and ai (reading that picture).
 */
export function openEditor(app: App, src: Project | null) {
  const dlg = $('#editor-dlg') as HTMLDialogElement;
  const isNew = !src;
  let draft: Project = src ? structuredClone(src) : fromTemplate('tworoom', t('proj.untitled'), app.prefs.country || 'rs');
  if (draft.demo) {
    draft = { ...draft, id: 'p-' + Math.random().toString(36).slice(2, 9), name: t('proj.demo') + ' *', demo: false };
  }

  dlg.innerHTML = `
    <div class="dlg-head"><h2 id="editor-title">${esc(t('editor.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('editor.cancel'))}">✕</button></div>
    <div class="ed">
      <div class="ed-canvas"><svg id="ed-svg" tabindex="0" role="application" aria-label="${esc(t('editor.title'))}"></svg><div class="row tools" id="ed-tools"></div><p class="muted small" id="ed-hint">${esc(t('editor.hint'))}</p></div>
      <div class="ed-side">
        ${src?.demo ? `<p class="note">${esc(t('proj.demoCopy'))}</p>` : ''}
        ${isNew ? `<fieldset class="tpl"><legend>${esc(t('tpl.title'))}</legend>${(['tworoom', 'studio', 'demo', 'empty'] as TemplateId[]).map(k => `<button type="button" class="chip" data-tpl="${k}">${esc(t(('tpl.' + k) as Key))}</button>`).join('')}</fieldset>` : ''}
        <label class="field"><span>${esc(t('editor.projectName'))}</span><input id="ed-name" maxlength="60"></label>
        <label class="field"><span>${esc(t('editor.wallH'))}</span><input id="ed-wallh" type="number" min="2.2" max="4" step="0.05"></label>
        <p id="ed-total" class="muted"></p>
        <fieldset class="bd"><legend>${esc(t('bd.title'))}</legend><div id="ed-bd"></div><div id="ed-ai"></div></fieldset>
        <div class="row"><button type="button" class="btn" id="ed-add">+ ${esc(t('editor.add'))}</button></div>
        <div id="ed-room"></div>
        <ul id="ed-problems" class="issues"></ul>
        <div class="row end"><button type="button" class="btn ghost" id="ed-measure">📏 ${esc(t('ms.btn'))}</button><button type="button" class="btn ghost" data-close>${esc(t('editor.cancel'))}</button><button type="button" class="btn primary" id="ed-save">${esc(t('editor.save'))}</button></div>
      </div>
    </div>`;

  const S: EditorState = {
    app,
    dlg,
    svg: $('#ed-svg', dlg) as unknown as SVGSVGElement,
    nameIn: $('#ed-name', dlg) as HTMLInputElement,
    hIn: $('#ed-wallh', dlg) as HTMLInputElement,
    draft,
    selId: draft.rooms[0]?.id || null,
    mode: 'none',
    opKind: 'door',
    rubber: null,
    calPts: [],
    drag: null,
    imgDrag: null,
    aiFor: null,
    aiBusy: false,
    prov: savedProvider(),
    redraw: () => draw(S),
  };
  bindPointer(S);
  bindInputs(S);
  bindClicks(S);
  draw(S);
  if (!dlg.open) dlg.showModal();
}

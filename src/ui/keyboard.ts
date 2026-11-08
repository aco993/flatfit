import { LANGS, getLang, t, type Key } from '../i18n';
import type { App } from './app';
import { $, esc } from './dom';
import { openEditor } from './editor';

/** Keyboard shortcuts for the whole page; they stay quiet while the user types or a dialog is open. */
export function onKey(app: App, e: KeyboardEvent) {
  const tg = e.target as HTMLElement;
  const typing = !!(tg.closest('input,select,textarea,[contenteditable]') || document.querySelector('dialog[open]'));
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
    const ck = e.key.toLowerCase();
    if (ck === 'z' && !e.shiftKey) {
      e.preventDefault();
      app.undo();
      return;
    }
    if (ck === 'y' || (ck === 'z' && e.shiftKey)) {
      e.preventDefault();
      app.redo();
      return;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey || typing) {
    if (e.key === 'Escape' && app.render.running) {
      app.render.cancel();
      e.preventDefault();
    }
    return;
  }
  const k = e.key,
    inTabs = !!tg.closest('[role=tablist]');
  if (/^[0-9]$/.test(k)) {
    app.setView(+k);
    return;
  }
  // Shift + arrows nudge the selected piece; plain arrows look around
  const nudge: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (e.shiftKey && nudge[k] && !inTabs && app.nudge(...nudge[k])) {
    e.preventDefault();
    return;
  }
  if ((k === 't' || k === 'T') && app.nudge(0, 0, true)) return;
  const look: Record<string, [number, number]> = {
    ArrowLeft: [0.12, 0],
    ArrowRight: [-0.12, 0],
    ArrowUp: [0, 0.08],
    ArrowDown: [0, -0.08],
  };
  if (look[k] && !inTabs) {
    e.preventDefault();
    app.viewer?.turn(...look[k]);
    return;
  }
  if (k === '+' || k === '=') {
    app.viewer?.zoom(1 / 1.1);
    return;
  }
  if (k === '-' || k === '_') {
    app.viewer?.zoom(1.1);
    return;
  }
  if (k === 'r' || k === 'R') {
    app.render.open();
    return;
  }
  if (k === 'e' || k === 'E') {
    openEditor(app, app.project);
    return;
  }
  if (k === 'l' || k === 'L') {
    const i = LANGS.findIndex(l => l.id === getLang());
    app.setLanguage(LANGS[(i + 1) % LANGS.length].id);
    return;
  }
  if (k === '?') {
    showHelp();
    return;
  }
  if (k === 'Escape') app.select(null, false);
}

export function showHelp() {
  const d = $('#help-dlg') as HTMLDialogElement;
  const rows: [string, Key][] = [
    ['0–9', 'help.views'],
    ['← → ↑ ↓', 'help.look'],
    ['+ −', 'help.zoom'],
    ['R', 'help.render'],
    ['E', 'help.edit'],
    ['L', 'help.lang'],
    ['T · Shift+← → ↑ ↓', 'help.move'],
    ['Ctrl+Z · Ctrl+Y', 'help.undo'],
    ['Esc', 'help.esc'],
    ['?', 'help.help'],
  ];
  d.innerHTML = `<div class="dlg-head"><h2 id="help-title">${esc(t('help.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      <dl class="keys">${rows.map(([k, s]) => `<div><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(t(s))}</dd></div>`).join('')}</dl><p class="muted">${esc(t('help.about'))}</p>`;
  d.showModal();
}

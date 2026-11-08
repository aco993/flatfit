import { t, type Key } from '../i18n';
import { country } from '../data/countries';
import { slotDef } from '../domain/slots';
import { roomArea } from '../domain/geometry';
import { lines } from '../domain/selection';
import { isProject } from '../store';
import type { App } from './app';
import { $, esc, toast } from './dom';
import { openEditor } from './editor';
import { dimTxt, fmtNum, today } from './format';

/** "My flats": open in the editor, export as JSON, delete, import. */
export function manageProjects(app: App) {
  const d = $('#help-dlg') as HTMLDialogElement;
  const own = app.projects.filter(p => !p.demo);
  const area = (p: (typeof own)[number]) =>
    fmtNum(
      p.rooms.reduce((s, r) => s + (r.type === 'terrace' ? 0 : roomArea(r)), 0),
      1,
    );
  d.innerHTML = `<div class="dlg-head"><h2 id="help-title">${esc(t('nav.projects'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      <ul class="plist">${own
        .map(
          p => `<li data-id="${esc(p.id)}"><span>${esc(p.name)} <span class="muted small">${area(p)} m²</span></span>
        <span class="row"><button type="button" class="btn ghost" data-act="open">${esc(t('nav.edit'))}</button><button type="button" class="btn ghost" data-act="export">${esc(t('proj.export'))}</button><button type="button" class="btn ghost danger" data-act="delete">${esc(t('proj.delete'))}</button></span></li>`,
        )
        .join('')}</ul>
      <label class="btn"><input type="file" accept="application/json,.json" hidden id="import-file">${esc(t('proj.import'))}</label>`;
  d.querySelector('.plist')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const id = b.closest<HTMLElement>('li')!.dataset.id!,
      p = app.projects.find(x => x.id === id)!;
    if (b.dataset.act === 'open') {
      d.close();
      app.switchProject(id);
      openEditor(app, p);
    }
    if (b.dataset.act === 'export')
      download(JSON.stringify(p, null, 1), 'application/json', (p.name || 'flat').replace(/[^\w-]+/g, '_') + '.json');
    if (b.dataset.act === 'delete' && confirm(t('proj.confirmDelete', { name: p.name }))) {
      app.removeProject(id);
      d.close();
    }
  });
  d.querySelector('#import-file')!.addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!isProject(p)) throw new Error('not a FlatFit flat');
      p.demo = false;
      if (app.projects.some(x => x.id === p.id)) p.id = p.id + '-' + Date.now().toString(36);
      app.projectSaved(p);
      toast(t('proj.imported'));
      d.close();
    } catch {
      toast(t('proj.importFail'));
    }
  });
  d.showModal();
}

/** The shopping list as CSV: one row per item to buy, with the store link. */
export function exportCsv(app: App) {
  if (!app.ix) return;
  const rows = [['Group', 'Item', 'Product', 'Store', 'Colour', 'Size (cm)', 'Units', 'Unit price', 'Total', 'Currency', 'Link']];
  const currency = country(app.prefs.country!).currency;
  for (const l of lines(app.project, app.sel, app.ix, today())) {
    if (!l.product || !l.units) continue;
    rows.push([
      t(('group.' + slotDef(l.slot).group) as Key),
      t(('slot.' + l.slot) as Key),
      l.product.name,
      app.storeName(l.product.store),
      l.product.color,
      dimTxt(l.product),
      String(l.units),
      String(l.unitPrice),
      String(l.total),
      currency,
      l.product.url,
    ]);
  }
  // BOM so spreadsheet apps read the file as UTF-8
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(csv, 'text/csv', `flatfit-${app.prefs.country}.csv`);
}

function download(text: string, type: string, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

import type { SlotId } from '../types';
import { t, type Key } from '../i18n';
import { country } from '../data/countries';
import { makeOwnProduct, validOwn } from '../domain/own';
import { slotDef } from '../domain/slots';
import { loadOwn, saveOwn } from '../store';
import type { App } from './app';
import { $, esc, toast } from './dom';

/**
 * "Add a product from another store": name, price, link, size and colour of anything the catalogue does not have.
 * It joins this country's catalogue in this browser only, and is chosen for the slot right away.
 */
export function openOwn(app: App, slot: SlotId) {
  const d = $('#own-dlg') as HTMLDialogElement;
  const C = country(app.prefs.country!);
  const cur = C.currency === 'BAM' ? 'KM' : C.currency === 'EUR' ? '€' : C.currency;
  const sized = !slotDef(slot).dependent;
  const dimField = (k: 'w' | 'd' | 'h', label: Key) =>
    `<label class="field"><span>${esc(t(label))}</span><input name="${k}" type="number" min="1" max="1000" step="0.5" inputmode="decimal"></label>`;
  d.innerHTML = `<div class="dlg-head"><h2 id="own-title">${esc(t('own.title', { slot: t(('slot.' + slot) as Key) }))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <form class="own-form" novalidate>
      <label class="field"><span>${esc(t('own.name'))}</span><input name="name" type="text" maxlength="120" required autocomplete="off"></label>
      <label class="field"><span>${esc(t('own.price', { cur }))}</span><input name="price" type="number" min="1" step="any" inputmode="decimal" required></label>
      <label class="field"><span>${esc(t('own.url'))}</span><input name="url" type="text" inputmode="url" autocomplete="off" placeholder="https://"></label>
      ${sized ? `<fieldset><legend>${esc(t('own.size'))}</legend><div class="row">${dimField('w', 'own.w')}${dimField('d', 'own.d')}${dimField('h', 'own.h')}</div></fieldset>` : ''}
      <div class="row"><label class="field"><span>${esc(t('own.color'))}</span><input name="hex" type="color" value="#c9a27a"></label>
      <label class="field grow"><span>${esc(t('own.colorName'))}</span><input name="color" type="text" maxlength="40" autocomplete="off"></label></div>
      <p class="muted small">${esc(t('own.hint'))}</p>
      <p class="warn small" data-own-error hidden>${esc(t('own.bad'))}</p>
      <div class="row end"><button type="button" class="btn ghost" data-close>${esc(t('editor.cancel'))}</button><button type="submit" class="btn primary">${esc(t('own.save'))}</button></div>
    </form>`;
  const form = d.querySelector('form')!;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form),
      n = (k: string) => (f.get(k) === '' || f.get(k) === null ? undefined : Number(f.get(k)));
    const id = 'own-' + Date.now().toString(36);
    const p = makeOwnProduct(
      {
        slot,
        name: String(f.get('name') || ''),
        url: String(f.get('url') || ''),
        price: n('price') ?? 0,
        w: n('w'),
        d: n('d'),
        h: n('h'),
        color: String(f.get('color') || ''),
        hex: String(f.get('hex') || ''),
      },
      id,
    );
    if (!p) {
      (d.querySelector('[data-own-error]') as HTMLElement).hidden = false;
      return;
    }
    const cc = app.prefs.country!;
    saveOwn(cc, [...validOwn(loadOwn(cc)), p]);
    d.close();
    await app.loadCountry(cc);
    app.setSlot(slot, p.id);
    toast(t('own.added'));
  });
  d.showModal();
  (form.elements.namedItem('name') as HTMLInputElement).focus();
}

/** Remove an own product; the slot falls back to the cheapest catalogue product, so the setup stays complete. */
export async function removeOwn(app: App, id: string) {
  const cc = app.prefs.country!;
  const p = app.ix?.byId.get(id);
  saveOwn(
    cc,
    validOwn(loadOwn(cc)).filter(x => x.id !== id),
  );
  if (p && app.sel[p.slot] === id) {
    const next = (app.ix!.bySlot.get(p.slot) || []).filter(x => x.id !== id && x.store !== 'own').sort((a, b) => a.price - b.price)[0];
    if (next) app.sel = { ...app.sel, [p.slot]: next.id };
    else delete app.sel[p.slot];
    app.saveChoice();
  }
  await app.loadCountry(cc);
  if (p) app.select(p.slot, false);
}

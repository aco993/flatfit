import { t, type Key } from '../i18n';
import { DELIVERY } from '../data/delivery';
import { deliveryFor } from '../domain/delivery';
import { assemblyFor } from '../domain/assembly';
import { ASSEMBLY } from '../data/assembly';
import { lines } from '../domain/selection';
import { keepTicks, shoppingList, tickKey } from '../domain/shopping';
import type { App } from './app';
import { $, esc } from './dom';
import { today } from './format';

/**
 * The shopping list as a checklist for the shopping trip: one block per store with its delivery, a tick for
 * every item bought, and what is still left to pay. Ticks stay in this browser with the flat's choices.
 */
export function openShopping(app: App) {
  const d = $('#shop-dlg') as HTMLDialogElement;
  draw(app, d);
  d.showModal();
}

function draw(app: App, d: HTMLDialogElement) {
  if (!app.ix) return;
  const ls = lines(app.project, app.sel, app.ix, today());
  app.bought = keepTicks(ls, app.bought);
  const list = shoppingList(ls, app.bought);
  const del = new Map(deliveryFor(ls, DELIVERY[app.prefs.country!]).stores.map(s => [s.store, s]));
  const delText = (store: string) => {
    const s = del.get(store);
    if (!s || store === 'est') return '';
    if (s.unknown) return t('shop.deliveryBasket');
    return t('shop.delivery', { v: s.free ? app.fmt(0) : (s.from ? '≥ ' : '') + app.fmt(s.cost) });
  };
  const asm = new Map(assemblyFor(ls, ASSEMBLY[app.prefs.country!]).stores.map(s => [s.store, s]));
  const asmText = (store: string) => {
    const s = asm.get(store);
    if (!s) return '';
    if (s.unknown)
      return s.pieces
        ? t('shop.assemblyAsk', { n: s.pieces })
        : s.kitchen
          ? t('shop.assemblyKitchen')
          : s.appliances
            ? t('shop.connectAsk', { n: s.appliances })
            : '';
    return t('shop.assembly', { v: app.fmt(s.cost) });
  };
  const extra = (store: string) =>
    [delText(store), asmText(store)]
      .filter(Boolean)
      .map(x => ' · ' + esc(x))
      .join('');
  const scroll = d.querySelector('.shop')?.scrollTop || 0;
  d.innerHTML = `<div class="dlg-head"><h2 id="shop-title">${esc(t('shop.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <p class="shop-progress" aria-live="polite"><b>${esc(t('shop.progress', { n: list.boughtCount, m: list.count, v: app.fmt(list.left) }))}</b></p>
    <div class="shop">${list.stores
      .map(
        s => `<section><h3><span>${esc(app.storeName(s.store))}</span><span class="muted small">${esc(t('shop.store', { v: app.fmt(s.left) }))}${extra(s.store)}</span></h3>
      <ul>${s.items
        .map(i => {
          const key = tickKey(i.slot, i.product);
          return `<li class="${i.bought ? 'done' : ''}"><label><input type="checkbox" data-tick="${esc(key)}" ${i.bought ? 'checked' : ''}>
            <span><span class="muted small">${esc(t(('slot.' + i.slot) as Key))}</span> ${esc(i.product.name)}</span>
            <b>${i.units > 1 ? `${i.units} × ` : ''}${app.fmt(i.total)}</b></label>
            <a href="${esc(i.product.url)}" target="_blank" rel="noopener" aria-label="${esc(t('item.open') + ': ' + i.product.name)}">↗</a></li>`;
        })
        .join('')}</ul></section>`,
      )
      .join('')}</div>
    <p class="muted small">${esc(t('shop.hint'))}</p>
    <div class="row"><button type="button" class="btn ghost" data-untick ${list.boughtCount ? '' : 'disabled'}>${esc(t('shop.reset'))}</button></div>`;
  d.querySelector('.shop')!.scrollTop = scroll;
  d.querySelector('.shop')!.addEventListener('change', e => {
    const box = e.target as HTMLInputElement;
    const key = box.dataset.tick;
    if (!key) return;
    app.bought = box.checked ? [...app.bought, key] : app.bought.filter(k => k !== key);
    app.saveChoice();
    draw(app, d);
    (d.querySelector(`[data-tick="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
  });
  d.querySelector('[data-untick]')!.addEventListener('click', () => {
    app.bought = [];
    app.saveChoice();
    draw(app, d);
  });
}

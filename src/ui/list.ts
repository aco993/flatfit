import type { Product, SlotId } from '../types';
import { t, tt, type Key } from '../i18n';
import { country, money } from '../data/countries';
import { DELIVERY } from '../data/delivery';
import { GROUPS, activeSlots, slotDef } from '../domain/slots';
import { deliveryFor } from '../domain/delivery';
import { effectivePrice, fitIssues, lines, total, type Issue, type Line } from '../domain/selection';
import type { App } from './app';
import { $, esc } from './dom';
import { daysBetween, dimTxt, fmtDate, localeOf, today } from './format';

/** The right-hand column: look buttons, the summary (total, stores, delivery, fit issues) and the shopping list. */

/** The look buttons depend only on the country, so they are drawn before the catalogue arrives (no layout shift). */
export function renderPresets(app: App) {
  $('#presets').innerHTML = app.presetKeys().map(k => `<button type="button" class="chip ${app.isGenerated(k) ? 'gen' : ''}" data-k="${k}" aria-pressed="${k === app.preset}">${esc(tt('preset.' + k))}</button>`).join('');
}

export function renderList(app: App) {
  renderPresets(app);
  const ix = app.ix; if (!ix) return;
  const C = country(app.prefs.country!), ls = lines(app.project, app.sel, ix, today()), sum = total(ls);
  const iss = fitIssues(app.project, app.sel, ix, app.layout || undefined);

  const bin = $('#budget-in') as HTMLInputElement;
  if (document.activeElement !== bin) bin.value = String(Math.round(app.preset === 'budget' && app.budget ? app.budget : sum));
  $('#budget-cur').textContent = C.currency === 'BAM' ? 'KM' : C.currency === 'EUR' ? '€' : C.currency;

  const stores = [...new Set(ls.filter(l => l.units && l.product && l.product.store !== 'est').map(l => app.storeName(l.product!.store)))];
  const promos = ls.filter(l => l.promo).length, expired = ls.filter(l => l.expired && l.units).length;
  const eur = C.eurRate ? `<span class="muted">${t('sum.approx', { v: money(Math.round(sum / C.eurRate), country('de'), localeOf()) })}</span>` : '';
  const forWhat = app.preset !== 'custom' ? t('sum.for', { name: app.presetName(app.preset) }) : t('preset.custom');
  const issues = iss.length
    ? iss.map(i => `<li class="${i.hard ? 'hard' : 'soft'}"><a href="#slot-${i.slot}" data-goto="${i.slot}">${esc(t(('slot.' + i.slot) as Key))}</a>: ${esc(issueText(i))}</li>`).join('')
    : `<li class="ok">${esc(t('sum.fits'))}</li>`;
  $('#summary').innerHTML = `<div class="total"><span>${t('sum.total')} <span class="muted">${esc(forWhat)}</span></span><b data-testid="total">${app.fmt(sum)}</b>${eur}</div>
      <p class="muted small">${esc(t('sum.stores', { list: stores.join(', ') }))}${promos ? ' · ' + esc(t('sum.promos', { n: promos })) : ''}</p>
      ${deliveryHtml(app, ls, sum)}
      <p class="refresh small"><button type="button" class="link" data-refresh ${app.prices.busy ? 'disabled' : ''} title="${esc(t('refresh.how', { date: '' }))}">↻ ${esc(t('act.refresh'))}</button> <span class="muted" id="refresh-note">${esc(app.prices.note)}</span></p>
      ${expired ? `<p class="warn small">${esc(t('sum.expired', { n: expired }))}</p>` : ''}
      <ul class="issues" data-testid="issues">${issues}</ul>`;

  const bySlot = new Map(ls.map(l => [l.slot, l]));
  const active = activeSlots(app.project);
  $('#slots').innerHTML = GROUPS.map(g => {
    const sl = active.filter(s => s.group === g); if (!sl.length) return '';
    const gt = sl.reduce((s, x) => s + (bySlot.get(x.id)?.total || 0), 0);
    return `<section class="group"><h3><span>${esc(t(('group.' + g) as Key))}</span><span class="muted">${app.fmt(gt)}</span></h3>${sl.map(sd => slotHtml(app, sd.id, bySlot.get(sd.id)!, iss.filter(i => i.slot === sd.id))).join('')}</section>`;
  }).join('');

  // prices of stores that block automatic checks are as old as the last check by hand: say which and since when
  const old = ls.filter(l => l.units && l.product?.checked && l.product.checked < ix.cat.checked).map(l => l.product!);
  const hand = old.length ? ' ' + t('sum.handChecked', { stores: [...new Set(old.map(p => app.storeName(p.store)))].join(', '), date: fmtDate(old.map(p => p.checked!).sort()[0]) }) : '';
  $('#foot').textContent = `${t('sum.checked', { date: fmtDate(ix.cat.checked) })}${hand} · ${t('misc.footer')}`;
  if (app.selected) app.select(app.selected, false);
}

function slotHtml(app: App, slot: SlotId, l: Line, iss: Issue[]) {
  const p = l.product, sd = slotDef(slot), opts = (app.ix!.bySlot.get(slot) || []).slice().sort((a, b) => a.price - b.price);
  const none = sd.optional || sd.dependent ? `<option value="" ${!p ? 'selected' : ''}>${esc(t('item.none'))}</option>` : '';
  const options = none + opts.map(o => `<option value="${esc(o.id)}" ${o.id === p?.id ? 'selected' : ''}>${esc(o.name)} · ${esc(app.storeName(o.store))} · ${app.fmt(effectivePrice(o, today()).price)}</option>`).join('');
  const price = p ? `<span class="price">${l.units > 1 ? `<span class="muted">${esc(t('item.units', { n: l.units }))} ${app.fmt(l.unitPrice)} = </span>` : ''}${app.fmt(l.total)}</span>` : '';
  const meta = p
    ? `<div class="meta">${p.hex ? `<i class="sw" style="background:${esc(p.hex)}"></i>` : ''}<span>${esc(p.color)}</span>${p.w ? `<span>${dimTxt(p)}</span>` : ''}${flags(p, l)}<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('item.open'))} ↗</a></div>`
    : '';
  return `<div class="slot ${l.units === 0 && p ? 'zero' : ''}" data-slot="${slot}" id="slot-${slot}">
      <label for="sel-${slot}"><span>${esc(t(('slot.' + slot) as Key))}</span>${price}</label>
      <select id="sel-${slot}" data-slot="${slot}">${options}</select>
      ${meta}
      ${iss.map(i => `<p class="issue ${i.hard ? 'hard' : 'soft'}">${esc((i.hard ? t('issue.hard') : t('issue.soft')) + issueText(i))}</p>`).join('')}
    </div>`;
}

/** Sale, store-only, estimate and stale-price labels of a product. */
export function flags(p: Product, l: { expired: boolean }) {
  let f = '';
  if (p.until) f += `<span class="flag ${l.expired ? 'old' : 'sale'}">${esc(t(l.expired ? 'item.ended' : 'item.until', { date: fmtDate(p.until) }))}</span>`;
  if (p.storeOnly) f += `<span class="flag">${esc(t('item.storeOnly'))}</span>`;
  if (p.estimate) f += `<span class="flag est">${esc(t('item.estimate'))}</span>`;
  if (p.checked && daysBetween(p.checked, today()) > 14) f += `<span class="flag" title="${esc(t('item.checkedHand'))}">${esc(t('item.priceFrom', { date: fmtDate(p.checked) }))}</span>`;
  return f;
}

export function issueText(i: Issue) {
  const v = { ...i.v };
  if (v.other) v.other = t(v.other as Key);
  return t(('issue.' + i.code) as Key, v as Record<string, string | number>);
}

/** Home delivery store by store, and the total with it (data/delivery.ts has the sources). */
function deliveryHtml(app: App, ls: Line[], sum: number) {
  const d = deliveryFor(ls, DELIVERY[app.prefs.country!]);
  if (!d.stores.length) return '';
  const names = (list: typeof d.stores) => list.map(s => app.storeName(s.store)).join(', ');
  const parts: string[] = [];
  if (d.total > 0) parts.push(t(d.from ? 'del.from' : 'del.line', { v: app.fmt(d.total) }));
  const free = d.stores.filter(s => s.free);
  if (free.length) parts.push(t('del.free', { stores: names(free) }));
  if (d.unknown.length) parts.push(t('del.unknown', { stores: names(d.unknown) }));
  const title = d.stores.map(s => `${app.storeName(s.store)}: ${s.unknown ? '?' : s.free ? '0' : (s.from ? '≥ ' : '') + app.fmt(s.cost)}`).join(' · ');
  const withDelivery = d.total > 0 ? ` · <b>${esc(t('del.total', { v: app.fmt(sum + d.total) }))}</b>` : '';
  return `<p class="muted small delivery" title="${esc(title)}">${esc(parts.join(' · '))}${withDelivery}</p>`;
}

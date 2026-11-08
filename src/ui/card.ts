import type { SlotId } from '../types';
import { t, type Key } from '../i18n';
import { moveKey } from '../domain/moves';
import { effectivePrice, lines } from '../domain/selection';
import type { App } from './app';
import { $, esc } from './dom';
import { dimTxt, today } from './format';
import { flags } from './list';

/** The card of the selected piece: product, price, store link, how to move it, and nearby alternatives. */
export function renderCard(app: App) {
  const card = $('#card'),
    slot = app.selected,
    ix = app.ix;
  if (!slot || !ix) {
    card.hidden = true;
    return;
  }
  const p = app.product(slot),
    l = lines(app.project, app.sel, ix, today()).find(x => x.slot === slot);
  // alternatives closest in price to the current pick
  const alts = (ix.bySlot.get(slot) || [])
    .filter(o => o.id !== p?.id)
    .sort((a, b) => Math.abs(a.price - (p?.price || 0)) - Math.abs(b.price - (p?.price || 0)))
    .slice(0, 3);
  const units =
    l && l.units > 1 ? `<span class="muted small">${esc(t('item.units', { n: l.units }))} ${app.fmt(l.unitPrice)} = </span>` : '';
  const body = p
    ? `<p class="pname">${esc(p.name)}</p><p class="muted small">${esc(app.storeName(p.store))}${p.w ? ' · ' + dimTxt(p) : ''} · ${esc(p.color)}</p>
      <p class="big">${units}${app.fmt(l?.total ?? p.price)}</p>
      <p>${flags(p, l || { expired: false })}</p><a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('item.open'))} ↗</a>`
    : `<p class="muted">${esc(t('item.none'))}</p>`;
  const altList = alts.length
    ? `<h4>${esc(t('item.alt'))}</h4><ul class="alts">${alts.map(a => `<li><button type="button" data-alt="${esc(a.id)}"><span>${esc(a.name)}</span><span class="muted">${esc(app.storeName(a.store))}${a.w ? ' · ' + dimTxt(a) : ''}</span><b>${app.fmt(effectivePrice(a, today()).price)}</b></button></li>`).join('')}</ul>`
    : '';
  card.innerHTML = `<div class="card-head"><h3>${esc(t(('slot.' + slot) as Key))}</h3><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      ${body}
      ${moveControls(app, slot)}
      ${altList}`;
  card.hidden = false;
}

function moveControls(app: App, slot: SlotId) {
  const key = moveKey(slot);
  if (!key || !app.product(key) || !app.pose(key)) return '';
  const moved = !!app.project.moves?.[key];
  return `<div class="move"><p class="muted small">${esc(t('item.moveHint'))}</p><div class="row">
      <button type="button" class="btn ghost" data-turn-piece>${esc(t('item.turn'))}</button>
      ${moved ? `<button type="button" class="btn ghost" data-reset-piece>${esc(t('item.resetPos'))}</button>` : ''}</div></div>`;
}

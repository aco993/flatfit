import type { SlotId } from '../types';
import { t, type Key } from '../i18n';
import { moveKey } from '../domain/moves';
import { effectivePrice, lines } from '../domain/selection';
import type { App } from './app';
import { $, esc } from './dom';
import { dimTxt, fmtDate, today } from './format';
import type { PriceStats } from '../domain/history';
import { compareHtml, flags } from './list';

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
  const st = p ? app.priceStats(p) : null;
  const body = p
    ? `<p class="pname">${esc(p.name)}</p><p class="muted small">${esc(app.storeName(p.store))}${p.w ? ' · ' + dimTxt(p) : ''} · ${esc(p.color)}</p>
      <p class="big">${units}${app.fmt(l?.total ?? p.price)}${st?.droppedFrom ? ` <s class="muted small">${esc(t('hist.was', { v: app.fmt(st.droppedFrom) }))}</s>` : ''}</p>
      <p>${flags(p, l || { expired: false }, st)}</p>${historyHtml(app, st)}<a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('item.open'))} ↗</a>${compareHtml(p, app.prefs.country!)}`
    : `<p class="muted">${esc(t('item.none'))}</p>`;
  const altList = alts.length
    ? `<h4>${esc(t('item.alt'))}</h4><ul class="alts">${alts.map(a => `<li><button type="button" data-alt="${esc(a.id)}"><span>${esc(a.name)}</span><span class="muted">${esc(app.storeName(a.store))}${a.w ? ' · ' + dimTxt(a) : ''}</span><b>${app.fmt(effectivePrice(a, today()).price)}</b></button></li>`).join('')}</ul>`
    : '';
  card.innerHTML = `<div class="card-head"><h3>${esc(t(('slot.' + slot) as Key))}</h3><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
      ${body}
      ${moveControls(app, slot)}
      ${altList}
      <div class="own-actions">${p?.store === 'own' ? `<button type="button" class="btn ghost" data-own-remove="${esc(p.id)}">${esc(t('own.remove'))}</button>` : ''}<button type="button" class="btn ghost" data-own-add>${esc(t('own.add'))}</button></div>`;
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

/** A small step chart of the price since the history starts, with the 30-day low and high in words. */
function historyHtml(app: App, st: PriceStats | null) {
  if (!st || st.points.length < 2) return '';
  const W = 240,
    H = 44,
    pad = 3;
  const t0 = Date.parse(st.from),
    t1 = Date.parse(st.points.at(-1)![0]),
    span = Math.max(1, t1 - t0);
  const ps = st.points.map(([, v]) => v),
    lo = Math.min(...ps),
    hi = Math.max(...ps),
    range = Math.max(1, hi - lo);
  const x = (d: string) => pad + ((Date.parse(d) - t0) / span) * (W - 2 * pad),
    y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  // a step line: the price holds until the next change
  let path = `M${x(st.points[0][0]).toFixed(1)},${y(st.points[0][1]).toFixed(1)}`;
  for (let i = 1; i < st.points.length; i++) {
    const [d, v] = st.points[i];
    path += `H${x(d).toFixed(1)}V${y(v).toFixed(1)}`;
  }
  path += `H${W - pad}`;
  const last = st.points.at(-1)!;
  return `<figure class="hist"><figcaption class="muted small">${esc(t('hist.title', { date: fmtDate(st.from) }))}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('hist.range', { lo: app.fmt(st.low30), hi: app.fmt(st.high30) }))}"><path d="${path}" /><circle cx="${(W - pad).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3" /></svg>
      <p class="muted small">${esc(t('hist.range', { lo: app.fmt(st.low30), hi: app.fmt(st.high30) }))}</p></figure>`;
}

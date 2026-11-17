import { t, type Key } from '../i18n';
import { country } from '../data/countries';
import { DELIVERY } from '../data/delivery';
import { deliveryFor } from '../domain/delivery';
import { payback, type PaybackInput } from '../domain/payback';
import { lines } from '../domain/selection';
import type { App } from './app';
import { $, esc } from './dom';
import { fmtNum, today } from './format';

/** Rents typed in are kept per flat in this browser (they are the landlord's figures, not part of a shared link). */
const KEY = 'flatfit.rent.';
function load(id: string): PaybackInput {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + id) || 'null');
    if (v && typeof v === 'object')
      return { furnished: +v.furnished || 0, unfurnished: +v.unfurnished || 0, occupancy: v.occupancy ?? 100 };
  } catch {
    /* storage blocked */
  }
  return { furnished: 0, unfurnished: 0, occupancy: 100 };
}
function save(id: string, v: PaybackInput) {
  try {
    localStorage.setItem(KEY + id, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

/** "Does furnishing pay?": furniture cost and wear against the extra rent, for the flat as it is chosen now. */
export function openPayback(app: App) {
  const d = $('#payback-dlg') as HTMLDialogElement;
  const C = country(app.prefs.country!);
  const cur = C.currency === 'BAM' ? 'KM' : C.currency === 'EUR' ? '€' : C.currency;
  const v = load(app.project.id);
  const field = (name: keyof PaybackInput, label: string, value: number, extra = '') =>
    `<label class="field"><span>${esc(label)}</span><input name="${name}" type="number" min="0" step="any" inputmode="decimal" value="${value || ''}" ${extra}></label>`;
  d.innerHTML = `<div class="dlg-head"><h2 id="payback-title">${esc(t('pay.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <form class="pay-form">
      ${field('furnished', t('pay.furnished', { cur }), v.furnished)}
      ${field('unfurnished', t('pay.unfurnished', { cur }), v.unfurnished, `aria-describedby="pay-unf-hint"`)}
      <p class="muted small" id="pay-unf-hint">${esc(t('pay.unfurnishedHint'))}</p>
      ${field('occupancy', t('pay.occupancy'), v.occupancy, 'max="100"')}
    </form>
    <div class="pay-out" aria-live="polite"></div>`;
  const form = d.querySelector('form')!;
  const out = d.querySelector('.pay-out') as HTMLElement;
  const draw = () => {
    const f = new FormData(form),
      n = (k: string) => Number(f.get(k)) || 0;
    const input: PaybackInput = {
      furnished: n('furnished'),
      unfurnished: n('unfurnished'),
      occupancy: f.get('occupancy') === '' ? 100 : n('occupancy'),
    };
    save(app.project.id, input);
    if (!app.ix) return;
    const ls = lines(app.project, app.sel, app.ix, today());
    const p = payback(ls, deliveryFor(ls, DELIVERY[app.prefs.country!]).total, input);
    if (!input.furnished) {
      out.innerHTML = `<p class="muted">${esc(t('pay.cost', { v: app.fmt(p.cost) }))}</p><p>${esc(t('pay.empty'))}</p>`;
      return;
    }
    const soon = p.soonest.map(s => t('pay.soonItem', { slot: t(('slot.' + s.slot) as Key), y: s.years })).join(', ');
    out.innerHTML = `<p>${esc(t('pay.cost', { v: app.fmt(p.cost) }))}</p>
      <p>${esc(t('pay.extra', { v: app.fmt(Math.round(p.extra)) }))}</p>
      <p class="pay-big">${p.months === null ? esc(t('pay.never')) : esc(t('pay.months', { n: p.months, y: fmtNum(p.months / 12, 1) }))}</p>
      <p>${esc(t('pay.wear', { v: app.fmt(Math.round(p.wear)) }))}</p>
      <p><b>${esc(t('pay.net', { v: app.fmt(Math.round(p.net)) }))}</b></p>
      ${soon ? `<p class="muted small">${esc(t('pay.soonest', { list: soon }))}</p>` : ''}
      <p class="muted small">${esc(t('pay.note'))}</p>`;
  };
  form.addEventListener('input', draw);
  form.addEventListener('submit', e => e.preventDefault());
  draw();
  d.showModal();
}

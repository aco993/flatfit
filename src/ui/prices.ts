import type { SlotId } from '../types';
import { t } from '../i18n';
import { applyUpdates, refreshPrices } from '../data/refresh';
import { fixDeps, indexCatalog } from '../domain/selection';
import { loadPriceUpdates, savePriceUpdates } from '../store';
import type { App } from './app';
import { toast } from './dom';
import { today } from './format';

/** "Refresh prices": IKEA live, other stores from the daily check (data/refresh.ts); kept in this browser. */
export class PriceRefresh {
  private ctl: AbortController | null = null;
  /** last result, shown next to the button */
  note = '';
  constructor(private app: App) {}
  get busy() { return !!this.ctl; }

  async run() {
    const app = this.app;
    if (!app.ix || this.ctl) return;
    const id = app.prefs.country!, ctl = new AbortController();
    this.ctl = ctl; this.note = t('refresh.busy', { done: 0, total: '…' }); app.renderList();
    const show = (s: string) => { this.note = s; const el = document.getElementById('refresh-note'); if (el) el.textContent = s; };
    try {
      const { updates, report } = await refreshPrices(app.ix.cat, today(), { signal: ctl.signal, onProgress: (done, total) => show(t('refresh.busy', { done, total })) });
      if (app.prefs.country !== id || !app.ix) return;
      savePriceUpdates(id, { ...loadPriceUpdates(id), ...updates });
      const ix = app.ix = indexCatalog(applyUpdates(app.ix.cat, updates));
      // a piece the store stopped selling is swapped for the cheapest one in its place
      const sel = { ...app.sel };
      for (const [slot, pid] of Object.entries(sel) as [SlotId, string][]) {
        if (!pid || ix.byId.has(pid)) continue;
        const alt = (ix.bySlot.get(slot) || []).slice().sort((a, b) => a.price - b.price)[0];
        if (alt) sel[slot] = alt.id; else delete sel[slot];
      }
      app.sel = fixDeps(sel, ix);
      const msg = !report.live && report.failed ? t('refresh.fail') : report.changed ? t('refresh.done', { changed: report.changed, sales: report.newSales }) : t('refresh.none');
      this.note = msg; toast(msg);
    } catch { this.note = t('refresh.fail'); } finally {
      if (this.ctl === ctl) this.ctl = null;
      app.afterChange();
    }
  }
  /** a new country or flat starts without the old message */
  reset() { this.note = ''; }
}

import type { App } from './app';
import { t, type Key } from '../i18n';
import { $, esc } from './dom';
import {
  Cancelled,
  QUALITY,
  denoiseFilter,
  denoiseOIDN,
  outputSize,
  previewInto,
  suggestQuality,
  trace,
  type Progress,
  type Quality,
} from '../three/pathtrace';
import { savePrefs } from '../store';

/** The "Photoreal render" dialog: pick quality, watch progress, finish early or cancel at any time. */
export class RenderDialog {
  running = false;
  private stopNow = false;
  private cancelled = false;
  private previewTimer = 0;
  constructor(private app: App) {}

  private get dlg() {
    return $('#render-dlg') as HTMLDialogElement;
  }
  private quality(): Quality {
    return (this.app.prefs.quality as Quality) || suggestQuality();
  }

  applyLang() {
    const q = this.quality();
    $('#quality').innerHTML =
      `<legend>${esc(t('render.quality'))}</legend>` +
      (Object.keys(QUALITY) as Quality[])
        .map(
          k =>
            `<label><input type="radio" name="q" value="${k}" ${k === q ? 'checked' : ''}><span><b>${esc(t(('render.q.' + k) as Key))}</b> <span class="muted small">${esc(t(('render.q.' + k + '.d') as Key))}</span></span></label>`,
        )
        .join('');
  }

  open() {
    if (!this.app.viewer) return;
    const d = this.dlg;
    if (!d.open) d.showModal();
    this.applyLang();
    if (!this.running) {
      this.reset();
    }
    d.onclose = () => {
      if (this.running) this.cancel();
    };
    d.oncancel = e => {
      if (this.running) {
        e.preventDefault();
        this.cancel();
      }
    };
    $('#quality').onchange = e => {
      this.app.prefs.quality = (e.target as HTMLInputElement).value as Quality;
      savePrefs(this.app.prefs);
    };
    $('#pt-start').onclick = () => this.run();
    $('#pt-finish').onclick = () => {
      this.stopNow = true;
    };
    $('#pt-cancel').onclick = () => this.cancel();
    if (!this.running) $('#pt-start').focus();
  }
  cancel() {
    this.cancelled = true;
  }

  private reset() {
    $('#pt-status').textContent = '';
    ($('#pt-fill') as HTMLElement).style.width = '0%';
    $('#pt-img').hidden = true;
    $('#pt-canvas').hidden = false;
    $('#pt-save').hidden = true;
    // until tracing starts, show the view that will be rendered instead of an empty black box
    const c = $('#pt-canvas') as HTMLCanvasElement;
    this.app.viewer?.snapshot(c);
    c.classList.add('waiting');
    this.buttons(false);
  }
  private buttons(running: boolean) {
    $('#pt-start').hidden = running;
    $('#pt-finish').hidden = !running;
    $('#pt-cancel').hidden = !running;
    ($('#quality').querySelectorAll('input') as NodeListOf<HTMLInputElement>).forEach(i => {
      i.disabled = running;
    });
    if ($('#pt-start').textContent !== t('render.again') && !running && !$('#pt-img').hidden)
      $('#pt-start').textContent = t('render.again');
  }
  private status(s: string, pct?: number) {
    $('#pt-status').textContent = s;
    if (pct !== undefined) {
      ($('#pt-fill') as HTMLElement).style.width = Math.round(pct) + '%';
      $('#pt-bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    }
  }

  async run() {
    const app = this.app,
      v = app.viewer!;
    if (this.running) return;
    this.running = true;
    this.stopNow = false;
    this.cancelled = false;
    this.reset();
    this.buttons(true);
    $('#pt-canvas').classList.remove('waiting');
    const q = this.quality(),
      view = app.views[app.viewIdx],
      interior = !!view?.interior;
    const r = $('#viewer').getBoundingClientRect(),
      { w, h } = outputSize(r.width, r.height, q);
    const canvas = $('#pt-canvas') as HTMLCanvasElement;
    const t0 = performance.now();
    this.status(t('render.scene'), 2);
    try {
      // each heavy step is followed by a pause so the dialog stays responsive (Cancel works) on slow machines
      const breathe = () => new Promise(res => setTimeout(res, 30));
      await breathe();
      // decorative models load lazily; the render must not miss them
      await app.models.load(import.meta.env.BASE_URL);
      if (this.cancelled) throw new Cancelled();
      const root = app.buildRoot(true, interior ? app.project.wallHeight : 1.05);
      await breathe();
      if (this.cancelled) throw new Cancelled();
      let aux: { normal: Uint8ClampedArray; albedo: Uint8ClampedArray } | null = null;
      try {
        aux = v.renderAux(w, h, root);
      } catch {
        aux = null;
      }
      await breathe();
      if (this.cancelled) throw new Cancelled();
      this.previewTimer = window.setInterval(() => previewInto(canvas), 500);
      const res = await trace(
        {
          root,
          camera: v.camera,
          width: r.width,
          height: r.height,
          quality: q,
          interior,
          lamps: app.lamps(),
          finish: () => this.stopNow,
          cancel: () => this.cancelled,
          onProgress: (p: Progress) => {
            if (p.phase === 'scene') this.status(t('render.scene'), 4);
            else if (p.phase === 'compile') this.status(t('render.compile', { s: p.seconds }), 8);
            else if (p.phase === 'recover') this.status(t('render.recover', { a: p.attempt }), 5);
            else
              this.status(
                t('render.samples', { n: Math.floor(p.samples), t: p.target, eta: p.eta !== null ? t('render.eta', { s: p.eta }) : '' }),
                10 + (85 * p.samples) / p.target,
              );
          },
        },
        canvas,
      );
      clearInterval(this.previewTimer);
      if (res.samples === 0) throw new Error(t('render.tooEarly'));
      this.status(t('render.denoise'), 97);
      await new Promise(res2 => setTimeout(res2, 20));
      let out: HTMLCanvasElement,
        how: Key = 'render.how.oidn';
      try {
        if (!aux) throw 0;
        out = await denoiseOIDN(res.canvas, aux, import.meta.env.BASE_URL);
      } catch {
        out = denoiseFilter(res.canvas);
        how = 'render.how.filter';
      }
      const url = out.toDataURL('image/jpeg', 0.92);
      // the listing sheet uses the last photoreal image as its main photo
      app.lastRender = { url, view: view?.id || '' };
      const img = $('#pt-img') as HTMLImageElement;
      img.src = url;
      img.alt = t('render.title') + ' · ' + (view?.room ? app.roomName(view.room) : t('view.overview'));
      img.hidden = false;
      canvas.hidden = true;
      const save = $('#pt-save') as HTMLAnchorElement;
      save.href = url;
      save.hidden = false;
      this.status(t('render.done', { n: Math.floor(res.samples), s: Math.round((performance.now() - t0) / 1000), how: t(how) }), 100);
    } catch (e) {
      clearInterval(this.previewTimer);
      if (e instanceof Cancelled) this.status(t('render.cancelled'), 0);
      else
        this.status(t('render.fail', { e: (e as Error)?.message === 'gpu-reset' ? 'GPU reset' : String((e as Error)?.message || e) }), 0);
    } finally {
      this.running = false;
      this.buttons(false);
    }
  }
}

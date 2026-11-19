import { getLang, t, type Key } from '../i18n';
import { country } from '../data/countries';
import { mainRooms, spaceArea } from '../domain/geometry';
import { generate, lines, total } from '../domain/selection';
import { applyBrief, BRIEF_SCHEMA, briefPrompt, parseBrief, type Brief } from '../domain/stylist';
import type { App } from './app';
import { $, esc } from './dom';
import { fmtNum, today } from './format';
import {
  errorWhy,
  GEMINI_URL,
  keyRemembered,
  MODEL,
  PROVIDERS,
  type Provider,
  savedKey,
  savedProvider,
  storeKey,
  storeProvider,
  type Why,
} from './planai';

type Answer = { ok: true; brief: Brief } | { ok: false; why: Why | 'none'; detail?: string };

/** Gemini (free with a Google AI Studio key) or Claude (paid): the same question, the same JSON schema. */
async function ask(p: Provider, key: string, prompt: string): Promise<Answer> {
  const parse = (text: string | undefined): Answer => {
    try {
      const b = parseBrief(JSON.parse(text || ''));
      return b ? { ok: true, brief: b } : { ok: false, why: 'none' };
    } catch {
      return { ok: false, why: 'failed', detail: 'not JSON' };
    }
  };
  if (p === 'gemini') {
    let r: Response;
    try {
      r = await fetch(GEMINI_URL, {
        method: 'POST',
        // the key goes in a header, never in the URL
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: BRIEF_SCHEMA },
        }),
      });
    } catch (e) {
      return { ok: false, ...errorWhy('gemini', undefined, String((e as Error).message || e)) };
    }
    if (!r.ok) return { ok: false, ...errorWhy('gemini', r.status, await r.text().catch(() => '')) };
    const res = (await r.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    return parse(
      (res.candidates?.[0]?.content?.parts || [])
        .filter(x => !x.thought)
        .map(x => x.text || '')
        .join(''),
    );
  }
  // loaded only when someone uses it: keeps the SDK out of the first page load
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      output_config: { format: { type: 'json_schema' as const, schema: BRIEF_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user' as const, content: prompt }],
    });
    if (msg.stop_reason === 'refusal') return { ok: false, why: 'refused' };
    return parse(msg.content.find(b => b.type === 'text')?.text);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { ok: false, ...errorWhy('claude', err.status, String(err.message || e)) };
  }
}

/**
 * "Describe what you want": a sentence becomes a look, a budget and a few wishes; FlatFit's planner then picks real
 * products for them. The wish and the key go from the browser straight to the service; FlatFit keeps nothing.
 */
export function openStylist(app: App) {
  const d = $('#stylist-dlg') as HTMLDialogElement;
  let prov = savedProvider();
  d.innerHTML = `<div class="dlg-head"><h2 id="stylist-title">${esc(t('sty.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <form class="sty-form">
      <label class="field"><span>${esc(t('sty.wish'))}</span><textarea name="wish" rows="3" maxlength="600" placeholder="${esc(t('sty.placeholder'))}" required></textarea></label>
      <fieldset class="prov"><legend>${esc(t('ai.who'))}</legend>${PROVIDERS.map(v => `<label class="check"><input type="radio" name="prov" value="${v}" ${v === prov ? 'checked' : ''}> ${esc(t(('ai.' + v) as Key))}</label>`).join('')}</fieldset>
      <p class="note small" data-note></p>
      <label class="field"><span>${esc(t('ai.key'))}</span><input name="key" type="password" autocomplete="off" spellcheck="false"></label>
      <label class="check"><input type="checkbox" name="remember"> ${esc(t('ai.remember'))}</label>
      <p class="muted small">${esc(t('sty.privacy'))}</p>
      <div class="row"><button type="submit" class="btn primary">${esc(t('sty.send'))}</button></div>
      <p class="sty-out" role="status" aria-live="polite"></p>
    </form>`;
  const form = d.querySelector('form')!,
    out = d.querySelector('.sty-out') as HTMLElement,
    keyIn = form.elements.namedItem('key') as HTMLInputElement,
    remember = form.elements.namedItem('remember') as HTMLInputElement;
  const showProvider = (p: Provider) => {
    prov = p;
    storeProvider(p);
    keyIn.value = savedKey(p);
    keyIn.placeholder = p === 'gemini' ? 'AIza…' : 'sk-ant-…';
    remember.checked = keyRemembered(p);
    (d.querySelector('[data-note]') as HTMLElement).innerHTML =
      p === 'gemini'
        ? `${esc(t('ai.geminiNote'))} <a href="https://aistudio.google.com/docs/api-key" target="_blank" rel="noopener">${esc(t('ai.getKey'))} ↗</a>`
        : esc(t('ai.claudeNote'));
  };
  showProvider(prov);
  form.addEventListener('change', e => {
    const el = e.target as HTMLInputElement;
    if (el.name === 'prov') showProvider(el.value as Provider);
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!app.ix) return;
    const wish = String(new FormData(form).get('wish') || '').trim(),
      key = keyIn.value.trim();
    if (!wish) return;
    if (!key) {
      out.textContent = t('ai.noKey');
      keyIn.focus();
      return;
    }
    storeKey(prov, key, remember.checked);
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    btn.disabled = true;
    out.textContent = t('sty.busy');
    const ix = app.ix,
      C = country(app.prefs.country!);
    const rooms = mainRooms(app.project)
      .map(r => `${app.roomName(r.id)} ${fmtNum(spaceArea(app.project, r.id), 1)} m²`)
      .join(', ');
    const prompt = briefPrompt(wish, {
      currency: C.currency,
      lang: getLang(),
      rooms,
      cheapest: total(lines(app.project, generate('cheap', app.project, ix, today()), ix, today())),
      current: total(lines(app.project, app.sel, ix, today())),
    });
    const res = await ask(prov, key, prompt);
    btn.disabled = false;
    if (!res.ok) {
      out.textContent =
        res.why === 'failed'
          ? t('sty.failed', { e: res.detail || '?' })
          : res.why === 'none' || res.why === 'cut'
            ? t('sty.none')
            : res.why === 'refused'
              ? t('sty.refused')
              : t(('ai.' + res.why) as Key);
      return;
    }
    const r = applyBrief(res.brief, app.project, ix, today());
    app.applySelection(r.sel);
    out.innerHTML = `${res.brief.note ? `<b>${esc(res.brief.note)}</b><br>` : ''}${esc(t('sty.done', { v: app.fmt(r.total) }))}${r.budgetUsed && res.brief.budget ? ' ' + esc(t('sty.budget', { v: app.fmt(res.brief.budget) })) : ''}`;
  });
  d.showModal();
  (form.elements.namedItem('wish') as HTMLTextAreaElement).focus();
}

import { getLang, t, type Key } from '../i18n';
import { country } from '../data/countries';
import { mainRooms, spaceArea } from '../domain/geometry';
import { generate, lines, total, type Selection } from '../domain/selection';
import { applyBrief, BRIEF_SCHEMA, briefPrompt, changes, parseBrief, type Brief, type Turn } from '../domain/stylist';
import type { App } from './app';
import { $, esc } from './dom';
import { fmtNum, today } from './format';
import {
  errorWhy,
  GEMINI_URL,
  keyRemembered,
  PROVIDERS,
  type Provider,
  savedKey,
  savedProvider,
  storeKey,
  storeProvider,
  type Why,
} from './planai';

/**
 * The stylist only fills in a few settings, so the paid option uses Claude's small, fast model: a wish costs a
 * fraction of a cent. Plan reading, which needs to see a drawing, keeps the large model.
 */
const STYLIST_MODEL = 'claude-haiku-5-5';

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
    const msg = await client.messages.create({
      model: STYLIST_MODEL,
      max_tokens: 2000,
      // filling in a few fields: little thinking needed; the schema keeps the answer to the fields
      output_config: { effort: 'low', format: { type: 'json_schema', schema: BRIEF_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === 'refusal') return { ok: false, why: 'refused' };
    return parse(msg.content.find(b => b.type === 'text')?.text);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { ok: false, ...errorWhy('claude', err.status, String(err.message || e)) };
  }
}

/** One exchange as shown in the dialog: the wish, how it was understood, what changed in the list. */
interface Entry {
  wish: string;
  html: string;
}
/** The conversation lives while the page is open, for one flat in one country; nothing is stored. */
let convo: { key: string; turns: Turn[]; log: Entry[] } = { key: '', turns: [], log: [] };

/**
 * "Describe what you want": a sentence becomes a look, a budget and a few wishes; FlatFit's planner then picks real
 * products for them. Then it is a conversation: "a cheaper TV", "another sofa, darker", "under 2,000 € but keep the
 * bed" change only that. The wish and the key go from the browser straight to the service; FlatFit keeps nothing.
 */
export function openStylist(app: App) {
  const d = $('#stylist-dlg') as HTMLDialogElement;
  const here = `${app.project.id}|${app.prefs.country}`;
  if (convo.key !== here) convo = { key: here, turns: [], log: [] };
  let prov = savedProvider();
  d.innerHTML = `<div class="dlg-head"><h2 id="stylist-title">${esc(t('sty.title'))}</h2><button type="button" class="icon" data-close aria-label="${esc(t('item.close'))}">✕</button></div>
    <section class="sty-log" aria-label="${esc(t('sty.log'))}" aria-live="polite"></section>
    <form class="sty-form">
      <label class="field"><span data-wish-label></span><textarea name="wish" rows="3" maxlength="600" required></textarea></label>
      <details class="sty-key"${savedKey(prov) ? '' : ' open'}><summary>${esc(t('ai.key'))} · ${esc(t('sty.who'))}</summary>
        <fieldset class="prov"><legend>${esc(t('sty.who'))}</legend>${PROVIDERS.map(v => `<label class="check"><input type="radio" name="prov" value="${v}" ${v === prov ? 'checked' : ''}> ${esc(t(('sty.' + v) as Key))}</label>`).join('')}</fieldset>
        <p class="note small" data-note></p>
        <label class="field"><span>${esc(t('ai.key'))}</span><input name="key" type="password" autocomplete="off" spellcheck="false"></label>
        <label class="check"><input type="checkbox" name="remember"> ${esc(t('ai.remember'))}</label>
      </details>
      <p class="muted small">${esc(t('sty.privacy'))}</p>
      <div class="row"><button type="submit" class="btn primary"></button><button type="button" class="btn ghost" data-restart>${esc(t('sty.restart'))}</button></div>
      <p class="sty-out" role="status" aria-live="polite"></p>
    </form>`;
  const form = d.querySelector('form')!,
    out = d.querySelector('.sty-out') as HTMLElement,
    logEl = d.querySelector('.sty-log') as HTMLElement,
    wishIn = form.elements.namedItem('wish') as HTMLTextAreaElement,
    keyIn = form.elements.namedItem('key') as HTMLInputElement,
    remember = form.elements.namedItem('remember') as HTMLInputElement,
    send = form.querySelector('button[type="submit"]') as HTMLButtonElement,
    restart = form.querySelector('[data-restart]') as HTMLButtonElement;
  // first a wish, then what to change
  const showStage = () => {
    const follow = convo.turns.length > 0;
    (form.querySelector('[data-wish-label]') as HTMLElement).textContent = t(follow ? 'sty.follow' : 'sty.wish');
    wishIn.placeholder = t(follow ? 'sty.followPh' : 'sty.placeholder');
    send.textContent = t(follow ? 'sty.change' : 'sty.send');
    restart.hidden = !follow;
    logEl.hidden = !convo.log.length;
    logEl.innerHTML = convo.log
      .map(e => `<div class="sty-turn"><p class="sty-you"><b>${esc(t('sty.you'))}:</b> ${esc(e.wish)}</p>${e.html}</div>`)
      .join('');
    logEl.scrollTop = logEl.scrollHeight;
  };
  const showProvider = (p: Provider) => {
    prov = p;
    storeProvider(p);
    keyIn.value = savedKey(p);
    keyIn.placeholder = p === 'gemini' ? 'AIza…' : 'sk-ant-…';
    remember.checked = keyRemembered(p);
    (d.querySelector('[data-note]') as HTMLElement).innerHTML =
      p === 'gemini'
        ? `${esc(t('ai.geminiNote'))} <a href="https://aistudio.google.com/docs/api-key" target="_blank" rel="noopener">${esc(t('ai.getKey'))} ↗</a>`
        : esc(t('sty.claudeNote'));
  };
  showProvider(prov);
  showStage();
  form.addEventListener('change', e => {
    const el = e.target as HTMLInputElement;
    if (el.name === 'prov') showProvider(el.value as Provider);
  });
  restart.addEventListener('click', () => {
    convo = { key: here, turns: [], log: [] };
    out.textContent = '';
    showStage();
    wishIn.focus();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!app.ix) return;
    const wish = wishIn.value.trim(),
      key = keyIn.value.trim();
    if (!wish) return;
    if (!key) {
      (d.querySelector('.sty-key') as HTMLDetailsElement).open = true;
      out.textContent = t('ai.noKey');
      keyIn.focus();
      return;
    }
    storeKey(prov, key, remember.checked);
    send.disabled = true;
    out.textContent = t('sty.busy');
    const ix = app.ix,
      C = country(app.prefs.country!),
      day = today(),
      before: Selection = { ...app.sel };
    const rooms = mainRooms(app.project)
      .map(r => `${app.roomName(r.id)} ${fmtNum(spaceArea(app.project, r.id), 1)} m²`)
      .join(', ');
    const setup = lines(app.project, before, ix, day)
      .filter(l => l.product)
      .map(l => `${l.slot}: ${l.product!.name}, ${Math.round(l.total)} ${C.currency}`)
      .join('; ');
    const prompt = briefPrompt(wish, {
      currency: C.currency,
      lang: getLang(),
      rooms,
      cheapest: total(lines(app.project, generate('cheap', app.project, ix, day), ix, day)),
      current: total(lines(app.project, before, ix, day)),
      earlier: convo.turns,
      setup,
    });
    const res = await ask(prov, key, prompt);
    send.disabled = false;
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
    const followUp = convo.turns.length > 0;
    const sumBefore = total(lines(app.project, before, ix, day));
    const r = applyBrief(res.brief, app.project, ix, day, followUp ? before : {});
    app.applySelection(r.sel);
    const diff = changes(before, r.sel, ix);
    const parts: string[] = [];
    if (res.brief.note) parts.push(`<p class="sty-note">${esc(res.brief.note)}</p>`);
    if (followUp)
      parts.push(
        diff.length
          ? `<ul class="sty-diff" aria-label="${esc(t('sty.changed'))}">${diff
              .map(c => `<li><b>${esc(t(('slot.' + c.slot) as Key))}</b>: ${esc(c.from || '—')} → ${esc(c.to || '—')}</li>`)
              .join('')}</ul><p class="small">${esc(t('sty.total', { a: app.fmt(sumBefore), b: app.fmt(r.total) }))}</p>`
          : `<p class="small">${esc(t('sty.nothing'))}</p>`,
      );
    else parts.push(`<p class="small">${esc(t('sty.done', { v: app.fmt(r.total) }))}</p>`);
    if (res.brief.budget && r.budgetUsed)
      parts.push(
        `<p class="small">${esc(r.total <= res.brief.budget ? t('sty.budget', { v: app.fmt(res.brief.budget) }) : t('sty.over', { v: app.fmt(r.total), b: app.fmt(res.brief.budget) }))}</p>`,
      );
    convo.turns.push({ wish, brief: res.brief });
    convo.log.push({ wish, html: parts.join('') });
    out.textContent = '';
    wishIn.value = '';
    showStage();
    wishIn.focus();
  });
  d.showModal();
  wishIn.focus();
}

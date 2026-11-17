import { t, type Key } from '../../i18n';
import { placeBackdrop } from '../../domain/planread';
import { $, esc } from '../dom';
import { keyRemembered, PROVIDERS, type Provider, readPlan, savedKey, storeKey, storeProvider } from '../planai';
import type { EditorState } from './state';

/** "Read the rooms from the picture": drawn once per picture, so what is typed in it survives redraws. */
export function aiPanel(S: EditorState) {
  const host = $('#ed-ai', S.dlg),
    src = S.draft.backdrop?.src || null;
  if (src === S.aiFor) return;
  S.aiFor = src;
  host.innerHTML = !src
    ? ''
    : `<details class="ai"><summary>✨ ${esc(t('ai.title'))}</summary>
        <p class="muted small">${esc(t('ai.intro'))}</p>
        <fieldset class="prov"><legend>${esc(t('ai.who'))}</legend>${PROVIDERS.map(
          v =>
            `<label class="check"><input type="radio" name="ed-ai-prov" value="${v}" ${v === S.prov ? 'checked' : ''}> ${esc(t(('ai.' + v) as Key))}</label>`,
        ).join('')}</fieldset>
        <p class="note small" id="ed-ai-note"></p>
        <label class="field"><span>${esc(t('ai.key'))}</span><input id="ed-ai-key" type="password" autocomplete="off" spellcheck="false"></label>
        <label class="check"><input type="checkbox" id="ed-ai-remember"> ${esc(t('ai.remember'))}</label>
        <label class="field"><span>${esc(t('ai.hint'))}</span><input id="ed-ai-hint" maxlength="200" placeholder="${esc(t('ai.hintPh'))}"></label>
        <p class="muted small">${esc(t('ai.privacy'))} ${esc(t('ai.replace'))}</p>
        <div class="row"><button type="button" class="btn primary" id="ed-ai-send">${esc(t('ai.send'))}</button><button type="button" class="btn ghost" id="ed-ai-forget">${esc(t('ai.forget'))}</button></div>
        <p id="ed-ai-out" class="small" role="status" aria-live="polite"></p></details>`;
  if (src) aiProvider(S, S.prov);
}

/** Switches the panel to a provider: its key, its note (free or paid), its key format. */
export function aiProvider(S: EditorState, p: Provider) {
  const { dlg } = S;
  S.prov = p;
  storeProvider(p);
  const keyIn = $('#ed-ai-key', dlg) as HTMLInputElement;
  keyIn.value = savedKey(p);
  keyIn.placeholder = p === 'gemini' ? 'AIza…' : 'sk-ant-…';
  ($('#ed-ai-remember', dlg) as HTMLInputElement).checked = keyRemembered(p);
  $('#ed-ai-note', dlg).innerHTML =
    p === 'gemini'
      ? `${esc(t('ai.geminiNote'))} <a href="https://aistudio.google.com/docs/api-key" target="_blank" rel="noopener">${esc(t('ai.getKey'))} ↗</a>`
      : esc(t('ai.claudeNote'));
  $('#ed-ai-out', dlg).textContent = '';
}

export function forgetKey(S: EditorState) {
  storeKey(S.prov, '', false);
  ($('#ed-ai-key', S.dlg) as HTMLInputElement).value = '';
  ($('#ed-ai-remember', S.dlg) as HTMLInputElement).checked = false;
}

/** Sends the picture to the chosen service with the user's key and replaces the rooms with what it read. */
export async function runAi(S: EditorState) {
  const { dlg, draft } = S;
  const bd = draft.backdrop,
    out = $('#ed-ai-out', dlg),
    keyIn = $('#ed-ai-key', dlg) as HTMLInputElement,
    key = keyIn.value.trim(),
    btn = $('#ed-ai-send', dlg) as HTMLButtonElement;
  if (!bd || S.aiBusy) return;
  if (!key) {
    out.textContent = t('ai.noKey');
    keyIn.focus();
    return;
  }
  storeKey(S.prov, key, ($('#ed-ai-remember', dlg) as HTMLInputElement).checked);
  S.aiBusy = true;
  btn.disabled = true;
  out.textContent = t('ai.busy');
  let res: Awaited<ReturnType<typeof readPlan>>;
  try {
    res = await readPlan(S.prov, bd.src, key, ($('#ed-ai-hint', dlg) as HTMLInputElement).value);
  } catch (e) {
    res = { ok: false, why: 'failed', detail: String((e as Error).message || e) };
  }
  S.aiBusy = false;
  btn.disabled = false;
  if (!res.ok) {
    out.textContent = res.why === 'failed' ? t('ai.failed', { e: res.detail || '?' }) : t(('ai.' + res.why) as Key);
    return;
  }
  const plan = res.plan;
  draft.rooms = plan.rooms;
  draft.openings = plan.openings;
  draft.open = plan.open;
  draft.wallItems = [];
  if (draft.backdrop) Object.assign(draft.backdrop, placeBackdrop(plan, draft.backdrop.ar));
  S.selId = plan.rooms[0]?.id || null;
  S.mode = 'none';
  S.calPts = [];
  S.redraw();
  out.innerHTML = esc(t('ai.done', { n: plan.rooms.length })) + (plan.notes ? `<br><b>${esc(t('ai.notes'))}:</b> ${esc(plan.notes)}` : '');
}

import { fromReading, PLAN_SCHEMA, planPrompt, type ReadPlan } from '../domain/planread';

/**
 * "Read the rooms from the picture": the plan goes from the user's browser straight to an AI
 * provider with the user's own key. FlatFit has no server and pays for nothing; the key stays
 * in this browser (session only unless the user ticks "remember").
 *
 * - Gemini (Google AI Studio key): has a free daily quota. On the free tier Google may use what
 *   is sent to improve its products; the panel says so.
 * - Claude (Anthropic key): paid per use, a few cents per plan; best at reading dimension lines.
 */

export type Provider = 'gemini' | 'claude';
export const PROVIDERS: Provider[] = ['gemini', 'claude'];
export const MODEL = 'claude-opus-5-5';
export const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const KEY: Record<Provider, string> = { gemini: 'flatfit.geminiKey', claude: 'flatfit.claudeKey' };
const PROVIDER = 'flatfit.aiProvider';
/** Long edge the models see images at without downscaling them themselves. */
const MAX_EDGE = 1568;

const store = (f: () => string | null | boolean) => {
  try {
    return f();
  } catch {
    return null;
  }
};
export const savedKey = (p: Provider) => (store(() => localStorage.getItem(KEY[p]) || sessionStorage.getItem(KEY[p])) as string) || '';
export const keyRemembered = (p: Provider) => !!store(() => !!localStorage.getItem(KEY[p]));
export function storeKey(p: Provider, key: string, remember: boolean) {
  store(() => {
    localStorage.removeItem(KEY[p]);
    sessionStorage.removeItem(KEY[p]);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY[p], key);
    return null;
  });
}
export const savedProvider = (): Provider => (store(() => localStorage.getItem(PROVIDER)) === 'claude' ? 'claude' : 'gemini');
export const storeProvider = (p: Provider) =>
  store(() => {
    localStorage.setItem(PROVIDER, p);
    return null;
  });

/** The Claude request body; pure so it can be checked without a network. */
export function planRequest(b64: string, mediaType: 'image/jpeg' | 'image/png', w: number, h: number, hint: string) {
  return {
    model: MODEL,
    max_tokens: 16000,
    // a declined request is retried server-side on the model Anthropic recommends for it
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    output_config: { format: { type: 'json_schema' as const, schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: b64 } },
          { type: 'text' as const, text: planPrompt(w, h, hint.trim()) },
        ],
      },
    ],
  };
}

/** The Gemini generateContent body: the picture, the question, JSON in our schema. */
export function geminiRequest(b64: string, mediaType: 'image/jpeg' | 'image/png', w: number, h: number, hint: string) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ inline_data: { mime_type: mediaType, data: b64 } }, { text: planPrompt(w, h, hint.trim()) }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PLAN_SCHEMA },
  };
}

/** The picture as the model should get it: at most 1568 px on the long edge, JPEG. */
async function prepare(src: string) {
  const im = new Image();
  await new Promise((ok, bad) => {
    im.onload = ok;
    im.onerror = bad;
    im.src = src;
  });
  const k = Math.min(1, MAX_EDGE / Math.max(im.naturalWidth, im.naturalHeight)),
    c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * k);
  c.height = Math.round(im.naturalHeight * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return { b64: c.toDataURL('image/jpeg', 0.9).split(',')[1], w: c.width, h: c.height };
}

export type Why = 'none' | 'refused' | 'cut' | 'badKey' | 'quota' | 'noCredit' | 'overloaded' | 'offline' | 'failed';
export type ReadResult = { ok: true; plan: ReadPlan } | { ok: false; why: Why; detail?: string };

function fromText(text: string | undefined, w: number, h: number): ReadResult {
  if (!text) return { ok: false, why: 'failed', detail: 'empty answer' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: 'failed', detail: 'not JSON' };
  }
  const plan = fromReading(raw, w, h);
  return plan ? { ok: true, plan } : { ok: false, why: 'none' };
}

/** What a finished Claude response means for us. Pure: tested with canned responses. */
export function readResponse(
  msg: { stop_reason?: string | null; content: { type: string; text?: string }[] },
  w: number,
  h: number,
): ReadResult {
  if (msg.stop_reason === 'refusal') return { ok: false, why: 'refused' };
  if (msg.stop_reason === 'max_tokens') return { ok: false, why: 'cut' };
  return fromText(msg.content.find(b => b.type === 'text')?.text, w, h);
}

interface GeminiAnswer {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}
/** What a finished Gemini response means for us. Pure. */
export function readGemini(res: GeminiAnswer, w: number, h: number): ReadResult {
  if (res.promptFeedback?.blockReason) return { ok: false, why: 'refused' };
  const c = res.candidates?.[0];
  if (!c) return { ok: false, why: 'failed', detail: 'no answer' };
  if (c.finishReason === 'MAX_TOKENS') return { ok: false, why: 'cut' };
  const text = (c.content?.parts || [])
    .filter(p => typeof p.text === 'string' && !p.thought)
    .map(p => p.text)
    .join('');
  if (!text && c.finishReason && c.finishReason !== 'STOP') return { ok: false, why: 'refused' };
  return fromText(text, w, h);
}

/** HTTP errors from either provider, in the user's terms. Pure. */
export function errorWhy(p: Provider, status: number | undefined, body: string): { why: Why; detail?: string } {
  if (status === undefined) return { why: 'offline', detail: body };
  if (p === 'gemini') {
    // the free daily quota is used up (or the per-minute limit hit)
    if (status === 429 || /RESOURCE_EXHAUSTED/.test(body)) return { why: 'quota' };
    if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) return { why: 'badKey' };
    if (status === 401 || status === 403) return /billing|payment|FREE_TIER/i.test(body) ? { why: 'quota' } : { why: 'badKey' };
  } else {
    if (/credit balance/i.test(body)) return { why: 'noCredit' };
    if (status === 401 || status === 403) return { why: 'badKey' };
    if (status === 429) return { why: 'overloaded' };
  }
  if (status >= 500) return { why: 'overloaded' };
  return { why: 'failed', detail: `${status} ${body.slice(0, 160)}` };
}

async function viaGemini(img: { b64: string; w: number; h: number }, key: string, hint: string): Promise<ReadResult> {
  let r: Response;
  try {
    r = await fetch(GEMINI_URL, {
      method: 'POST',
      // the key goes in a header, never in the URL
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiRequest(img.b64, 'image/jpeg', img.w, img.h, hint)),
    });
  } catch (e) {
    return { ok: false, ...errorWhy('gemini', undefined, String((e as Error).message || e)) };
  }
  if (!r.ok) return { ok: false, ...errorWhy('gemini', r.status, await r.text().catch(() => '')) };
  return readGemini((await r.json()) as GeminiAnswer, img.w, img.h);
}

async function viaClaude(img: { b64: string; w: number; h: number }, key: string, hint: string): Promise<ReadResult> {
  // loaded only when someone uses it: keeps the SDK out of the first page load
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // the key belongs to the person using the page, typed by them, kept in their browser
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const msg = await client.beta.messages.create(planRequest(img.b64, 'image/jpeg', img.w, img.h, hint));
    return readResponse(msg, img.w, img.h);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { ok: false, ...errorWhy('claude', err.status, String(err.message || e)) };
  }
}

export async function readPlan(p: Provider, src: string, key: string, hint: string): Promise<ReadResult> {
  const img = await prepare(src);
  return p === 'gemini' ? viaGemini(img, key, hint) : viaClaude(img, key, hint);
}

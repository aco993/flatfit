import { fromReading, PLAN_SCHEMA, planPrompt, type ReadPlan } from '../domain/planread';

/**
 * "Read the rooms from the picture": the plan goes from the user's browser straight to the
 * Claude API with the user's own key. FlatFit has no server; the key stays in this browser
 * (session only unless the user ticks "remember").
 */

export const MODEL = 'claude-opus-5-5';
const KEY = 'flatfit.claudeKey';
/** Long edge Claude sees images at without downscaling them itself. */
const MAX_EDGE = 1568;

export function savedKey(): string {
  try {
    return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}
export function storeKey(key: string, remember: boolean) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY, key);
  } catch {
    /* private mode: the key lives only as long as the form */
  }
}
export const keyRemembered = () => {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
};

/** The request body; pure so it can be checked without a network. */
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

/** The picture as Claude should get it: at most 1568 px on the long edge, JPEG. */
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

export type ReadResult =
  | { ok: true; plan: ReadPlan }
  | { ok: false; why: 'none' | 'refused' | 'cut' | 'badKey' | 'overloaded' | 'offline' | 'failed'; detail?: string };

/** What a finished response means for us. Pure: tested with canned responses. */
export function readResponse(
  msg: { stop_reason?: string | null; content: { type: string; text?: string }[] },
  w: number,
  h: number,
): ReadResult {
  if (msg.stop_reason === 'refusal') return { ok: false, why: 'refused' };
  if (msg.stop_reason === 'max_tokens') return { ok: false, why: 'cut' };
  const text = msg.content.find(b => b.type === 'text')?.text;
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

export async function readPlan(src: string, key: string, hint: string): Promise<ReadResult> {
  const img = await prepare(src);
  // loaded only when someone uses it: keeps the SDK out of the first page load
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // the key belongs to the person using the page, typed by them, kept in their browser
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const msg = await client.beta.messages.create(planRequest(img.b64, 'image/jpeg', img.w, img.h, hint));
    return readResponse(msg, img.w, img.h);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, why: 'badKey' };
    if (status === 429 || status === 529 || status === 503) return { ok: false, why: 'overloaded' };
    if (status === undefined) return { ok: false, why: 'offline', detail: String((e as Error).message || e) };
    return { ok: false, why: 'failed', detail: String((e as Error).message || status) };
  }
}

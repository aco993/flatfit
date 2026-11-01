#!/usr/bin/env node
// Re-checks the price of every product in the Serbian catalogue on the store's own page.
// Usage: node scripts/rs-prices.mjs [--dry]
// The Serbian catalogue was put together by hand from many stores, so this script does not look for new
// products: it updates price, regular price and promotion end for the ones already chosen, and records the
// date each price was last confirmed. Stores that answer with a bot challenge (Cloudflare) are skipped,
// never worked around; their products keep the date of the last manual check and the app says so.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'src/data/catalogs/rs.json');
const DRY = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const today = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Gone extends Error {}
class Blocked extends Error {}

async function get(url, json = false) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      if (r.status === 404 || r.status === 410) throw new Gone(url);
      const body = await r.text();
      if (r.status === 403 && /Just a moment|cf-chl|challenge-platform/i.test(body)) throw new Blocked(url);
      if (r.ok) return json ? JSON.parse(body) : body;
      last = new Error(`${r.status} ${url}`);
    } catch (e) { if (e instanceof Gone || e instanceof Blocked) throw e; last = e; }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

const num = v => (v === undefined || v === null || v === '' ? undefined : Math.round(parseFloat(String(v).replace(/[^\d.]/g, ''))));
/** First schema.org Offer on a page: price and, if given, the date it is valid until. */
function ldOffer(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      if ((o['@type'] === 'Offer' || o['@type'] === 'AggregateOffer') && (o.price ?? o.lowPrice) !== undefined) return { price: num(o.price ?? o.lowPrice), validUntil: o.priceValidUntil };
      stack.push(...Object.values(o));
    }
  }
  return null;
}

/** One reader per store: returns { price, regular?, until? } from the live page. */
const READERS = {
  // IKEA Serbia runs on ikea.com: the public search endpoint returns the current and previous price for an item number
  async ik(p) {
    const itemNo = (p.url.match(/-(s?\d{8})\/?$/) || [])[1];
    if (!itemNo) return null; // a search link (combinations like KNOXHULT): checked by hand
    const s = await get(`https://sik.search.blue.cdtapps.com/rs/sr/search-result-page?q=${itemNo.replace(/^s/, '')}&types=PRODUCT&size=5`, true);
    const hit = (s.searchResultPage?.products?.main?.items || []).map(i => i.product).find(x => x?.itemNo === itemNo.replace(/^s/, '') || x?.id === itemNo);
    if (!hit) throw new Gone(p.url);
    const prev = hit.salesPrice?.previous?.wholeNumber ? num(hit.salesPrice.previous.wholeNumber) : undefined;
    return { price: Math.round(hit.salesPrice.numeral), regular: prev };
  },
  // JYSK: the offer has the sale price and its end date, the tracking data the regular price
  async jysk(p) {
    const html = await get(p.url), o = ldOffer(html);
    if (!o?.price) throw new Error('no price on ' + p.url);
    const regular = num((html.match(/"priceAmount":"(\d+)"/) || [])[1]);
    return { price: o.price, regular, until: o.validUntil && regular > o.price ? o.validUntil.slice(0, 10) : undefined };
  },
  // Forma Ideale (Medusa shop): calculated price is what you pay, original price the regular one
  async fi(p) {
    const html = await get(p.url);
    const calc = num((html.match(/\\?"calculated_amount\\?":(\d+)/) || [])[1]), orig = num((html.match(/\\?"original_amount\\?":(\d+)/) || [])[1]);
    const price = calc || ldOffer(html)?.price;
    if (!price) throw new Error('no price on ' + p.url);
    return { price, regular: orig };
  },
  async giga(p) {
    const o = ldOffer(await get(p.url));
    if (!o?.price) throw new Error('no price on ' + p.url);
    return { price: o.price };
  },
  async emz(p) {
    const html = await get(p.url);
    const price = num((html.match(/Price","amount":"(\d+)/) || [])[1]) || ldOffer(html)?.price;
    if (!price) throw new Error('no price on ' + p.url);
    return { price };
  },
};

const cat = JSON.parse(await readFile(FILE, 'utf8'));
// products that cannot be re-checked keep the date they were last confirmed
for (const p of cat.products) p.checked ||= cat.checked;
const stats = { ok: 0, changed: 0, gone: 0, blocked: 0, failed: 0, skipped: 0 };
const blockedStores = new Set();
for (const p of cat.products) {
  const read = READERS[p.store];
  if (!read || blockedStores.has(p.store)) { stats.skipped++; continue; }
  try {
    const r = await read(p);
    if (!r) { stats.skipped++; continue; }
    const before = JSON.stringify([p.price, p.regular, p.until]);
    p.price = r.price;
    if (r.regular && r.regular > r.price) { p.regular = r.regular; if (r.until) p.until = r.until; else if (p.until && p.until < today) delete p.until; }
    else { delete p.regular; delete p.until; }
    delete p.unavailable; p.checked = today; stats.ok++;
    if (JSON.stringify([p.price, p.regular, p.until]) !== before) { stats.changed++; console.log(`~ ${p.id}: ${before} → ${JSON.stringify([p.price, p.regular, p.until])}`); }
  } catch (e) {
    if (e instanceof Gone) { p.unavailable = true; stats.gone++; console.log(`✗ ${p.id}: no longer sold (${p.url})`); }
    else if (e instanceof Blocked) { blockedStores.add(p.store); stats.blocked++; console.log(`! ${p.store}: bot challenge, skipping this store`); }
    else { stats.failed++; console.log(`? ${p.id}: ${e.message}`); }
  }
  await sleep(900);
}
cat.checked = today;
console.log(JSON.stringify(stats));
if (!DRY) await writeFile(FILE, JSON.stringify(cat, null, 1) + '\n');

#!/usr/bin/env node
// Re-checks the price of every product in a catalogue on the store's own page.
// Usage: node scripts/prices.mjs rs|ba|hr|de|at [--dry]
// It does not look for new products (scripts/ikea-catalog.mjs and scripts/ba-catalog.mjs do): it updates price,
// regular price and promotion end for the products already in the catalogue, so product ids and saved
// choices stay valid, and records the date each price was last confirmed. Stores that answer with a bot
// challenge (Cloudflare) are skipped, never worked around; their products keep the date of the last manual
// check and the app says so.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COUNTRY = process.argv.slice(2).find(a => !a.startsWith('-')) || 'rs';
const FILE = path.join(ROOT, 'src/data/catalogs', COUNTRY + '.json');
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
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'sr-RS,sr;q=0.9,bs;q=0.8,hr;q=0.8,de;q=0.7,en;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 404 || r.status === 410) throw new Gone(url);
      const body = await r.text();
      if (r.status === 403 && /Just a moment|cf-chl|challenge-platform/i.test(body)) throw new Blocked(url);
      if (r.ok) return json ? JSON.parse(body) : body;
      last = new Error(`${r.status} ${url}`);
    } catch (e) {
      if (e instanceof Gone || e instanceof Blocked) throw e;
      last = e;
    }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

// whole dinars stay whole; marks and euros keep their cents
const num = v =>
  v === undefined || v === null || v === '' ? undefined : Math.round(parseFloat(String(v).replace(/[^\d.]/g, '')) * 100) / 100;
/**
 * The page's schema.org Offer: price and, if given, the date it is valid until. Product groups (one page per
 * colour, JYSK) list an offer per variant; the one whose url is this page wins, otherwise the first in the page.
 */
function ldOffer(html, url) {
  const offers = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const queue = [data];
    while (queue.length) {
      const o = queue.shift();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) {
        queue.push(...o);
        continue;
      }
      if ((o['@type'] === 'Offer' || o['@type'] === 'AggregateOffer') && (o.price ?? o.lowPrice) !== undefined) offers.push(o);
      else queue.push(...Object.values(o));
    }
  }
  const o = offers.find(x => url && x.url === url) || offers[0];
  return o ? { price: num(o.price ?? o.lowPrice), validUntil: o.priceValidUntil } : null;
}

/** One reader per store: returns { price, regular?, until? } from the live page. */
const READERS = {
  // IKEA: the public search endpoint returns the current and previous price for an item number, and when a sale ends
  async ik(p) {
    const m = /ikea\.com\/([a-z]{2}\/[a-z]{2})\/p\/[^/]*-(s?\d{8})\/?$/.exec(p.url);
    if (!m) return null; // a search link (combinations like KNOXHULT): checked by hand
    const [, loc, itemNo] = m;
    const s = await get(
      `https://sik.search.blue.cdtapps.com/${loc}/search-result-page?q=${itemNo.replace(/^s/, '')}&types=PRODUCT&size=5`,
      true,
    );
    const hit = (s.searchResultPage?.products?.main?.items || [])
      .map(i => i.product)
      .find(x => x?.itemNo === itemNo.replace(/^s/, '') || x?.id === itemNo);
    if (!hit) throw new Gone(p.url);
    const sp = hit.salesPrice,
      dec = x => (x?.wholeNumber ? parseFloat(x.wholeNumber.replace(/\D/g, '') + '.' + (x.decimals || '0').replace(/\D/g, '')) : undefined);
    // prices of the Bosnian estimates come from IKEA Croatia in euro (the mark is pegged at 1.95583)
    const k = sp.currencyCode === cat.currency ? 1 : sp.currencyCode === 'EUR' && cat.currency === 'BAM' ? 1.95583 : NaN;
    const conv = v => (v === undefined ? undefined : k === 1 ? v : Math.round(v * k));
    const until = sp.validTo && (Date.parse(sp.validTo) - Date.now()) / 864e5 <= 120 ? sp.validTo.slice(0, 10) : undefined;
    return { price: conv(sp.numeral), regular: conv(dec(sp.previous)), until };
  },
  // JYSK: the offer has the sale price and its end date, the tracking data the regular price
  async jysk(p) {
    const html = await get(p.url),
      o = ldOffer(html, p.url);
    if (!o?.price) throw new Error('no price on ' + p.url);
    const regular = num((html.match(/"priceAmount":"([\d.]+)"/) || [])[1]);
    // priceValidUntil a year away is the shop's default, not the end of a sale
    const until =
      o.validUntil && regular > o.price && (Date.parse(o.validUntil) - Date.now()) / 864e5 <= 120 ? o.validUntil.slice(0, 10) : undefined;
    return { price: o.price, regular, until };
  },
  // Forma Ideale (Medusa shop): calculated price is what you pay, original price the regular one
  async fi(p) {
    const html = await get(p.url);
    const calc = num((html.match(/\\?"calculated_amount\\?":(\d+)/) || [])[1]),
      orig = num((html.match(/\\?"original_amount\\?":(\d+)/) || [])[1]);
    const price = calc || ldOffer(html)?.price;
    if (!price) throw new Error('no price on ' + p.url);
    return { price, regular: orig };
  },
  async giga(p) {
    const o = ldOffer(await get(p.url));
    if (!o?.price) throw new Error('no price on ' + p.url);
    return { price: o.price };
  },
  // Technoshop (BiH): price block of the product page, "1.099,- KM" and the struck-through old price
  async ts(p) {
    const html = await get(p.url),
      i = html.indexOf('product__short-price');
    if (i < 0) throw new Error('no price on ' + p.url);
    const block = html.slice(i, i + 900),
      km = s => +String(s).replace(/[^\d]/g, '');
    const now = (block.match(/cp__np">\s*([\d.]+),-/) || [])[1],
      old = (block.match(/cp__op-price">\s*([\d.]+),-/) || [])[1];
    if (!now) throw new Error('no price on ' + p.url);
    return { price: km(now), regular: old ? km(old) : undefined };
  },
  async emz(p) {
    const html = await get(p.url);
    const price = num((html.match(/Price","amount":"(\d+)/) || [])[1]) || ldOffer(html)?.price;
    if (!price) throw new Error('no price on ' + p.url);
    return { price };
  },
};

const cat = JSON.parse(await readFile(FILE, 'utf8'));
READERS.ikea = READERS.ik; // DE/AT/HR catalogues call the store 'ikea'
READERS.est = p => (/ikea\.com/.test(p.url) ? READERS.ik(p) : null); // estimates priced from IKEA
// products that cannot be re-checked keep the date they were last confirmed
for (const p of cat.products) p.checked ||= cat.checked;
const stats = { ok: 0, changed: 0, gone: 0, blocked: 0, failed: 0, skipped: 0 };
const blockedStores = new Set();
for (const p of cat.products) {
  const read = READERS[p.store];
  if (!read || blockedStores.has(p.store)) {
    stats.skipped++;
    continue;
  }
  try {
    const r = await read(p);
    if (!r) {
      stats.skipped++;
      continue;
    }
    const before = JSON.stringify([p.price, p.regular, p.until]);
    p.price = r.price;
    if (r.regular && r.regular > r.price) {
      p.regular = r.regular;
      if (r.until) p.until = r.until;
      else if (p.until && p.until < today) delete p.until;
    } else {
      delete p.regular;
      delete p.until;
    }
    delete p.unavailable;
    p.checked = today;
    stats.ok++;
    if (JSON.stringify([p.price, p.regular, p.until]) !== before) {
      stats.changed++;
      console.log(`~ ${p.id}: ${before} → ${JSON.stringify([p.price, p.regular, p.until])}`);
    }
  } catch (e) {
    if (e instanceof Gone) {
      p.unavailable = true;
      stats.gone++;
      console.log(`✗ ${p.id}: no longer sold (${p.url})`);
    } else if (e instanceof Blocked) {
      blockedStores.add(p.store);
      stats.blocked++;
      console.log(`! ${p.store}: bot challenge, skipping this store`);
    } else {
      stats.failed++;
      console.log(`? ${p.id}: ${e.message}`);
    }
  }
  await sleep(900);
}
cat.checked = today;
console.log(JSON.stringify(stats));
if (!DRY) await writeFile(FILE, JSON.stringify(cat, null, 1) + '\n');

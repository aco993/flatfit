#!/usr/bin/env node
// Builds src/data/catalogs/<country>.json from IKEA's public search endpoint and product pages.
// Usage: node scripts/ikea-catalog.mjs de   (or: at)
// Prices, sizes and colours come from the live pages; run it again whenever prices change.
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const country = process.argv[2] || 'de';
const LOCALES = { de: 'de/de', at: 'at/de' };
const loc = LOCALES[country];
if (!loc) { console.error('unknown country', country); process.exit(1); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Per slot: search phrase, which IKEA product types count, how many to keep, optional size filter (cm).
const Q = {
  kitchen: { q: 'KNOXHULT Küche', type: /^Küche$/i, keep: 4, wMax: 260 },
  sink: { q: 'Einbauspüle 1 Becken', type: /Einbauspüle|Spüle/i, keep: 3 },
  faucet: { q: 'Küchenmischbatterie', type: /Mischbatterie/i, keep: 3 },
  hob: { q: 'Kochfeld', type: /Kochfeld/i, not: /tragbar/i, keep: 3 },
  oven: { q: 'Backofen', type: /Backofen|Heißluftofen/i, keep: 3 },
  hood: { q: 'Dunstabzugshaube', type: /Dunstabzug|Abzugshaube/i, keep: 3 },
  fridge: { q: 'Kühl-/Gefrierschrank freistehend', type: /Kühl|Gefrier/i, keep: 3 },
  table: { q: 'Esstisch 4 Personen', type: /^Tisch|Esstisch|Ausziehtisch/i, keep: 5, wMax: 160 },
  chairs: { q: 'Stuhl', type: /^Stuhl$/i, keep: 5 },
  sofa: { q: '3er-Sofa', type: /Sofa|Bettsofa/i, not: /Bezug/i, keep: 6, wMax: 240 },
  armchair: { q: 'Sessel', type: /^Sessel$/i, keep: 4 },
  coffee: { q: 'Couchtisch', type: /Couchtisch/i, keep: 5 },
  tvunit: { q: 'TV-Bank', type: /TV-Bank|TV-Möbel/i, keep: 5, wMax: 200 },
  rug: { q: 'Teppich Kurzflor 160x230', type: /Teppich/i, keep: 4 },
  floorlamp: { q: 'Standleuchte', type: /Standleuchte/i, keep: 3 },
  bed: { q: 'Bettgestell 160x200', type: /Bettgestell|Bett/i, keep: 6, needs160: true },
  base: { q: 'LURÖY', type: /^(Federholzrahmen|Lattenrost)$/i, keep: 2 },
  mattress: { q: 'Matratze 160x200', type: /Matratze/i, keep: 5, needs160: true },
  wardrobe: { q: 'Kleiderschrank', type: /Kleiderschrank/i, keep: 6, wMax: 200 },
  night: { q: 'Nachttisch', type: /Nachttisch|Ablagetisch/i, keep: 5 },
  lamps: { q: 'Tischleuchte', type: /Tischleuchte/i, keep: 3 },
  washer: { q: 'Waschmaschine', type: /Waschmaschine/i, keep: 2 },
  hall: { q: 'Schuhschrank', type: /Schuhschrank|Schuhbank/i, keep: 4 },
  hooks: { q: 'Hakenleiste', type: /Haken|Garderobe/i, keep: 3 },
  terrace: { q: 'Tisch und 2 Stühle für draußen', type: /Tisch.*Stühle|Stühle.*Tisch/i, nameMust: /außen|draußen|outdoor/i, keep: 3 },
  curtains: { q: 'Gardinen 1 Paar', type: /Gardinen|Vorhänge/i, keep: 4 },
  rods: { q: 'Gardinenstangenset', type: /Gardinenstange/i, keep: 3 },
  pendant: { q: 'Hängeleuchte', type: /Hängeleuchte$/i, not: /schirm/i, keep: 4 },
};

async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
      if (r.ok) return json ? r.json() : r.text();
    } catch {}
    await sleep(1500 * (i + 1));
  }
  throw new Error('fetch failed ' + url);
}

// "Breite 180 cm" etc. from the product page's measurement tab (not the package sizes)
function measures(html) {
  const out = {};
  const re = /measurement-name">([^<]+)<\/span><span class="pipf-measurements-tab__measurement-value">([^<]+)</g;
  let m;
  while ((m = re.exec(html))) {
    const k = m[1].trim(), v = parseFloat(m[2].replace(',', '.'));
    if (Number.isNaN(v) || out[k] !== undefined) continue;
    out[k] = /mm/.test(m[2]) ? v / 10 : v;
  }
  return out;
}
const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined; };
const fromRef = (t) => { const m = /(\d+(?:[.,]\d+)?)(?:\/\d+)?x(\d+(?:[.,]\d+)?)(?:x(\d+(?:[.,]\d+)?))?/.exec(t || ''); return m ? m.slice(1).map(x => x && parseFloat(x.replace(',', '.'))) : []; };

async function slotProducts(slot, cfg) {
  const url = `https://sik.search.blue.cdtapps.com/${loc}/search-result-page?q=${encodeURIComponent(cfg.q)}&size=40&types=PRODUCT`;
  const d = await get(url, true);
  const items = (d.searchResultPage?.products?.main?.items || []).map(i => i.product).filter(Boolean);
  const out = [];
  for (const p of items) {
    if (out.length >= cfg.keep) break;
    const full = `${p.name} ${p.typeName} ${p.validDesignText || ''}`;
    if (cfg.not && cfg.not.test(full) || cfg.nameMust && !cfg.nameMust.test(full)) continue;
    if (out.some(o => o.name.startsWith(`${p.name} ${p.typeName}`) && Math.abs(o.price - p.salesPrice?.numeral) < 5)) continue;
    if (!cfg.type.test(p.typeName || '') || !p.salesPrice?.numeral || !p.onlineSellable && slot !== 'kitchen') continue;
    const ref = p.itemMeasureReferenceText || '';
    if (cfg.needs160 && !/160/.test(ref + ' ' + p.validDesignText + ' ' + p.pipUrl)) continue;
    await sleep(400);
    let html = '';
    try { html = await get(p.pipUrl, false); } catch { continue; }
    const ms = measures(html), r = fromRef(ref);
    let w = pick(ms, 'Breite', 'Länge', 'Durchmesser', 'Bildschirmdiagonale') ?? r[0];
    let d2 = pick(ms, 'Tiefe', 'Länge') ?? r[1];
    let h = pick(ms, 'Höhe', 'Max. Höhe', 'Gesamthöhe') ?? r[2];
    if (slot === 'bed' || slot === 'mattress' || slot === 'base') { w = pick(ms, 'Breite') ?? 160; d2 = pick(ms, 'Länge') ?? 200 + (slot === 'bed' ? 8 : 0); }
    if (slot === 'rug') { w = pick(ms, 'Länge') ?? r[1]; d2 = pick(ms, 'Breite') ?? r[0]; h = 1; }
    if (slot === 'curtains') { w = pick(ms, 'Breite') ?? r[0]; h = pick(ms, 'Länge') ?? r[1]; d2 = 2; }
    if (slot === 'table' || slot === 'coffee') {
      const dia = pick(ms, 'Durchmesser');
      if (dia) { w = d2 = dia; }
      else { const a = [pick(ms, 'Länge') ?? r[0], pick(ms, 'Breite') ?? r[1]].filter(Boolean); if (a.length === 2) { w = Math.max(...a); d2 = Math.min(...a); } }
    }
    if (slot === 'rods') { const m2 = /(\d+)-(\d+) cm/.exec(ref + ' ' + p.validDesignText); w = m2 ? +m2[2] : undefined; d2 = h = undefined; }
    if (slot === 'kitchen' && !w) continue;
    if (cfg.wMax && w && w > cfg.wMax) continue;
    const color = (p.colors || []).map(c => c.name).join(' / ') || (p.validDesignText || '').trim();
    const name = `${p.name} ${p.typeName}${p.validDesignText ? ', ' + p.validDesignText : ''}${ref ? ', ' + ref : ''}`.replace(/\s+/g, ' ').trim();
    const prod = {
      id: `${country}-ik-${p.itemNoGlobal || p.id}`, slot, store: 'ikea', name, url: p.pipUrl,
      price: p.salesPrice.numeral, color, hex: p.colors?.[0]?.hex ? '#' + p.colors[0].hex : undefined,
    };
    const prev = p.salesPrice.previous?.wholeNumber ? parseFloat(p.salesPrice.previous.wholeNumber + '.' + (p.salesPrice.previous.decimals || '0')) : undefined;
    if (prev && prev > prod.price) prod.regular = prev;
    if (w) prod.w = Math.round(w * 10) / 10; if (d2) prod.d = Math.round(d2 * 10) / 10; if (h) prod.h = Math.round(h * 10) / 10;
    const txt = (name + ' ' + html.slice(0, 200000)).toLowerCase();
    if (slot === 'bed') prod.needsBase = !/federholzrahm|lattenrost.{0,40}(inbegriffen|enthalten)|mit lattenrost|lur[öo]y|lönset|leirsund|lindbåden/i.test(name + ' ' + p.typeName) || /lattenrost.{0,30}nicht/i.test(txt.slice(0, 5000));
    if (slot === 'kitchen') prod.needsWorktop = !/arbeitsplatte|knoxhult/i.test(name);
    if (slot === 'curtains') prod.pack = 2;
    if (slot === 'chairs') prod.qty = 1;
    if (slot === 'table' && /stühle|stuhl/i.test(p.typeName)) prod.includesChairs = color;
    if ((slot === 'table' || slot === 'coffee') && (/rund/i.test(p.typeName + name) || pick(ms, 'Durchmesser'))) prod.round = true;
    out.push(prod);
    process.stdout.write('.');
  }
  return out;
}

const prevPath = path.join(ROOT, 'src/data/catalogs', country + '.json');
let extra = [];
try { const prev = JSON.parse(await readFile(prevPath, 'utf8')); extra = prev.products.filter(p => p.store !== 'ikea'); } catch {}
// optional: node scripts/ikea-catalog.mjs de base,bed  -> refresh only these slots
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
let kept = [];
try { kept = only ? JSON.parse(await readFile(prevPath, 'utf8')).products.filter(p => p.store === 'ikea' && !only.has(p.slot)) : []; } catch {}
const products = [...kept];
for (const [slot, cfg] of Object.entries(Q)) {
  if (only && !only.has(slot)) continue;
  process.stdout.write(`\n${slot} `);
  try { products.push(...await slotProducts(slot, cfg)); } catch (e) { console.warn(' skipped', e.message); }
}
const today = new Date().toISOString().slice(0, 10);
const cat = {
  country, currency: 'EUR', checked: today,
  stores: [{ id: 'ikea', name: 'IKEA', web: `https://www.ikea.com/${loc}/` }, ...(extra.length ? [{ id: 'est', name: 'estimate', web: '' }] : [])],
  products: [...products, ...extra],
};
await writeFile(prevPath, JSON.stringify(cat, null, 1) + '\n');
console.log(`\nwrote ${products.length} IKEA products (+${extra.length} kept) to ${path.relative(ROOT, prevPath)}`);

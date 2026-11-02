#!/usr/bin/env node
// Builds src/data/catalogs/<country>.json from IKEA's public search endpoint and product pages.
// Usage: node scripts/ikea-catalog.mjs de   (or: at, hr)
// Prices, sizes and colours come from the live pages; run it again whenever prices change.
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const country = process.argv[2] || 'de';
const MARKETS = { de: { loc: 'de/de', lang: 'de' }, at: { loc: 'at/de', lang: 'de' }, hr: { loc: 'hr/hr', lang: 'hr' } };
if (!MARKETS[country]) { console.error('unknown country', country); process.exit(1); }
const { loc, lang } = MARKETS[country];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Per slot: search phrase, which IKEA product types count, how many to keep, optional size filter (cm).
const QUERIES = {
  de: {
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
  },
  hr: {
    kitchen: { q: 'KNOXHULT blok kuhinja', type: /^Blok kuhinja$/i, keep: 4, wMax: 260 },
    sink: { q: 'ugradbeni sudoper 1 bazen', type: /^Ugrad.{0,6} sudoper/i, keep: 3 },
    faucet: { q: 'kuhinjska miješalica', type: /^Kuhinj.{0,8} miješ|^Miješalica za vodu s jednom ručkom$/i, not: /tuš/i, keep: 3 },
    hob: { q: 'indukcijsko kuhalište', type: /^(Indukcijsko|Plinsko) kuhalište$/i, keep: 3 },
    oven: { q: 'pećnica', type: /^(Pećnica s ventilatorom|Pr pećn s ventil|Ugradbena pećnica|Pećnica s vrućim zrakom)$/i, keep: 3 },
    hood: { q: 'zidna napa', type: /^(Zidna|Ugradbena) napa$/i, keep: 3 },
    fridge: { q: 'hladnjak sa zamrzivačem', type: /^Hladnjak sa zamrzivačem$/i, keep: 3 },
    table: { q: 'stol za blagovanje', type: /^(Stol|Produljivi stol|Stol\+4 stolice)$/i, keep: 5, wMax: 160 },
    chairs: { q: 'stolica', type: /^Stolica$/i, keep: 5 },
    sofa: { q: 'trosjed', type: /^Trosjed( na razvlačenje)?$/i, keep: 6, wMax: 240 },
    armchair: { q: 'naslonjač', type: /^(Naslonjač|Fotelja)$/i, keep: 4 },
    coffee: { q: 'stolić', type: /^Stolić$/i, keep: 5 },
    tvunit: { q: 'TV klupa', type: /^TV ?klupa/i, keep: 5, wMax: 200 },
    rug: { q: 'tepih niski flor 160x230', type: /^Tepih/i, keep: 4 },
    floorlamp: { q: 'podna lampa', type: /^Podna lampa/i, keep: 3 },
    bed: { q: 'okvir kreveta 160x200', type: /^(Ojastučeni )?okvir kreveta$/i, keep: 6, needs160: true },
    base: { q: 'LURÖY', type: /^Letvičasta podnica$/i, keep: 2 },
    mattress: { q: 'madrac 160x200', type: /^(Madrac|Opružni madrac|Hibridni madrac)/i, not: /zaštit|okvir|nadmadrac/i, keep: 5, needs160: true },
    wardrobe: { q: 'ormar za odjeću', type: /^Ormar/i, keep: 6, wMax: 200 },
    night: { q: 'noćni ormarić', type: /^Noćni ormarić$/i, keep: 5 },
    lamps: { q: 'stolna lampa', type: /Stolna lampa/i, keep: 3 },
    washer: { q: 'perilica rublja', type: /^Perilica rublja$/i, keep: 2 },
    hall: { q: 'element za obuću', type: /^Element za obuću/i, keep: 4 },
    hooks: { q: 'vješalica', type: /^(Vješalica|Vješalica za kaput|Stalak za šešir\/kaput)$/i, keep: 3 },
    terrace: { q: 'stol i 2 stolice vanjski', type: /^Stol i 2 (sklopive )?stol(ice|ca), vanjski$/i, keep: 3 },
    curtains: { q: 'zavjese 1 par', type: /zavjese.{0,30}1 ?par/i, keep: 4 },
    rods: { q: 'kombinacija karniša', type: /^Kombinacija karniša$/i, keep: 3 },
    pendant: { q: 'visilica', type: /^Visilica$/i, keep: 4 },
  },
};
// names of the measurements on the product page, and words that change how a product is used
const WORDS = {
  de: {
    accept: 'de-DE,de;q=0.9', width: ['Breite', 'Länge', 'Durchmesser', 'Bildschirmdiagonale'], depth: ['Tiefe', 'Länge'], height: ['Höhe', 'Max. Höhe', 'Gesamthöhe'],
    len: 'Länge', wid: 'Breite', dia: 'Durchmesser',
    baseIncluded: /federholzrahm|lattenrost.{0,40}(inbegriffen|enthalten)|mit lattenrost|lur[öo]y|lönset|leirsund|lindbåden/i, baseMissing: /lattenrost.{0,30}nicht/i,
    worktopIncluded: /arbeitsplatte|knoxhult/i, withChairs: /stühle|stuhl/i, round: /rund/i,
  },
  hr: {
    accept: 'hr-HR,hr;q=0.9', width: ['Širina', 'Duljina', 'Promjer', 'Dijagonala zaslona'], depth: ['Dubina', 'Duljina'], height: ['Visina', 'Maks. visina', 'Ukupna visina'],
    len: 'Duljina', wid: 'Širina', dia: 'Promjer',
    baseIncluded: /letvičast.{0,40}(uključen|u kompletu)|s letvičastom|lur[öo]y|lönset|leirsund|lindbåden/i, baseMissing: /letvičast.{0,30}(nije uključen|se kupuje zasebno)/i,
    worktopIncluded: /radn.{0,4} ploč|knoxhult/i, withChairs: /stolic|stolca/i, round: /okrugl/i,
  },
};
const Q = QUERIES[lang], L = WORDS[lang];

async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': L.accept } });
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
    let w = pick(ms, ...L.width) ?? r[0];
    let d2 = pick(ms, ...L.depth) ?? r[1];
    let h = pick(ms, ...L.height) ?? r[2];
    if (slot === 'bed' || slot === 'mattress' || slot === 'base') { w = pick(ms, L.wid) ?? 160; d2 = pick(ms, L.len) ?? 200 + (slot === 'bed' ? 8 : 0); }
    if (slot === 'rug') { w = pick(ms, L.len) ?? r[1]; d2 = pick(ms, L.wid) ?? r[0]; h = 1; }
    if (slot === 'curtains') { w = pick(ms, L.wid) ?? r[0]; h = pick(ms, L.len) ?? r[1]; d2 = 2; }
    if (slot === 'table' || slot === 'coffee') {
      const dia = pick(ms, L.dia);
      if (dia) { w = d2 = dia; }
      else { const a = [pick(ms, L.len) ?? r[0], pick(ms, L.wid) ?? r[1]].filter(Boolean); if (a.length === 2) { w = Math.max(...a); d2 = Math.min(...a); } }
    }
    if (slot === 'rods') { const m2 = /(\d+)-(\d+) cm/.exec(ref + ' ' + p.validDesignText); w = m2 ? +m2[2] : undefined; d2 = h = undefined; }
    if (['kitchen', 'table', 'coffee', 'sofa', 'bed', 'wardrobe', 'tvunit', 'night', 'hall'].includes(slot) && !w) continue; // the planner needs a size
    if (cfg.wMax && w && w > cfg.wMax) continue;
    const color = (p.colors || []).map(c => c.name).join(' / ') || (p.validDesignText || '').trim();
    const name = `${p.name} ${p.typeName}${p.validDesignText ? ', ' + p.validDesignText : ''}${ref ? ', ' + ref : ''}`.replace(/\s+/g, ' ').trim();
    const prod = {
      id: `${country}-ik-${p.itemNoGlobal || p.id}`, slot, store: 'ikea', name, url: p.pipUrl,
      price: p.salesPrice.numeral, color, hex: p.colors?.[0]?.hex ? '#' + p.colors[0].hex : undefined,
    };
    const prev = p.salesPrice.previous?.wholeNumber ? parseFloat(p.salesPrice.previous.wholeNumber + '.' + (p.salesPrice.previous.decimals || '0')) : undefined;
    if (prev && prev > prod.price) {
      prod.regular = prev;
      // validTo a year away is IKEA's default for a new lower price; only a near date is the end of a sale
      const to = p.salesPrice.validTo;
      if (to && (Date.parse(to) - Date.now()) / 864e5 <= 120) prod.until = to.slice(0, 10);
    }
    if (w) prod.w = Math.round(w * 10) / 10; if (d2) prod.d = Math.round(d2 * 10) / 10; if (h) prod.h = Math.round(h * 10) / 10;
    const txt = (name + ' ' + html.slice(0, 200000)).toLowerCase();
    if (slot === 'bed') prod.needsBase = !L.baseIncluded.test(name + ' ' + p.typeName) || L.baseMissing.test(txt.slice(0, 5000));
    if (slot === 'kitchen') prod.needsWorktop = !L.worktopIncluded.test(name);
    if (slot === 'curtains') prod.pack = 2;
    if (slot === 'chairs') prod.qty = 1;
    if (slot === 'table' && L.withChairs.test(p.typeName)) prod.includesChairs = color;
    if ((slot === 'table' || slot === 'coffee') && (L.round.test(p.typeName + name) || pick(ms, L.dia))) prod.round = true;
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

#!/usr/bin/env node
// Builds src/data/catalogs/ba.json (Bosnia and Herzegovina, prices in KM).
// Usage: node scripts/ba-catalog.mjs
// IKEA does not sell online in Bosnia and Herzegovina, so the catalogue comes from local stores:
// - JYSK BiH for furniture, textiles and lamps: each category page lists its products as schema.org
//   ItemList and each product page carries a schema.org Offer (price and how long a sale lasts);
// - Technoshop for appliances, TVs and sinks: a fixed list of products, prices read from the page;
// - kitchen units, worktop and faucet: there is no online seller with sizes, so they are estimates from
//   IKEA Croatia converted to KM and labelled as such in the app.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'src/data/catalogs/ba.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const EUR_KM = 1.95583; // fixed by law (currency board)
const today = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'bs-BA,bs;q=0.9,hr;q=0.8' },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await r.text();
      if (r.status === 403 && /Just a moment|cf-chl|challenge-platform/i.test(body)) throw new Error('bot challenge on ' + url); // never worked around
      if (r.ok) return body;
      last = new Error(`${r.status} ${url}`);
    } catch (e) {
      last = e;
      if (/bot challenge/.test(e.message)) throw e;
    }
    await sleep(1500 * (i + 1));
  }
  throw last;
}
const ld = html =>
  [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const num = s => parseFloat(String(s).replace(',', '.'));

// colour words in product names → a swatch for the 3D view
const HEX = [
  [/prlj\.? ?bijel|teddy/i, '#ece6da'],
  [/svijetlo ?siv|svjetlo ?siv/i, '#c6c6c3'],
  [/tamno ?siv|antracit|asfalt/i, '#4d4e50'],
  [/siv/i, '#9a9a97'],
  [/bijel/i, '#f2f1ec'],
  [/crn/i, '#1f1f20'],
  [/krem/i, '#ede4d0'],
  [/bež|pijes|pesak|pijesak/i, '#d3c3a6'],
  [/travertin/i, '#d8ccb6'],
  [/tamn.{0,12}hrast/i, '#6d4f36'],
  [/hrast|natur|drvo|bambus|jasen/i, '#bf9767'],
  [/smeđ|konjak|kafe/i, '#6b4a33'],
  [/zelen|maslin/i, '#5f7356'],
  [/plav/i, '#3f5a7a'],
  [/patlidžan|bordo/i, '#5a3046'],
  [/hrom|čelik|inox|srebr/i, '#b9bcbe'],
  [/žut|senf/i, '#d6a93a'],
];
const hexOf = t => (HEX.find(([re]) => re.test(t)) || [0, '#cfcac2'])[1];

// ---------- JYSK BiH ----------
const JYSK = {
  sofa: { cat: ['dnevna-soba/sofe'], must: /^Trosjed|^Kauč na razvlačenje/i, not: /\+/, keep: 6, wMax: 240 },
  armchair: { cat: ['dnevna-soba/fotelje'], must: /^Fotelja /i, not: /električn|tabure/i, keep: 4 },
  coffee: { cat: ['dnevna-soba/stolici-za-kafu-i-pomocni-stolici'], must: /^Stolić /i, keep: 5, wMin: 55 },
  tvunit: { cat: ['dnevna-soba/komode-za-tv'], must: /^TV-stalak/i, keep: 5, wMax: 200 },
  rug: { cat: ['tepisi'], must: /(1[2-9]\d|2\d\d)x(1[6-9]\d|2\d\d)/, keep: 4 },
  floorlamp: { cat: ['kucanstvo/osvjetljenje/lampe'], must: /^Podna lampa/i, keep: 3 },
  pendant: { cat: ['kucanstvo/osvjetljenje/lampe', 'kucanstvo/osvjetljenje'], must: /^(Luster|Visilica|Plafonjera)/i, keep: 3 },
  table: { cat: ['trpezarija/trpezarijski-stolovi'], must: /^Trpezarijski stol/i, keep: 5, wMax: 160 },
  chairs: { cat: ['trpezarija/trpezarijske-stolice'], must: /^Trpezarijska stolica/i, keep: 5 },
  bed: {
    cat: ['spavaca-soba/kreveti/podnice-i-okviri-kreveta/okviri-kreveta', 'spavaca-soba/kreveti'],
    must: /^Okvir kreveta.*160x200/i,
    keep: 5,
  },
  base: { cat: ['spavaca-soba/kreveti/podnice-i-okviri-kreveta/podnice'], must: /^Podnica (80|90|160)x200/i, keep: 2 },
  mattress: {
    cat: ['spavaca-soba/madraci', 'spavaca-soba/madraci/madraci-s-oprugama', 'spavaca-soba/madraci/madraci-od-pjene'],
    must: /^Madrac.*160x200/i,
    not: /nadmadrac|zaštit|dječ/i,
    keep: 5,
  },
  wardrobe: { cat: ['odlaganje/ormari'], must: /^Ormar /i, keep: 6, wMin: 75, wMax: 200 },
  night: { cat: ['spavaca-soba/nocni-ormarici'], must: /^Noćni ormarić/i, keep: 5 },
  lamps: { cat: ['kucanstvo/osvjetljenje/lampe'], must: /^Stolna lampa/i, keep: 3 },
  hall: { cat: ['odlaganje/skladistenje-cipela'], must: /^Cipelar/i, keep: 4 },
  hooks: { cat: ['hodnik/za-zid', 'hodnik/namjestaj-za-hodnik'], must: /vješalica|čiviluk|kuke/i, not: /^Vješalice /i, keep: 3 },
  terrace: { cat: ['basta/vrtni-namjestaj'], must: /^Bistro set/i, keep: 3 },
  curtains: { cat: ['zavjese/konfekcijske-zavjese'], must: /1x1[34]\dx(245|300)/, keep: 4 },
  rods: { cat: ['zavjese/karnisne-i-dodaci'], must: /^(Set )?karnišn.*(120-2[01]\d|200-340)/i, not: /dupl/i, keep: 3 },
};

async function listCategory(cat) {
  const out = [];
  for (let page = 0; page < 4; page++) {
    let html;
    try {
      html = await get(`https://jysk.ba/${cat}${page ? `?page=${page}` : ''}`);
    } catch {
      break;
    }
    const col = ld(html).find(d => d['@type'] === 'CollectionPage');
    const items = col?.mainEntity?.itemListElement || [];
    const fresh = items.filter(i => !out.some(o => o.url === i.url));
    if (!fresh.length) break;
    out.push(...fresh.map(i => ({ name: i.name, url: i.url })));
    await sleep(500);
  }
  return out;
}

/** size after assembly from the product's spec table, else from the name ("90x160", "Ø105", "V154cm") */
function jyskSize(html, name) {
  const spec = (html.match(/Veli(?:č|\\u010d)ina nakon monta(?:ž|\\u017e)e(?:&quot;|")?,(?:&quot;|")?([^&"]+)/) || [])[1] || '';
  const get1 = k => {
    const m = new RegExp(k + ':\\s*([\\d.,]+)\\s*(cm|mm)', 'i').exec(spec.replace(/\\u0160/g, 'Š').replace(/\\u017e/g, 'ž'));
    return m ? num(m[1]) / (m[2] === 'mm' ? 10 : 1) : undefined;
  };
  let w = get1('Širina') ?? get1('Dužina'),
    d = get1('Dubina') ?? (get1('Širina') !== undefined ? get1('Dužina') : undefined),
    h = get1('Visina');
  const dia = /Ø\s?(\d+)/.exec(name),
    wx = /(\d+)x(\d+)(?:\/\d+)?(?:x(\d+))?/.exec(name);
  if (!w && dia) {
    w = d = +dia[1];
  }
  if (!w && wx) {
    w = Math.max(+wx[1], +wx[2]);
    d = Math.min(+wx[1], +wx[2]);
  }
  const sd = /Š(\d+)xD(\d+)/.exec(name);
  if (sd && !w) {
    w = +sd[1];
    d = d || +sd[2];
  }
  if (w && !d && dia === null && /stol/i.test(name)) d = w;
  if (!h) {
    const v = /V\s?(\d+)\s?cm/i.exec(name);
    if (v) h = +v[1];
  }
  return { w, d, h, round: !!dia };
}

function jyskOffer(html, url) {
  for (const d of ld(html)) {
    const variants = d['@type'] === 'ProductGroup' ? d.hasVariant || [] : d['@type'] === 'Product' ? [d] : [];
    const v = variants.find(x => x.offers?.url === url) || variants[0];
    if (v?.offers?.price) return { price: num(v.offers.price), until: v.offers.priceValidUntil?.slice(0, 10), color: v.color };
  }
  return null;
}

async function jyskSlot(slot, cfg) {
  const seen = new Map();
  for (const c of cfg.cat) for (const it of await listCategory(c)) if (!seen.has(it.url)) seen.set(it.url, it);
  const out = [];
  for (const it of seen.values()) {
    if (out.length >= cfg.keep) break;
    if (!cfg.must.test(it.name) || cfg.not?.test(it.name)) continue;
    await sleep(500);
    let html;
    try {
      html = await get(it.url);
    } catch {
      continue;
    }
    const o = jyskOffer(html, it.url);
    if (!o) continue;
    let { w, d, h, round } = jyskSize(html, it.name);
    if ((slot === 'base' || slot === 'mattress') && w && d) [w, d] = [Math.min(w, d), Math.max(w, d)]; // width x length, like the bed
    if ((cfg.wMax && w > cfg.wMax) || (cfg.wMin && (!w || w < cfg.wMin))) continue;
    if (['sofa', 'bed', 'wardrobe', 'tvunit', 'table', 'coffee', 'night', 'hall'].includes(slot) && !w) continue;
    const regular = num((html.match(/"priceAmount":"([\d.]+)"/) || [])[1]);
    const colour = ((it.name.match(/[A-ZČĆŠŽĐ]{3,}(?:\s[A-ZČĆŠŽĐ]{2,})*\s(.+)$/) || [])[1] || o.color || '')
      .replace(
        /(^|\s)(Ø|V|Š)\S*|\d+x\d+\S*|\b\d+ ?(vrata|ladic\w*|polic\w*|odjeljk\w*|odeljk\w*)\b|\bcm\b|\bsa prost[^ ]* za odlag\S*|\bs odlaganjem\b/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    const p = {
      id: 'ba-jysk-' + it.url.split('/').pop().slice(0, 60),
      slot,
      store: 'jysk',
      name: it.name.replace(/\s+/g, ' ').trim(),
      url: it.url,
      price: o.price,
      color: colour.replace(/\b\d+x\d+\S*/g, '').trim(),
      hex: hexOf(it.name),
      checked: today,
    };
    // a sale ends on priceValidUntil; a date a year away is the shop's default, not the end of a promotion
    if (regular > o.price) {
      p.regular = regular;
      if (o.until && (new Date(o.until) - Date.now()) / 864e5 < 120) p.until = o.until;
    }
    if (w) p.w = w;
    if (d) p.d = d;
    if (h) p.h = h;
    if (round && (slot === 'table' || slot === 'coffee')) p.round = true;
    if (slot === 'chairs') p.qty = 1;
    if (slot === 'curtains') {
      p.pack = 1;
      p.h = (/x(\d+)\b/.exec(it.name.replace(/^.*1x\d+/, '')) || [])[1] ? +/1x\d+x(\d+)/.exec(it.name)[1] : 245;
      p.w = +/1x(\d+)/.exec(it.name)[1];
      p.d = 2;
    }
    if (slot === 'rods') {
      const m = /(\d+)-(\d+)\s?cm/.exec(it.name);
      if (m) {
        p.w = +m[2];
        delete p.d;
        delete p.h;
      }
    }
    if (slot === 'rug') {
      p.h = 1;
    }
    if (slot === 'bed') p.needsBase = !/podnic[a-z]* (je )?uklju|sa podnicom|s podnicom|letvice uklju/i.test(html.slice(0, 400000));
    out.push(p);
    process.stdout.write('.');
  }
  return out;
}

// ---------- Technoshop (appliances, TV, sink) ----------
const TS = 'https://technoshop.ba/proizvodi/';
const TECHNOSHOP = {
  hob: [
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-ploce/electrolux-ug.-ploca-ehf6140fok-471',
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-ploce/electrolux-ugradbena-ploca-ehf6240xxk-518',
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-ploce/hisense-ugradbena-ploca-hi6433bcwf-57461',
  ],
  oven: [
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-pecnice/electrolux-pecnica-eoh3h00bx-32476',
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-pecnice/electrolux-pecnica-eof3h50bk-32481',
    'bijela-tehnika/kuhanje-i-pecenje/ugradbene-pecnice/lg-pecnica-ws5d7210s-54668',
  ],
  hood: [
    'bijela-tehnika/kuhanje-i-pecenje/kuhinjske-nape/teleskopske-nape/electrolux-napa-lfg235s-50355',
    'bijela-tehnika/kuhanje-i-pecenje/kuhinjske-nape/teleskopske-nape/electrolux-napa-lfp326fb-37071',
    'bijela-tehnika/kuhanje-i-pecenje/kuhinjske-nape/zidne-nape/electrolux-napa-lfc316x-657',
  ],
  fridge: [
    'bijela-tehnika/frizideri-i-zamrzivaci/kombinovani-frizideri/lg-frizider-gbv3100dpy-1-86m-35183',
    'bijela-tehnika/frizideri-i-zamrzivaci/kombinovani-frizideri/lg-frizider-gbbsj10epy-1-86m-51073',
  ],
  washer: [
    'bijela-tehnika/ves-masine-i-susilice/ves-masine/lg-ves-masina-f2j3wsbwe-6-5kg-slim-37491',
    'bijela-tehnika/ves-masine-i-susilice/ves-masine/lg-ves-masina-f2x10s7nwh-7kg-52461',
  ],
  tv: ['tv-i-audio/tv/led/lg-tv-led-43ua73003la-44422', 'tv-i-audio/tv/led/lg-tv-led-50ua73003la-44423'],
  sink: [
    'bijela-tehnika/pranje-posuda/sudoperi/franke-sudoper-ran-610-38-1-1-2-31715',
    'bijela-tehnika/pranje-posuda/sudoperi/franke-sudoper-ron-610-41-31716',
  ],
};
const kmNum = s => +String(s).replace(/[^\d]/g, '');
async function technoshop(slot, rel) {
  const url = TS + rel,
    html = await get(url);
  const block = html.slice(html.indexOf('product__short-price'), html.indexOf('product__short-price') + 900);
  const now = (block.match(/cp__np">\s*([\d.]+),-/) || [])[1],
    old = (block.match(/cp__op-price">\s*([\d.]+),-/) || [])[1];
  if (!now) throw new Error('no price on ' + url);
  const title =
    ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() || rel.split('/').pop();
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const dim = k => {
    const m = new RegExp(k + '\\s*(?:\\(cm\\))?\\s*:?\\s*([\\d.,]+)\\s*(cm|mm)', 'i').exec(text);
    return m ? Math.round((num(m[1]) / (m[2] === 'mm' ? 10 : 1)) * 10) / 10 : undefined;
  };
  const p = {
    id: 'ba-ts-' + rel.split('-').pop(),
    slot,
    store: 'ts',
    name: title.replace(/^Lg\b/, 'LG'),
    url,
    price: kmNum(now),
    color: /crn|black|bk\b|fb\b/i.test(title + rel) ? 'crna' : /inox|x\b|bx\b|nerđ/i.test(title + rel) ? 'inox' : 'bijela',
    checked: today,
  };
  p.hex = p.color === 'crna' ? '#1d1e20' : p.color === 'inox' ? '#b9bcbe' : '#f2f1ec';
  if (old && kmNum(old) > p.price) p.regular = kmNum(old);
  const w = dim('Širina'),
    d = dim('Dubina'),
    h = dim('Visina');
  if (w) p.w = w;
  if (d) p.d = d;
  if (h) p.h = h;
  if (slot === 'tv') {
    const inch = +(/(\d{2})(?:u|lq|lr|ut|ua)/i.exec(rel) || [])[1];
    if (inch) {
      p.w = p.w || Math.round(inch * 2.21);
      p.h = p.h || Math.round(inch * 1.25);
      p.d = 8;
    }
    p.color = 'crna';
    p.hex = '#1d1e20';
  }
  if (slot === 'fridge' && !p.h) p.h = 186;
  if (slot === 'hob') {
    p.color = 'crna';
    p.hex = '#1d1e20';
  } // glass-ceramic tops are black whatever the frame
  if (slot === 'oven' && p.color === 'bijela') {
    p.color = 'inox';
    p.hex = '#b9bcbe';
  }
  return p;
}

// ---------- estimates: kitchen units, worktop, faucet ----------
async function ikeaHr(q, type, n) {
  const d = JSON.parse(
    await get(`https://sik.search.blue.cdtapps.com/hr/hr/search-result-page?q=${encodeURIComponent(q)}&size=24&types=PRODUCT`),
  );
  return (d.searchResultPage?.products?.main?.items || [])
    .map(i => i.product)
    .filter(p => p && type.test(p.typeName || '') && p.salesPrice?.numeral)
    .slice(0, n);
}
async function estimates() {
  const out = [];
  const note = 'IKEA nema online prodaju u BiH: cijena IKEA Hrvatska preračunata u KM, bez dostave';
  for (const p of await ikeaHr('KNOXHULT blok kuhinja', /^Blok kuhinja$/i, 6)) {
    const m = /(\d+)x(\d+)x(\d+)/.exec(p.itemMeasureReferenceText || '');
    if (!m || out.some(o => o.w === +m[1] && Math.abs(o.price - Math.round(p.salesPrice.numeral * EUR_KM)) < 40)) continue;
    out.push({
      id: 'ba-est-' + p.id,
      slot: 'kitchen',
      store: 'est',
      name: `${p.name} ${p.typeName}, ${p.validDesignText || ''} ${p.itemMeasureReferenceText}`.replace(/\s+/g, ' ').trim(),
      url: p.pipUrl,
      price: Math.round(p.salesPrice.numeral * EUR_KM),
      color: p.validDesignText || 'bijela',
      hex: '#f2f1ec',
      w: +m[1],
      d: +m[2],
      h: +m[3],
      estimate: true,
      note,
      checked: today,
    });
    if (out.length >= 3) break;
  }
  for (const p of await ikeaHr('kuhinjska miješalica', /^Kuhinj.{0,8} miješ/i, 2))
    out.push({
      id: 'ba-est-' + p.id,
      slot: 'faucet',
      store: 'est',
      name: `${p.name} ${p.typeName}, ${p.validDesignText || ''}`.trim(),
      url: p.pipUrl,
      price: Math.round(p.salesPrice.numeral * EUR_KM),
      color: /crn/i.test(p.validDesignText) ? 'crna' : 'inox',
      hex: /crn/i.test(p.validDesignText) ? '#1d1e20' : '#b9bcbe',
      estimate: true,
      note,
      checked: today,
    });
  return out;
}

const products = [];
for (const [slot, cfg] of Object.entries(JYSK)) {
  process.stdout.write(`\n${slot} `);
  try {
    products.push(...(await jyskSlot(slot, cfg)));
  } catch (e) {
    console.warn(' skipped', e.message);
  }
}
for (const [slot, list] of Object.entries(TECHNOSHOP)) {
  process.stdout.write(`\n${slot} `);
  for (const rel of list) {
    try {
      products.push(await technoshop(slot, rel));
      process.stdout.write('.');
    } catch (e) {
      console.warn(' ?', e.message);
    }
    await sleep(700);
  }
}
process.stdout.write('\nestimates ');
products.push(...(await estimates()));
const cat = {
  country: 'ba',
  currency: 'BAM',
  checked: today,
  stores: [
    { id: 'jysk', name: 'JYSK', web: 'https://jysk.ba' },
    { id: 'ts', name: 'Technoshop', web: 'https://technoshop.ba' },
    { id: 'est', name: 'IKEA HR (procjena)', web: 'https://www.ikea.com/hr/hr/' },
  ],
  products,
};
await writeFile(FILE, JSON.stringify(cat, null, 1) + '\n');
console.log(`\nwrote ${products.length} products to ${path.relative(ROOT, FILE)}`);

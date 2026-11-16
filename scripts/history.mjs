#!/usr/bin/env node
// Price history and price-drop feeds, read from git: every daily price check is a commit of the catalogue, so the
// repository already holds each product's price day by day. Writes, for every country,
//   public/history/<cc>.json  { generated, currency, products: { <id>: [[date, price], …] } }  (an entry per change)
//   public/feeds/<cc>.xml     RSS 2.0 with the price drops of the last 14 days
// Runs before every build (npm "prebuild"). A shallow clone has no history: then the files hold today's prices only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COUNTRIES = ['rs', 'ba', 'hr', 'de', 'at'];
const DAYS = 120,
  FEED_DAYS = 14;
const SITE = 'https://aco993.github.io/flatfit/';
const today = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function snapshots(file) {
  let log = '';
  try {
    log = git('log', `--since=${since}`, '--format=%H %cs', '--', file);
  } catch {
    // not a git checkout (a downloaded zip): only the file as it is
  }
  const out = log
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => l.split(' '))
    .reverse()
    .map(([hash, date]) => {
      try {
        return { date, cat: JSON.parse(git('show', `${hash}:${file}`)) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  // uncommitted local edits count as today
  out.push({ date: today, cat: JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) });
  return out;
}

const esc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

function money(v, currency) {
  const n = new Intl.NumberFormat('de-DE', { maximumFractionDigits: currency === 'RSD' ? 0 : 2, minimumFractionDigits: 0 }).format(v);
  return `${n} ${currency === 'BAM' ? 'KM' : currency === 'EUR' ? '€' : currency}`;
}

for (const cc of COUNTRIES) {
  const file = `src/data/catalogs/${cc}.json`;
  const snaps = snapshots(file);
  const series = {};
  for (const { date, cat } of snaps) {
    for (const p of cat.products || []) {
      if (!(p.price > 0) || p.unavailable) continue;
      if (!series[p.id]) series[p.id] = [];
      const s = series[p.id];
      const last = s.at(-1);
      // several commits on one day: the day's last price counts
      if (last && last[0] === date) {
        last[1] = p.price;
        if (s.length > 1 && s.at(-2)[1] === p.price) s.pop();
      } else if (!last || last[1] !== p.price) s.push([date, p.price]);
    }
  }
  const cur = snaps.at(-1).cat;
  mkdirSync(path.join(ROOT, 'public/history'), { recursive: true });
  writeFileSync(
    path.join(ROOT, 'public/history', `${cc}.json`),
    JSON.stringify({ generated: today, currency: cur.currency, products: series }),
  );

  // price drops: the last change is lower than the price before it and happened within FEED_DAYS
  const from = new Date(Date.now() - FEED_DAYS * 864e5).toISOString().slice(0, 10);
  const stores = new Map((cur.stores || []).map(s => [s.id, s.name]));
  const drops = cur.products
    .filter(p => !p.unavailable)
    .map(p => ({ p, s: series[p.id] || [] }))
    .filter(({ s }) => s.length > 1 && s.at(-1)[0] >= from && s.at(-1)[1] < s.at(-2)[1])
    .sort((a, b) => (a.s.at(-1)[0] < b.s.at(-1)[0] ? 1 : -1))
    .slice(0, 60);
  const items = drops
    .map(({ p, s }) => {
      const [date, now] = s.at(-1),
        was = s.at(-2)[1];
      const pct = Math.round((1 - now / was) * 100);
      return `<item><title>${esc(`${p.name} · ${stores.get(p.store) || p.store}: ${money(was, cur.currency)} → ${money(now, cur.currency)} (−${pct}%)`)}</title><link>${esc(p.url)}</link><guid isPermaLink="false">${esc(`${cc}-${p.id}-${date}-${now}`)}</guid><pubDate>${new Date(`${date}T06:00:00Z`).toUTCString()}</pubDate></item>`;
    })
    .join('\n');
  mkdirSync(path.join(ROOT, 'public/feeds'), { recursive: true });
  writeFileSync(
    path.join(ROOT, 'public/feeds', `${cc}.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>FlatFit · price drops (${cc.toUpperCase()})</title><link>${SITE}</link><description>Furniture and appliances in the FlatFit catalogue that got cheaper in the last ${FEED_DAYS} days, from the daily price check.</description><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel></rss>
`,
  );
  console.log(`${cc}: ${snaps.length} snapshots, ${Object.keys(series).length} products, ${drops.length} drops`);
}

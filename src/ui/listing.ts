import type { Project, Room } from '../types';
import { t, type Key } from '../i18n';
import { GROUPS, slotDef } from '../domain/slots';
import { bounds, roomArea } from '../domain/geometry';
import { lines, total, type Index, type Selection } from '../domain/selection';
import type { App } from './app';
import { esc, toast } from './dom';
import { fmtNum, today } from './format';
import { FILL, seg } from './measure';

/**
 * A one-page listing sheet for renting out or selling the flat: photos of the furnished rooms, the floor plan
 * with areas, the main facts, a description and title the user can edit, and what the flat is furnished with
 * (prices hidden unless asked for). The browser's print dialog turns it into a PDF.
 */
export interface ListingRoom {
  name: string;
  area: number;
  type: Room['type'];
}
export interface ListingData {
  title: string;
  description: string;
  area: number;
  terrace: number;
  rooms: ListingRoom[];
  groups: { name: string; items: { slot: string; product: string; price: number }[] }[];
  total: number;
}

/** Everything on the sheet except the photos; pure, so it is unit-tested. */
export function listingData(p: Project, sel: Selection, ix: Index, roomName: (id: string) => string): ListingData {
  const rooms = p.rooms.map(r => ({ name: roomName(r.id), area: roomArea(r), type: r.type }));
  const area = rooms.filter(r => r.type !== 'terrace').reduce((s, r) => s + r.area, 0);
  const terrace = rooms.filter(r => r.type === 'terrace').reduce((s, r) => s + r.area, 0);
  const ls = lines(p, sel, ix, today()).filter(l => l.product && l.units);
  const groups = GROUPS.map(g => ({
    name: t(('group.' + g) as Key),
    items: ls
      .filter(l => slotDef(l.slot).group === g)
      .map(l => ({ slot: t(('slot.' + l.slot) as Key), product: l.product!.name, price: l.total })),
  })).filter(g => g.items.length);
  const list = rooms.filter(r => r.type !== 'terrace').map(r => r.name.toLowerCase());
  const description = t(terrace ? 'ad.descTerrace' : 'ad.desc', {
    area: fmtNum(area, 1),
    rooms: list.join(', '),
    terrace: fmtNum(terrace, 1),
  });
  return { title: p.demo ? t('proj.demo') : p.name.replace(/\s*\*$/, ''), description, area, terrace, rooms, groups, total: total(ls) };
}

/** Snapshots of the interior views, living room first; the 3D view is put back where it was. */
async function photos(app: App, max: number) {
  const v = app.viewer;
  if (!v) return [];
  await app.models.load(import.meta.env.BASE_URL);
  const order: Room['type'][] = ['living', 'bedroom', 'dining', 'kitchen', 'bathroom', 'terrace'];
  const room = (i: number) => app.project.rooms.find(r => r.id === app.views[i].room);
  const picks = app.views
    .map((view, i) => ({ view, i }))
    .filter(x => x.view.interior && room(x.i))
    .sort((a, b) => order.indexOf(room(a.i)!.type) - order.indexOf(room(b.i)!.type))
    .slice(0, max);
  const back = app.viewIdx,
    out: { src: string; caption: string }[] = [],
    cv = document.createElement('canvas');
  for (const { view, i } of picks) {
    app.setView(i, true, true);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    v.snapshot(cv);
    out.push({ src: crop(cv, 1.6), caption: app.roomName(view.room!) });
  }
  app.setView(back, true, true);
  return out;
}

/** The centre of a canvas at the given aspect ratio, as JPEG. */
function crop(src: HTMLCanvasElement, aspect: number) {
  const w = Math.min(src.width, src.height * aspect),
    h = w / aspect,
    c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  c.getContext('2d')!.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.86);
}

function planSvg(p: Project, names: (id: string) => string) {
  const b = bounds(p.rooms),
    m = 0.5;
  const vb = [b.x1 - m, b.z1 - m, b.x2 - b.x1 + 2 * m, b.z2 - b.z1 + 2 * m].join(' ');
  const rooms = p.rooms
    .map(r => {
      const ops = p.openings
        .filter(o => o.room === r.id)
        .map(o => {
          const [x1, z1, x2, z2] = seg(r, o.side, o.at, o.width);
          return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="${o.kind === 'window' || o.kind === 'balcony' ? 'win' : 'door'}"/>`;
        })
        .join('');
      return `<rect x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="${FILL[r.type] || '#eee'}" class="room"/>
      <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2}" class="name">${esc(names(r.id))}</text>
      <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2 + 0.3}" class="area">${fmtNum(roomArea(r), 1)} m²</text>${ops}`;
    })
    .join('');
  return `<svg viewBox="${vb}" role="img" aria-label="${esc(t('ad.plan'))}">${rooms}</svg>`;
}

/** "Ormar: FANDRUP 97x176 …", or just the product when its name already says what it is ("Trosjed GEDVED …" for a sofa says enough). */
export function itemText(slot: string, product: string) {
  const first = (w: string) => w.toLocaleLowerCase().split(/\s+/)[0].slice(0, 5);
  return first(product) === first(slot) ? esc(product) : `<span class="slot">${esc(slot)}:</span> ${esc(product)}`;
}

export function listingHtml(
  d: ListingData,
  pics: { src: string; caption: string }[],
  hero: { src: string; caption: string } | null,
  plan: string,
  fmt: (v: number) => string,
  url: string,
) {
  const main = hero || pics[0],
    rest = (hero ? pics : pics.slice(1)).slice(0, 3);
  const fig = (p: { src: string; caption: string }, cls = '') =>
    `<figure class="${cls}"><img src="${p.src}" alt="${esc(p.caption)}"><figcaption>${esc(p.caption)}</figcaption></figure>`;
  const groups = d.groups
    .map(
      g =>
        `<section><h3>${esc(g.name)}</h3><ul>${g.items.map(i => `<li>${itemText(i.slot, i.product)}<span class="price"> · ${fmt(i.price)}</span></li>`).join('')}</ul></section>`,
    )
    .join('');
  const fact = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
  return `<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t('ad.docTitle', { name: d.title }))}</title><style>
  @page { size: A4; margin: 12mm; }
  body { font: 13px/1.45 system-ui, sans-serif; color: #1d1f22; margin: 24px auto; max-width: 900px; padding: 0 16px; background: #fff; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 12px; margin-bottom: 18px; background: #f6f4ef; border-radius: 10px; }
  .bar p { margin: 0; color: #5d6168; flex: 1 1 300px; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #1d1f22; background: #1d1f22; color: #fff; cursor: pointer; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; } .lead { font-size: 15px; margin: 0 0 14px; color: #3c4046; }
  [contenteditable]:hover, [contenteditable]:focus { outline: 2px dashed #c2410c; outline-offset: 3px; }
  figure { margin: 0; } img { width: 100%; display: block; border-radius: 8px; } figcaption { font-size: 11px; color: #5d6168; margin-top: 3px; }
  .hero img { aspect-ratio: 16 / 10; object-fit: cover; }
  .thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 16px; }
  .info { display: grid; grid-template-columns: 1.3fr 1fr; gap: 18px; align-items: start; }
  svg { width: 100%; max-height: 300px; } .room { stroke: #1d1f22; stroke-width: .04; } .door { stroke: #8a5a32; stroke-width: .1; } .win { stroke: #2563eb; stroke-width: .1; }
  text { text-anchor: middle; font-size: .26px; fill: #1d1f22; } .name { font-weight: 700; } .area { fill: #5d6168; font-size: .22px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 12px; } dl div { background: #f6f4ef; border-radius: 8px; padding: 8px 10px; }
  dt { font-size: 11px; color: #5d6168; text-transform: uppercase; letter-spacing: .04em; } dd { margin: 2px 0 0; font-size: 18px; font-weight: 700; }
  h2 { font-size: 15px; margin: 18px 0 6px; } h3 { font-size: 12px; margin: 0 0 4px; color: #5d6168; text-transform: uppercase; letter-spacing: .04em; }
  .equip { columns: 2; column-gap: 24px; } .equip section { break-inside: avoid; margin-bottom: 10px; } ul { margin: 0; padding-left: 16px; } li { margin: 1px 0; }
  .slot { color: #5d6168; } .price, .total { display: none; } body.prices .price { display: inline; } body.prices .total { display: block; }
  .total { font-weight: 700; margin-top: 6px; } .foot { margin-top: 18px; font-size: 10px; color: #8a8e94; }
  @media print { body { margin: 0; max-width: none; padding: 0; } .bar { display: none; } [contenteditable] { outline: none !important; } .info, .thumbs { break-inside: avoid; } }
  @media (max-width: 640px) { .info { grid-template-columns: 1fr; } .thumbs { grid-template-columns: 1fr 1fr; } .equip { columns: 1; } }
</style></head><body>
<div class="bar"><p>${esc(t('ad.hint'))}</p><label><input type="checkbox" id="prices" onchange="document.body.classList.toggle('prices', this.checked)"> ${esc(t('ad.prices'))}</label><button type="button" onclick="print()">${esc(t('ad.print'))}</button></div>
<h1 contenteditable="true" spellcheck="false">${esc(d.title)}</h1>
<p class="lead" contenteditable="true">${esc(d.description)}</p>
${main ? fig(main, 'hero') : ''}
${rest.length ? `<div class="thumbs">${rest.map(p => fig(p)).join('')}</div>` : ''}
<div class="info"><div><h2>${esc(t('ad.plan'))}</h2>${plan}</div>
<div><h2>${esc(t('ad.facts'))}</h2><dl>${fact(t('ad.area'), fmtNum(d.area, 1) + ' m²')}${d.terrace ? fact(t('ad.terrace'), fmtNum(d.terrace, 1) + ' m²') : ''}${fact(t('ad.rooms'), String(d.rooms.filter(r => r.type !== 'terrace').length))}</dl>
<ul>${d.rooms.map(r => `<li>${esc(r.name)} · ${fmtNum(r.area, 1)} m²</li>`).join('')}</ul></div></div>
<h2>${esc(t('ad.equip'))}</h2><div class="equip">${groups}</div><p class="total">${esc(t('ad.total', { v: fmt(d.total) }))}</p>
<p class="foot">${esc(t('ad.footer', { url }))}</p>
</body></html>`;
}

/** Opens the sheet in a new tab. The tab is opened right away (inside the click), then filled once the photos are taken. */
export async function openListing(app: App) {
  if (!app.ix) return;
  const w = window.open('', '_blank');
  if (!w) {
    toast(t('ad.blocked'));
    return;
  }
  w.document.write(
    `<!doctype html><meta charset="utf-8"><title>FlatFit</title><p style="font:15px system-ui;margin:40px">${esc(t('ad.preparing'))}</p>`,
  );
  const sel = app.selected;
  app.select(null, false); // no selection frame in the photos
  const pics = await photos(app, 4);
  if (sel) app.select(sel, false);
  const hero = app.lastRender ? { src: app.lastRender.url, caption: t('ad.photoreal') } : null;
  const d = listingData(app.project, app.sel, app.ix, id => app.roomName(id));
  const html = listingHtml(
    d,
    pics,
    hero,
    planSvg(app.project, id => app.roomName(id)),
    v => app.fmt(v),
    location.origin + location.pathname,
  );
  w.document.open();
  w.document.write(html);
  w.document.close();
}

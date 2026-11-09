import type { Project, Room, Side } from '../types';
import { t, type Key } from '../i18n';
import { esc } from './dom';
import { fmtNum } from './format';
import { bounds } from '../domain/geometry';
import { measureList, type MeasureItem } from '../domain/measure';

export const FILL: Record<string, string> = {
  living: '#efe2d0',
  kitchen: '#e2eadc',
  dining: '#f3eadb',
  bedroom: '#e5e2f0',
  bathroom: '#dde9ee',
  hall: '#ece9e3',
  terrace: '#e2e0db',
};

/** Where an item sits on its wall, as a segment on the plan (metres). */
export function seg(r: Room, side: Side, at: number, w: number) {
  if (side === 'n') return [r.x + at, r.z, r.x + at + w, r.z];
  if (side === 's') return [r.x + at, r.z + r.d, r.x + at + w, r.z + r.d];
  if (side === 'w') return [r.x, r.z + at, r.x, r.z + at + w];
  return [r.x + r.w, r.z + at, r.x + r.w, r.z + at + w];
}

function what(it: MeasureItem) {
  if (it.what === 'width') return t('ms.width');
  if (it.what === 'depth') return t('ms.depth');
  if (it.what === 'ceiling') return t('ms.ceiling');
  const kind = t((it.kind === 'radiator' || it.kind === 'tv' ? 'wi.' + it.kind : 'kind.' + it.kind) as Key);
  const wall = t('ms.wall', { side: t(('side.' + it.side) as Key).toLowerCase() });
  const part =
    it.what === 'at'
      ? t(it.side === 'n' || it.side === 's' ? 'ms.fromLeft' : 'ms.fromTop')
      : it.what === 'size'
        ? t('ms.size')
        : t('ms.sill');
  return `${kind} · ${wall} · ${part}`;
}

/** A printable page: the plan with numbered rooms and openings, and a table to write the real measurements in. */
export function measureSheet(p: Project): string {
  const list = measureList(p),
    b = bounds(p.rooms),
    m = 0.9;
  const vb = [b.x1 - m, b.z1 - m, b.x2 - b.x1 + 2 * m, b.z2 - b.z1 + 2 * m].map(v => fmtNum(v, 2).replace(',', '.'));
  const label = (r: Room) => r.name || t(('room.' + r.type) as Key);
  const svg = p.rooms
    .map(r => {
      const mr = list.rooms.find(x => x.id === r.id)!,
        [wi, di] = mr.items;
      const walls = mr.items
        .map((it, i) => ({ it, size: mr.items[i + 1] }))
        .filter(x => x.it.what === 'at')
        .map(({ it, size }) => {
          const [x1, z1, x2, z2] = seg(r, it.side!, it.value, size.value),
            wall = it.kind === 'radiator' || it.kind === 'tv';
          const lx = (x1 + x2) / 2 + (it.side === 'e' ? 0.28 : it.side === 'w' ? -0.28 : 0),
            lz = (z1 + z2) / 2 + (it.side === 's' ? 0.3 : it.side === 'n' ? -0.2 : 0.07);
          return `<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" class="${wall ? 'wi' : 'op'}"/><text x="${lx}" y="${lz}" class="code">${it.code}</text>`;
        })
        .join('');
      return `<rect x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="${FILL[r.type] || '#eee'}" class="room"/>
      <text x="${r.x + r.w / 2}" y="${r.z + r.d / 2}" class="name">${mr.no}. ${esc(label(r))}</text>
      <text x="${r.x + r.w / 2}" y="${r.z + 0.32}" class="dim">↔ ${wi.code}</text>
      <text x="${r.x + 0.16}" y="${r.z + r.d / 2 + 0.3}" class="dim" text-anchor="start">↕ ${di.code}</text>${walls}`;
    })
    .join('');
  const row = (it: MeasureItem) =>
    `<tr><td class="c">${it.code}</td><td>${esc(what(it))}</td><td class="n">${fmtNum(it.value, 2)} m</td><td class="w"></td></tr>`;
  const tables = list.rooms
    .map(mr => {
      const r = p.rooms.find(x => x.id === mr.id)!;
      return `<tbody><tr class="room-h"><th colspan="4">${mr.no}. ${esc(label(r))}</th></tr>${mr.items.map(row).join('')}</tbody>`;
    })
    .join('');
  // an edited copy of the demo is called 'Demo … *' in the editor; the star means nothing on paper
  const title = t('ms.title', { name: (p.demo ? t('proj.demo') : p.name).replace(/\s*\*$/, '') });
  return `<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
  body { font: 14px/1.4 system-ui, sans-serif; color: #1d1f22; margin: 24px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 4px 0 12px; color: #4a4e55; max-width: 70ch; }
  svg { width: 100%; height: 62vh; min-height: 340px; display: block; margin: 8px 0 16px; }
  .room { stroke: #1d1f22; stroke-width: .04; } .op { stroke: #c2410c; stroke-width: .12; } .wi { stroke: #2563eb; stroke-width: .12; stroke-dasharray: .12 .06; }
  text { font-size: .24px; text-anchor: middle; fill: #1d1f22; } .name { font-weight: 700; } .dim { fill: #5d6168; } .code { font-weight: 700; fill: #9a3412; font-size: .2px; }
  table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: left; vertical-align: top; }
  thead th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #5d6168; } .room-h th { padding-top: 14px; font-size: 15px; border-bottom: 2px solid #1d1f22; }
  .c { font-weight: 700; color: #9a3412; width: 3em; } .n { white-space: nowrap; width: 6em; text-align: right; } .w { width: 8em; border-bottom: 1px solid #1d1f22; }
  .legend span { display: inline-block; margin-right: 16px; } .legend i { display: inline-block; width: 22px; height: 4px; vertical-align: middle; margin-right: 6px; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #1d1f22; background: #fff; cursor: pointer; }
  @media print { button { display: none; } body { margin: 10mm; } svg { height: 120mm; min-height: 0; } tbody { break-inside: avoid; } }
</style></head><body>
<button type="button" onclick="print()">${esc(t('ms.print'))}</button>
<h1>${esc(title)}</h1>
<p>${esc(t('ms.intro'))}</p>
<p class="legend"><span><i style="background:#c2410c"></i>${esc(t('editor.openings'))}</span><span><i style="background:#2563eb"></i>${esc(t('editor.wallItems'))}</span></p>
<svg viewBox="${vb.join(' ')}" role="img" aria-label="${esc(title)}">${svg}</svg>
<table><thead><tr><th>#</th><th>${esc(t('ms.what'))}</th><th class="n">${esc(t('ms.plan'))}</th><th>${esc(t('ms.real'))}</th></tr></thead>
<tbody><tr class="room-h"><th colspan="4">${esc(t('ms.flat'))}</th></tr>${row(list.ceiling)}</tbody>${tables}</table>
<p>${esc(t('ms.tip'))}</p>
</body></html>`;
}

/** Opens the sheet in a new tab, ready to print. */
export function openMeasureSheet(p: Project) {
  const url = URL.createObjectURL(new Blob([measureSheet(p)], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

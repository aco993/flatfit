import type { OpeningKind, Project, Side, WallItemKind } from '../types';

/**
 * What to measure in a real flat so the plan (and every fit check) matches it: each room's width and depth,
 * where each door, window, radiator and TV socket sits on its wall and how wide it is, window sills and the
 * ceiling. Codes (1a, 1b, …) tie the printed table to the sketch.
 */
export type MeasureWhat = 'width' | 'depth' | 'ceiling' | 'at' | 'size' | 'sill';
export interface MeasureItem {
  code: string;
  what: MeasureWhat;
  value: number;
  kind?: OpeningKind | WallItemKind;
  side?: Side;
}
export interface MeasureRoom {
  id: string;
  no: number;
  items: MeasureItem[];
}

const letter = (i: number) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

export function measureList(p: Project): { ceiling: MeasureItem; rooms: MeasureRoom[] } {
  const order: Side[] = ['n', 'e', 's', 'w'];
  const rooms = p.rooms.map((r, ri) => {
    const items: Omit<MeasureItem, 'code'>[] = [
      { what: 'width', value: r.w },
      { what: 'depth', value: r.d },
    ];
    const onWalls = [
      ...p.openings
        .filter(o => o.room === r.id)
        .map(o => ({
          kind: o.kind as OpeningKind | WallItemKind,
          side: o.side,
          at: o.at,
          width: o.width,
          sill: o.kind === 'window' ? o.sill : undefined,
        })),
      ...(p.wallItems || [])
        .filter(w => w.room === r.id)
        .map(w => ({
          kind: w.kind as OpeningKind | WallItemKind,
          side: w.side,
          at: w.at,
          width: w.width,
          sill: undefined as number | undefined,
        })),
    ].sort((a, b) => order.indexOf(a.side) - order.indexOf(b.side) || a.at - b.at);
    for (const o of onWalls) {
      items.push({ what: 'at', value: o.at, kind: o.kind, side: o.side }, { what: 'size', value: o.width, kind: o.kind, side: o.side });
      if (o.kind === 'window') items.push({ what: 'sill', value: o.sill ?? 0.9, kind: o.kind, side: o.side });
    }
    return { id: r.id, no: ri + 1, items: items.map((it, i) => ({ ...it, code: `${ri + 1}${letter(i)}` })) };
  });
  return { ceiling: { code: '0', what: 'ceiling', value: p.wallHeight }, rooms };
}

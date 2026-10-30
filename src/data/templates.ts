import type { Project } from '../types';
import { DEMO } from './demo';

const id = () => Math.random().toString(36).slice(2, 9);

export type TemplateId = 'empty' | 'studio' | 'tworoom' | 'demo';

/** Starting points for a new apartment in the floor-plan editor. */
export function fromTemplate(t: TemplateId, name: string, country: string): Project {
  const base = { id: 'p-' + id(), name, country, wallHeight: 2.6, open: [] as [string, string][], updatedAt: Date.now() };
  if (t === 'demo') return { ...structuredClone(DEMO), ...base, open: structuredClone(DEMO.open), demo: false };
  if (t === 'studio') return {
    ...base,
    rooms: [
      { id: 'living', type: 'living', x: 0, z: 0, w: 5, d: 3.6 },
      { id: 'kitchen', type: 'kitchen', x: 0, z: 3.6, w: 2.8, d: 2 },
      { id: 'bath', type: 'bathroom', x: 2.8, z: 3.6, w: 2.2, d: 2 },
    ],
    open: [['living', 'kitchen']],
    openings: [
      { id: 'w1', kind: 'window', room: 'living', side: 'n', at: 1.0, width: 2.2 },
      { id: 'w2', kind: 'window', room: 'living', side: 'e', at: 1.0, width: 1.2 },
      { id: 'e1', kind: 'entry', room: 'kitchen', side: 'w', at: 0.9, width: 0.9 },
      { id: 'd1', kind: 'door', room: 'bath', side: 'w', at: 1.1, width: 0.7 },
    ],
  };
  if (t === 'tworoom') return {
    ...base,
    rooms: [
      { id: 'living', type: 'living', x: 0, z: 0, w: 4.8, d: 4.2 },
      { id: 'kitchen', type: 'kitchen', x: 4.8, z: 0, w: 2.6, d: 3.0 },
      { id: 'dining', type: 'dining', x: 4.8, z: 3.0, w: 2.6, d: 2.6 },
      { id: 'bedroom', type: 'bedroom', x: 0, z: 4.2, w: 3.6, d: 3.4 },
      { id: 'hall', type: 'hall', x: 3.6, z: 4.2, w: 1.2, d: 3.4 },
      { id: 'bath', type: 'bathroom', x: 4.8, z: 5.6, w: 2.6, d: 2.0 },
      { id: 'terrace', type: 'terrace', x: 0, z: -1.6, w: 3.2, d: 1.6 },
    ],
    open: [['kitchen', 'dining'], ['living', 'dining']],
    openings: [
      { id: 'w1', kind: 'window', room: 'living', side: 'n', at: 3.4, width: 1.2 },
      { id: 'b1', kind: 'balcony', room: 'living', side: 'n', at: 1.2, width: 0.9 },
      { id: 'w2', kind: 'window', room: 'kitchen', side: 'n', at: 0.8, width: 1.2 },
      { id: 'w3', kind: 'window', room: 'bedroom', side: 'w', at: 1.0, width: 1.4 },
      { id: 'd1', kind: 'door', room: 'bedroom', side: 'e', at: 0.3, width: 0.8 },
      { id: 'd2', kind: 'door', room: 'living', side: 's', at: 3.8, width: 0.8 },
      { id: 'd3', kind: 'door', room: 'bath', side: 'w', at: 0.6, width: 0.7 },
      { id: 'e1', kind: 'entry', room: 'hall', side: 's', at: 0.15, width: 0.9 },
    ],
  };
  return { ...base, rooms: [{ id: 'r1', type: 'living', x: 0, z: 0, w: 4, d: 3.5 }], openings: [] };
}

import type { Project, RoomType, SlotId } from '../types';

export type Group = 'kitchen' | 'dining' | 'living' | 'bedroom' | 'bathroom' | 'hall' | 'terrace' | 'textiles';

export interface SlotDef {
  id: SlotId;
  group: Group;
  /** room types that make this slot appear (any of them) */
  rooms: RoomType[];
  optional?: boolean;
  /** chosen automatically from another product (worktop, slatted base, chairs) */
  dependent?: boolean;
}

export const SLOTS: SlotDef[] = [
  { id: 'kitchen', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'worktop', group: 'kitchen', rooms: ['kitchen'], dependent: true },
  { id: 'sink', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'faucet', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'hob', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'oven', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'hood', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'fridge', group: 'kitchen', rooms: ['kitchen'] },
  { id: 'table', group: 'dining', rooms: ['dining', 'kitchen'] },
  { id: 'chairs', group: 'dining', rooms: ['dining', 'kitchen'], dependent: true },
  { id: 'sofa', group: 'living', rooms: ['living'] },
  { id: 'armchair', group: 'living', rooms: ['living'], optional: true },
  { id: 'coffee', group: 'living', rooms: ['living'] },
  { id: 'tvunit', group: 'living', rooms: ['living'] },
  { id: 'tv', group: 'living', rooms: ['living'], optional: true },
  { id: 'rug', group: 'living', rooms: ['living'] },
  { id: 'floorlamp', group: 'living', rooms: ['living'], optional: true },
  { id: 'bed', group: 'bedroom', rooms: ['bedroom'] },
  { id: 'base', group: 'bedroom', rooms: ['bedroom'], dependent: true },
  { id: 'mattress', group: 'bedroom', rooms: ['bedroom'] },
  { id: 'wardrobe', group: 'bedroom', rooms: ['bedroom'] },
  { id: 'night', group: 'bedroom', rooms: ['bedroom'] },
  { id: 'lamps', group: 'bedroom', rooms: ['bedroom'], optional: true },
  { id: 'washer', group: 'bathroom', rooms: ['bathroom'] },
  { id: 'hall', group: 'hall', rooms: ['hall', 'dining', 'living', 'kitchen'] },
  { id: 'hooks', group: 'hall', rooms: ['hall', 'dining', 'living', 'kitchen'], optional: true },
  { id: 'terrace', group: 'terrace', rooms: ['terrace'] },
  { id: 'curtains', group: 'textiles', rooms: ['living', 'bedroom', 'dining'] },
  { id: 'rods', group: 'textiles', rooms: ['living', 'bedroom', 'dining'], dependent: true },
  { id: 'pendant', group: 'textiles', rooms: ['living', 'bedroom', 'dining', 'kitchen'] },
];

export const GROUPS: Group[] = ['kitchen', 'dining', 'living', 'bedroom', 'bathroom', 'hall', 'terrace', 'textiles'];

export const slotDef = (id: SlotId) => SLOTS.find(s => s.id === id)!;

/** Slots that make sense for this apartment (no bed without a bedroom, no terrace set without a terrace). */
export function activeSlots(p: Project): SlotDef[] {
  const types = new Set(p.rooms.map(r => r.type));
  return SLOTS.filter(s => {
    if (s.id === 'table' || s.id === 'chairs') return types.has('dining') || p.rooms.some(r => r.type === 'kitchen' && r.w * r.d >= 7);
    return s.rooms.some(t => types.has(t));
  });
}

export const roomsOfType = (p: Project, t: RoomType) => p.rooms.filter(r => r.type === t);

/** Windows that get curtains (not kitchen or bathroom). */
export function curtainWindows(p: Project) {
  return p.openings.filter(o => {
    if (o.kind !== 'window') return false;
    const r = p.rooms.find(x => x.id === o.room);
    return !!r && ['living', 'bedroom', 'dining'].includes(r.type);
  });
}

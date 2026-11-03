export type Lang = 'en' | 'de' | 'sr' | 'bs' | 'hr';

export type RoomType = 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'hall' | 'terrace';

/** Axis-aligned room rectangle on the floor plan, in metres. x grows to the right, z grows "down" the plan. */
export interface Room {
  id: string;
  type: RoomType;
  name?: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

/** n = edge at z (top of plan), s = z + d, w = edge at x, e = x + w */
export type Side = 'n' | 's' | 'e' | 'w';

export type OpeningKind = 'door' | 'entry' | 'window' | 'balcony';

export interface Opening {
  id: string;
  kind: OpeningKind;
  room: string;
  side: Side;
  /** distance from the start of the edge (min x for n/s, min z for e/w), metres */
  at: number;
  width: number;
  sill?: number;
  head?: number;
}

/** Things on a wall that matter for furnishing: radiators (nothing tall in front) and the TV/antenna socket. */
export type WallItemKind = 'radiator' | 'tv';
export interface WallItem { id: string; kind: WallItemKind; room: string; side: Side; at: number; width: number }

export interface Backdrop { src: string; x: number; z: number; w: number; ar: number; opacity: number }

export interface Project {
  id: string;
  name: string;
  country: string;
  wallHeight: number;
  rooms: Room[];
  /** pairs of room ids with no wall between them (open plan) */
  open: [string, string][];
  openings: Opening[];
  wallItems?: WallItem[];
  /** a scanned or photographed plan shown under the rooms while drawing; w is its width in metres, ar = height / width */
  backdrop?: Backdrop;
  demo?: boolean;
  /** chosen product ids per country: { rs: { preset: 'scandi', sel: { sofa: 'fi-vegas', … } } } */
  choices?: Record<string, { preset: string; sel: Partial<Record<SlotId, string>>; budget?: number }>;
  /** furniture moved by hand: where the anchor of each movable piece ends up */
  moves?: Moves;
  updatedAt?: number;
}

export interface WallOpening { a: number; b: number; lo: number; hi: number; glass: boolean; kind: OpeningKind; /** side of the room that owns it: doors swing into that room */ side?: Side }

export interface Wall {
  axis: 'x' | 'z';
  /** constant coordinate (z for axis x, x for axis z) */
  c: number;
  a1: number;
  a2: number;
  kind: 'full' | 'parapet';
  exterior: boolean;
  openings: WallOpening[];
}

export type SlotId =
  | 'kitchen' | 'worktop' | 'sink' | 'faucet' | 'hob' | 'oven' | 'hood' | 'fridge'
  | 'table' | 'chairs' | 'sofa' | 'armchair' | 'coffee' | 'tvunit' | 'tv' | 'rug' | 'floorlamp'
  | 'bed' | 'base' | 'mattress' | 'wardrobe' | 'night' | 'lamps'
  | 'washer' | 'hall' | 'hooks' | 'terrace' | 'curtains' | 'rods' | 'pendant';

export interface Product {
  id: string;
  slot: SlotId;
  store: string;
  name: string;
  url: string;
  /** current price in the country's currency (per pack, see qty) */
  price: number;
  regular?: number;
  until?: string;
  w?: number; d?: number; h?: number;
  color: string;
  hex?: string;
  /** second colour of two-tone products (legs, fronts) */
  hex2?: string;
  /** pieces in one purchase (curtains sold in pairs, nightstands in a set of two) */
  pack?: number;
  qty?: number;
  note?: string;
  needsWorktop?: boolean;
  needsBase?: boolean;
  /** colour name of the chairs that come with a table set */
  includesChairs?: string;
  round?: boolean;
  corner?: boolean;
  includesFaucet?: boolean;
  chimney?: boolean;
  estimate?: boolean;
  storeOnly?: boolean;
  /** date the price was last confirmed on the store page */
  checked?: string;
  /** the store no longer sells it (kept so old share links still resolve to something sensible) */
  unavailable?: boolean;
}

export interface Store { id: string; name: string; web: string; note?: string }

export interface Catalog {
  country: string;
  currency: string;
  checked: string;
  stores: Store[];
  products: Product[];
}

/** Where one piece of furniture goes. x/z is the centre of its footprint, rot turns it so its front faces into the room. */
export interface Placement {
  slot: SlotId;
  room: string;
  x: number;
  z: number;
  rot: number;
  /** free length along the wall it stands against (m) */
  maxW: number;
  /** free depth into the room (m) */
  maxD: number;
  /** free walkway in front of it (m), when something stands opposite */
  gap?: number;
  /** points used for multi-item placements (chairs, curtains, nightstands) */
  extra?: { x: number; z: number; rot: number; w?: number }[];
  /** placed by hand, not by the planner */
  moved?: boolean;
}

export type Moves = Partial<Record<SlotId, { x: number; z: number; rot: number }>>;

export interface View { id: string; label: string; pos: [number, number, number]; target: [number, number, number]; interior: boolean; room?: string }

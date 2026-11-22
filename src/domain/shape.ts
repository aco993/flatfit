import type { Product } from '../types';

/**
 * What the 3D view can tell about a piece from its product name alone: how many doors and drawers a wardrobe
 * has, whether they slide, whether a bed is upholstered or has storage. Stores write this into the name
 * ("3V2F" is three doors and two drawers at Forma Ideale, "2 vrata 3 ladice" at JYSK, "3-türig" at IKEA);
 * what the name does not say falls back to a plain front sized by the width.
 */
export interface WardrobeShape {
  doors: number;
  drawers: number;
  mirror: boolean;
  sliding: boolean;
  /** door columns side by side; with more doors than columns the extra doors are short ones on top */
  cols: number;
  rows: number;
}

export interface BedShape {
  upholstered: boolean;
  /** drawers or a lift-up box under the mattress: the frame goes down to the floor */
  storage: boolean;
}

// PAX/HASVIK is IKEA's pair of sliding doors; the name does not say "sliding" in any language
const SLIDING = /klizn|schiebe|sliding|hasvik/i;
const MIRROR = /ogledal|spiegel|mirror/i;

export function wardrobeShape(p: Pick<Product, 'name'>, w: number): WardrobeShape {
  const n = p.name;
  const code = n.match(/\b(\d+)[VK](?:(\d+)F)?(?:(\d+)O)?\b/);
  const words = n.match(/(\d+)\s*-?\s*(?:türig|türen|vrat|doors?\b)/i);
  const drawerWords = n.match(/(\d+)\s*(?:ladic|fiok|schubl|drawers?\b)/i);
  const sliding = SLIDING.test(n);
  const byWidth = sliding ? (w > 1.8 ? 3 : 2) : Math.max(2, Math.round(w / 0.48));
  const doors = clamp(code ? +code[1] : words ? +words[1] : byWidth, 1, 8);
  const drawers = clamp(code?.[2] ? +code[2] : drawerWords ? +drawerWords[1] : 0, 0, 6);
  const mirror = !!code?.[3] || MIRROR.test(n);
  // doors narrower than 35 cm are not side by side: the wardrobe has a row of short doors above the tall ones
  const cols = sliding || w / doors >= 0.35 ? doors : Math.max(1, Math.round(w / 0.5));
  return { doors, drawers, mirror, sliding, cols, rows: Math.ceil(doors / cols) };
}

const UPHOLSTERED = /tapec|tapac|gepolster|ojastu|tkanin|vissle|stoff|upholst/i;
const STORAGE = /odlag|kästn|bettkast|storage|podizn/i;

export function bedShape(p: Pick<Product, 'name'>): BedShape {
  return { upholstered: UPHOLSTERED.test(p.name), storage: STORAGE.test(p.name) };
}

/**
 * Where the drawers of a wardrobe go: a full row under every column when they divide evenly
 * (three doors, three drawers), otherwise stacked under the last column.
 */
export function drawerLayout(s: WardrobeShape): { rows: number; inLastCol: number } {
  if (!s.drawers || s.sliding) return { rows: 0, inLastCol: 0 };
  if (s.drawers % s.cols === 0) return { rows: s.drawers / s.cols, inLastCol: 0 };
  return { rows: 0, inLastCol: s.drawers };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

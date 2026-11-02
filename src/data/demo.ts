import type { Project } from '../types';
import type { Selection } from '../domain/selection';

/** Demo: a real two-room attic flat (44.6 m²), measured from the developer's own floor plan. */
export const DEMO: Project = {
  id: 'demo',
  name: 'Demo · 2-room flat · 44.6 m²',
  country: 'rs',
  wallHeight: 2.6,
  demo: true,
  rooms: [
    { id: 'living', type: 'living', x: 0, z: 0, w: 4, d: 3.9 },
    { id: 'dining', type: 'dining', x: 0, z: 3.9, w: 4, d: 2.3 },
    { id: 'kitchen', type: 'kitchen', x: 0, z: 6.2, w: 2.6, d: 0.6 },
    { id: 'bedroom', type: 'bedroom', x: 4, z: 0, w: 3, d: 3.2 },
    { id: 'bath', type: 'bathroom', x: 4, z: 3.2, w: 2.6, d: 1.55 },
    { id: 'terrace', type: 'terrace', x: 3, z: -1.53, w: 3, d: 1.53 },
  ],
  open: [['living', 'dining'], ['dining', 'kitchen']],
  openings: [
    { id: 'w1', kind: 'window', room: 'living', side: 'n', at: 0.5, width: 2.4, sill: 0.85, head: 2.3 },
    { id: 'b1', kind: 'balcony', room: 'living', side: 'n', at: 3.15, width: 0.7 },
    { id: 'w2', kind: 'window', room: 'bedroom', side: 'n', at: 0.7, width: 0.8, sill: 0.9, head: 2.2 },
    { id: 'd1', kind: 'door', room: 'bedroom', side: 'w', at: 2.35, width: 0.75 },
    { id: 'd2', kind: 'door', room: 'bath', side: 'w', at: 0.1, width: 0.7 },
    // the entrance is in the corner between the kitchen niche and the bathroom wall (photo: door left of the niche)
    { id: 'e1', kind: 'entry', room: 'dining', side: 's', at: 3.05, width: 0.85 },
  ],
};

/** Hand-picked combinations for the Serbian catalogue (product ids from rs.json). */
export const RS_PRESETS: Record<string, Selection> = {
  scandi: { kitchen: 'fi-savona', worktop: 'fi-wt-hrast', sink: 'fi-nera', faucet: 'fi-eco', hob: 'fi-hic', oven: 'fi-midea-oven', hood: 'fi-vox-hood', fridge: 'fi-beko-fr', table: 'fi-cz', chairs: 'fi-htc118', sofa: 'fi-vegas', armchair: 'fi-teddy', coffee: 'fi-line', tvunit: 'fi-remo', tv: 'fi-sam43', rug: 'jysk-lingon-n', bed: 'fi-varadero', base: 'fi-pod', mattress: 'fi-cloud', wardrobe: 'fi-mokkaris', night: 'fi-pepe', lamps: 'jysk-eivin', washer: 'fi-beko-wash', hall: 'fi-tirion', hooks: 'fi-love', terrace: 'jysk-aborg-p', curtains: 'jysk-stad-b', rods: 'jysk-madrid', pendant: 'jysk-hjalte' },
  japandi: { armchair: '', kitchen: 'fi-belfort-kuh', sink: 'fi-atos', faucet: 'fi-mamba', hob: 'fi-hii', hood: 'fi-beko-hood', table: 'fi-yale', chairs: 'fi-helena', sofa: 'fi-quatro', coffee: 'fi-belfort-k', tvunit: 'fi-essex', rug: 'jysk-lingon-p', floorlamp: 'jysk-kent', bed: 'fi-belfort-b', mattress: 'fi-fortuna', wardrobe: 'fi-charlotta', night: 'fi-salona-n', hall: 'fi-neo', terrace: 'jysk-aborg-z' },
  urban: { armchair: '', hooks: '', kitchen: 'fi-rajna', worktop: 'fi-wt-siva', sink: 'fi-atos', faucet: 'fi-mamba', hob: 'fi-wq2160', hood: 'fi-vox-black', fridge: 'fi-beko-fr-s', table: 'fi-coburg', chairs: 'fi-asama', sofa: 'fi-luella', coffee: 'fi-seaford', tvunit: 'fi-laval', tv: 'fi-his55', rug: 'jysk-storrapp', floorlamp: 'jysk-hugo', bed: 'fi-astor', mattress: 'fi-green', wardrobe: 'fi-varadero-o', night: 'fi-marron', lamps: 'jysk-markus', hall: 'fi-neo', curtains: 'jysk-amungen', rods: 'jysk-ball' },
  sand: { kitchen: 'fi-diana', worktop: 'fi-wt-pesak', faucet: 'fi-lux', hood: 'fi-midea-hood', table: 'fi-domus', chairs: 'fi-kjc29', sofa: 'fi-enco', armchair: 'fi-zora', coffee: 'fi-clent', rug: 'jysk-balsatre', floorlamp: 'jysk-kent', bed: 'fi-salona', mattress: 'fi-green', wardrobe: 'fi-mont', night: 'fi-varadero-n', hall: 'fi-magic', hooks: 'fi-zoom', curtains: 'jysk-stad-s' },
  blue: { armchair: '', kitchen: 'fi-diva', table: 'fi-adrian', sofa: 'moe-cloud', coffee: 'fi-clent', tvunit: 'fi-valencia', bed: 'fi-aberdeen', terrace: 'jysk-aborg-z' },
};
/** later presets only change a few pieces of the first one */
export const RS_PRESET_BASE: Record<string, string> = { japandi: 'scandi', urban: 'scandi', sand: 'scandi', blue: 'scandi' };

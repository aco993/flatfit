/** Wood floor tones: the darkest plank colour; each plank adds up to 30 to it. */
export const WOOD = {
  light: [196, 170, 132],
  natural: [138, 108, 76],
  grey: [150, 144, 136],
  dark: [92, 64, 44],
} as const satisfies Record<string, readonly [number, number, number]>;
export type WoodTone = keyof typeof WOOD;

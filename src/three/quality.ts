/**
 * Render quality levels and the pieces of the photoreal render the dialog needs before anything is traced. Kept
 * apart from the path tracer so the page can show the dialog without loading three.js and the tracer.
 */
export type Quality = 'fast' | 'balanced' | 'high';
export const QUALITY: Record<Quality, { maxW: number; samples: number }> = {
  fast: { maxW: 640, samples: 16 },
  balanced: { maxW: 960, samples: 40 },
  high: { maxW: 1440, samples: 128 },
};

/** Weak or unknown GPUs start at "fast"; the user can always pick another level. */
export function suggestQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'fast';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) || /SwiftShader|llvmpipe|Mali|Adreno|PowerVR/i.test(name)) return 'fast';
    if (/Intel|UHD|Iris|Apple GPU/i.test(name)) return 'fast';
    if (/RTX|Radeon RX|Apple M[2-9]|Arc/i.test(name)) return 'high';
    return 'balanced';
  } catch {
    return 'fast';
  }
}

export type Progress =
  | { phase: 'scene' }
  | { phase: 'compile'; seconds: number }
  | { phase: 'samples'; samples: number; target: number; eta: number | null; tiles: number }
  | { phase: 'recover'; attempt: number };

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export const outputSize = (cssW: number, cssH: number, q: Quality) => {
  const k = Math.min(1, QUALITY[q].maxW / Math.max(1, cssW));
  return { w: Math.max(64, Math.round(cssW * k)), h: Math.max(48, Math.round(cssH * k)) };
};

/**
 * Whether this browser draws WebGL on the CPU (SwiftShader, llvmpipe: virtual machines, remote desktops, blocked
 * drivers, headless test browsers). Asked of a throwaway canvas, so it needs no three.js.
 */
export function softwareGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|Software/i.test(name);
  } catch {
    return false;
  }
}

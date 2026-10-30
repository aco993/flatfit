import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SlotId, View } from '../types';

export interface Label { text: string; x: number; z: number }

/**
 * Raster 3D view. Two camera modes: an orbiting overview of the whole flat (low walls),
 * and a "stand in the room and look around" mode for each room (full-height walls).
 */
export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  controls: OrbitControls;
  root: THREE.Object3D | null = null;
  interior = false;
  onPick: (slot: SlotId | null) => void = () => {};
  private look = { yaw: 0, pitch: 0 };
  private dirty = true;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; ft: THREE.Vector3; tt: THREE.Vector3; t0: number; dur: number } | null = null;
  private sel: THREE.Box3Helper | null = null;
  private labelEls: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  private ro: ResizeObserver;
  private raf = 0;
  soft = false;
  static software(r: THREE.WebGLRenderer) {
    try { const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return /SwiftShader|llvmpipe|Software/i.test(String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '')); } catch { return false; }
  }
  private bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(8, 3, 8));

  constructor(private host: HTMLElement, private labelHost: HTMLElement) {
    const lowEnd = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    // software rendering (no GPU, e.g. some VMs and CI): keep it light so the page stays usable
    if (Viewer.software(this.renderer)) { this.renderer.setPixelRatio(1); this.renderer.shadowMap.enabled = false; this.soft = true; }
    host.appendChild(this.renderer.domElement);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#dfe6ec');
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc6ba, 0.55); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.6);
    sun.position.set(-3, 10, -7); sun.castShadow = true; sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.target.position.set(3.5, 0, 3); this.scene.add(sun, sun.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 2; this.controls.maxDistance = 22;
    this.controls.addEventListener('change', () => { this.clampTarget(); this.dirty = true; });

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  setRoot(root: THREE.Object3D, bounds?: THREE.Box3) {
    if (this.root) { this.scene.remove(this.root); this.root.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); }
    this.root = root; this.scene.add(root);
    if (bounds) this.bounds.copy(bounds).expandByScalar(1.5);
    this.updateSelBox(); this.dirty = true;
  }

  setView(v: View, instant = false) {
    this.interior = v.interior;
    this.controls.enabled = !v.interior;
    const to = new THREE.Vector3(...v.pos), tt = new THREE.Vector3(...v.target);
    if (v.interior) {
      const d = tt.clone().sub(to);
      this.look.yaw = Math.atan2(d.x, d.z); this.look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      this.camera.fov = 62;
    } else this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.camera.position.copy(to); this.controls.target.copy(tt); this.finishMove(); }
    else this.anim = { from: this.camera.position.clone(), to, ft: this.controls.target.clone(), tt, t0: performance.now(), dur: 650 };
    this.dirty = true;
  }

  /** Arrow keys / buttons in room mode: turn the head. */
  turn(dyaw: number, dpitch: number) {
    if (!this.interior) {
      const off = this.camera.position.clone().sub(this.controls.target), sph = new THREE.Spherical().setFromVector3(off);
      sph.theta += dyaw; sph.phi = Math.max(0.15, Math.min(Math.PI * 0.47, sph.phi - dpitch));
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph)); this.controls.update(); this.dirty = true; return;
    }
    this.look.yaw += dyaw; this.look.pitch = Math.max(-1.1, Math.min(1.1, this.look.pitch + dpitch)); this.applyLook();
  }
  zoom(f: number) {
    if (this.interior) { this.camera.fov = Math.max(35, Math.min(90, this.camera.fov * f)); this.camera.updateProjectionMatrix(); }
    else { const d = this.camera.position.clone().sub(this.controls.target).multiplyScalar(f); this.camera.position.copy(this.controls.target).add(d); this.controls.update(); }
    this.dirty = true;
  }

  private applyLook() {
    const cp = Math.cos(this.look.pitch);
    const dir = new THREE.Vector3(Math.sin(this.look.yaw) * cp, Math.sin(this.look.pitch), Math.cos(this.look.yaw) * cp);
    this.camera.lookAt(this.camera.position.clone().add(dir)); this.dirty = true;
  }
  private finishMove() { if (this.interior) this.applyLook(); else { this.camera.lookAt(this.controls.target); this.controls.update(); } }
  private clampTarget() { const t = this.controls.target; t.x = Math.max(this.bounds.min.x, Math.min(this.bounds.max.x, t.x)); t.z = Math.max(this.bounds.min.z, Math.min(this.bounds.max.z, t.z)); t.y = Math.max(0, Math.min(2, t.y)); }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; id: number; moved: boolean } | null = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; if (this.interior) el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (!down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (this.interior && down.moved) { this.turn(-dx * 0.005, -dy * 0.004); down.x = e.clientX; down.y = e.clientY; }
    });
    el.addEventListener('pointerup', e => { if (down && !down.moved) this.pick(e); down = null; });
    el.addEventListener('wheel', e => { if (!this.interior) return; e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.06 : 1 / 1.06); }, { passive: false });
  }

  private ray = new THREE.Raycaster();
  pick(e: { clientX: number; clientY: number }) {
    if (!this.root) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.root, true).find(h => (h.object as THREE.Mesh).isMesh && h.object.visible);
    this.onPick((hit?.object.userData.slot as SlotId) || null);
  }

  private selSlot: SlotId | null = null;
  highlight(slot: SlotId | null) { this.selSlot = slot; this.updateSelBox(); this.dirty = true; }
  private updateSelBox() {
    if (this.sel) { this.scene.remove(this.sel); this.sel = null; }
    if (!this.selSlot || !this.root) return;
    const box = new THREE.Box3(); let any = false;
    this.root.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.slot === this.selSlot) { box.expandByObject(o); any = true; } });
    if (!any) return;
    this.sel = new THREE.Box3Helper(box.expandByScalar(0.03), new THREE.Color('#e0662e')); this.scene.add(this.sel);
  }
  /** Centre of all meshes of a slot, to turn the camera toward it. */
  slotCenter(slot: SlotId) {
    const box = new THREE.Box3(); let any = false;
    this.root?.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.slot === slot) { box.expandByObject(o); any = true; } });
    return any ? box.getCenter(new THREE.Vector3()) : null;
  }
  lookAtPoint(p: THREE.Vector3) {
    if (!this.interior) { this.anim = { from: this.camera.position.clone(), to: this.camera.position.clone(), ft: this.controls.target.clone(), tt: p.clone(), t0: performance.now(), dur: 500 }; return; }
    const d = p.clone().sub(this.camera.position); this.look.yaw = Math.atan2(d.x, d.z); this.look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); this.applyLook();
  }

  setLabels(list: Label[]) {
    this.labelHost.innerHTML = ''; this.labelEls = [];
    for (const l of list) { const el = document.createElement('span'); el.className = 'room-label'; el.textContent = l.text; this.labelHost.appendChild(el); this.labelEls.push({ el, p: new THREE.Vector3(l.x, 0.3, l.z) }); }
    this.dirty = true;
  }
  private placeLabels() {
    const r = this.renderer.domElement.getBoundingClientRect();
    for (const { el, p } of this.labelEls) {
      if (this.interior) { el.hidden = true; continue; }
      const v = p.clone().project(this.camera); el.hidden = v.z > 1;
      el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px)`;
    }
  }

  resize() {
    const r = this.host.getBoundingClientRect(); if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); this.dirty = true;
  }
  requestRender() { this.dirty = true; }

  private tick() {
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e); this.controls.target.lerpVectors(this.anim.ft, this.anim.tt, e);
      if (this.interior && k >= 1) this.finishMove(); else this.camera.lookAt(this.controls.target);
      if (k >= 1) { this.anim = null; this.finishMove(); }
      this.dirty = true;
    } else if (!this.interior && this.controls.update()) this.dirty = true;
    if (!this.dirty || document.hidden) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera); this.placeLabels();
  }

  /** Pixel buffers of the current view for the denoiser: surface colour without lighting, and normals. */
  renderAux(w: number, h: number, root: THREE.Object3D) {
    const rt = new THREE.WebGLRenderTarget(w, h), cam = this.camera.clone(); cam.aspect = w / h; cam.updateProjectionMatrix();
    const read = () => { const b = new Uint8Array(w * h * 4); this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, b); const o = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) o.set(b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); return o; };
    const sc = new THREE.Scene(); sc.add(root);
    const tm = this.renderer.toneMapping; this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(rt);
    sc.background = new THREE.Color(0.5, 0.5, 1); sc.overrideMaterial = new THREE.MeshNormalMaterial(); this.renderer.render(sc, cam); const normal = read();
    sc.overrideMaterial = null;
    const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const mt = m.material as THREE.MeshStandardMaterial; swaps.push([m, m.material]); m.material = new THREE.MeshBasicMaterial({ color: mt.color, map: mt.map || null, transparent: mt.transparent, opacity: mt.opacity, side: mt.side }); });
    sc.background = new THREE.Color(0.75, 0.82, 0.88); this.renderer.render(sc, cam); const albedo = read();
    swaps.forEach(([m, mt]) => { (m.material as THREE.Material).dispose(); m.material = mt; });
    this.renderer.setRenderTarget(null); rt.dispose(); this.renderer.toneMapping = tm; sc.remove(root);
    return { normal, albedo };
  }

  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.renderer.dispose(); }
}

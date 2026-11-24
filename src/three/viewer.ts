import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { SlotId, View } from '../types';
import { interiorFov } from './camera';
import { EYE } from '../domain/walk';

export interface Label {
  text: string;
  x: number;
  z: number;
}
/** A ring on the floor that leads into the next room. */
export interface WalkTarget {
  x: number;
  z: number;
  /** where the label floats (the doorway), if not above the ring */
  lx?: number;
  lz?: number;
  label: string;
  go: () => void;
}
export interface Pose {
  x: number;
  z: number;
  rot: number;
}
/** What the app decides while a piece is dragged: which piece a click grabs, where it may land, and the drop. */
export interface DragHandler {
  grab: (slot: SlotId) => { key: SlotId; group: SlotId[]; pose: Pose } | null;
  move: (key: SlotId, x: number, z: number, rot: number) => { pose: Pose; ok: boolean };
  drop: (key: SlotId, pose: Pose) => void;
}

/**
 * Raster 3D view. Two camera modes: an orbiting overview of the whole flat (low walls),
 * and a "stand in the room and look around" mode for each room (full-height walls).
 */
/**
 * The private parts of three's PMREMGenerator that makeEnv() uses to compile the environment shaders up front.
 * They differ between three versions (planar targets up to r186, cube targets from r187), so all are optional
 * and makeEnv() checks which exist.
 */
interface PmremInternals {
  _setSize(size: number): void;
  _allocateTargets?: () => THREE.WebGLRenderTarget;
  _allocateTarget: () => THREE.WebGLRenderTarget;
  _lodMeshes?: THREE.Mesh[];
  _blurMaterial?: THREE.Material;
  _ggxMaterial?: THREE.Material;
  _integrationMaterial?: THREE.Material;
  _renderCube: (...args: unknown[]) => unknown;
  _getSourceTarget(): unknown;
  _applyPMREM(rt: THREE.WebGLRenderTarget): void;
  _blur(rt: THREE.WebGLRenderTarget, sigma: number): void;
  _boxMesh: THREE.Mesh;
}

const RING = new THREE.RingGeometry(0.15, 0.2, 48),
  DISC = new THREE.CircleGeometry(0.15, 48);
const WALK_RING = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
  WALK_DISC = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  controls: OrbitControls;
  root: THREE.Object3D | null = null;
  interior = false;
  onPick: (slot: SlotId | null) => void = () => {};
  /** a click on the floor inside a room (the app decides whether one may walk there) */
  onFloor: (x: number, z: number) => void = () => {};
  /** the camera has finished walking to a point */
  onArrive: (x: number, z: number) => void = () => {};
  drag: DragHandler | null = null;
  /** true while a piece is being dragged (tests and the app read it) */
  dragging = false;
  private look = { yaw: 0, pitch: 0 };
  private walkG = new THREE.Group();
  private walkEls: { el: HTMLButtonElement; p: THREE.Vector3 }[] = [];
  private walkHost: HTMLElement | null = null;
  /** the rest of a walk with several legs (to the doorway, then through it) */
  private walkQueue: [number, number][] = [];
  private walkLook: [number, number] | undefined;
  private walkAnim: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    y0: number;
    y1: number;
    p0: number;
    p1: number;
    t0: number;
    dur: number;
  } | null = null;
  private dirty = true;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; ft: THREE.Vector3; tt: THREE.Vector3; t0: number; dur: number } | null = null;
  private sel: THREE.Box3Helper | null = null;
  private labelEls: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  private ro: ResizeObserver;
  private raf = 0;
  soft = false;
  /** ambient occlusion and MSAA through a composer; on by default where a real GPU draws a desktop-sized view */
  private composer: EffectComposer | null = null;
  private aoWanted = false;
  static software(r: THREE.WebGLRenderer) {
    try {
      const gl = r.getContext(),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return /SwiftShader|llvmpipe|Software/i.test(String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''));
    } catch {
      return false;
    }
  }
  private bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(8, 3, 8));
  /** the flat itself (floor to the cut walls), used to frame the overview */
  private flat = new THREE.Box3();

  constructor(
    private host: HTMLElement,
    private labelHost: HTMLElement,
  ) {
    const lowEnd = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the sun and the furniture only change on a rebuild or a drag: redraw the shadow map then, not on every camera frame
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    // status queries after each shader compile are synchronous GPU round trips; only useful while developing
    this.renderer.debug.checkShaderErrors = !!import.meta.env.DEV;
    // software rendering (no GPU, e.g. some VMs and CI): keep it light so the page stays usable
    if (Viewer.software(this.renderer)) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.soft = true;
    }
    host.appendChild(this.renderer.domElement);

    this.scene.environmentIntensity = 0.55;
    // contact shadows under furniture and in corners: a desktop GPU only; phones and software rendering keep the plain path
    this.aoWanted = !this.soft && !lowEnd;
    this.scene.background = new THREE.Color('#dfe6ec');
    // without the image-based light (software rendering) the sky light makes up for it
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc6ba, this.soft ? 1.1 : 0.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.6);
    sun.position.set(-3, 10, -7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.target.position.set(3.5, 0, 3);
    this.scene.add(sun, sun.target);
    this.walkG.visible = false;
    this.scene.add(this.walkG);
    this.walkHost = document.createElement('div');
    this.walkHost.className = 'walk-spots';
    host.appendChild(this.walkHost);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 22;
    this.controls.addEventListener('change', () => {
      this.clampTarget();
      this.dirty = true;
    });

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  private started = false;
  /**
   * The parts that cost seconds of shader compiling, once the flat is to be drawn: the soft image-based light
   * (skipped where the CPU draws, since PMREM alone takes seconds there) and, on a desktop GPU, ambient occlusion.
   */
  start() {
    if (this.started) return;
    this.started = true;
    if (!this.soft) setTimeout(() => this.makeEnv(), 300);
    if (this.aoWanted) setTimeout(() => this.setAO(true), 1500);
  }

  setRoot(root: THREE.Object3D, bounds?: THREE.Box3) {
    this.start();
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
    }
    this.root = root;
    this.scene.add(root);
    // a flat is small enough to draw whole; culling tested every mesh's bounding sphere on every frame (~0.8 s of a slow phone's startup)
    root.traverse(o => {
      o.frustumCulled = false;
    });
    this.renderer.shadowMap.needsUpdate = true;
    if (bounds) {
      this.bounds.copy(bounds).expandByScalar(1.5);
      this.flat.set(bounds.min.clone(), new THREE.Vector3(bounds.max.x, 1.05, bounds.max.z));
    }
    this.updateSelBox();
    this.recompile();
  }

  /**
   * Compile new shaders off the main thread (KHR_parallel_shader_compile) before drawing. On Windows a synchronous
   * compile of every material takes seconds; meanwhile the canvas keeps showing the last finished frame.
   */
  private compiling = 0;
  private recompile() {
    const id = ++this.compiling;
    this.renderer
      .compileAsync(this.scene, this.camera)
      .catch(() => undefined)
      .then(() => {
        if (id === this.compiling) {
          this.compiling = 0;
          this.dirty = true;
        }
      });
  }
  /**
   * Soft image-based light from three's RoomEnvironment. PMREM compiles its blur shaders synchronously, which on a
   * cold Windows shader cache blocks the page for seconds; so its materials are created first and compiled in
   * parallel (for the same render target, so the variants match), and the environment is baked once they are ready.
   */
  private async makeEnv() {
    const r = this.renderer,
      pm = new THREE.PMREMGenerator(r),
      P = pm as unknown as PmremInternals,
      room = new RoomEnvironment();
    try {
      const prev = r.getRenderTarget(),
        cam = new THREE.PerspectiveCamera(90, 1, 0.1, 100),
        shaders = new THREE.Scene();
      let rt: THREE.WebGLRenderTarget;
      P._setSize(256);
      if (P._allocateTargets) {
        // three r186 and older: planar targets, filter materials made in the constructor.
        // PMREM's own plane geometry: an empty one would compile a different variant (no position attribute)
        rt = P._allocateTargets();
        const geo = P._lodMeshes?.[1]?.geometry || new THREE.PlaneGeometry();
        for (const m of [P._blurMaterial, P._ggxMaterial]) if (m) shaders.add(new THREE.Mesh(geo, m));
      } else {
        // r187+: cube targets, materials made on first use; run the passes with drawing switched off to create them
        rt = P._allocateTarget();
        const draw = P._renderCube;
        P._renderCube = () => undefined;
        try {
          P._getSourceTarget();
          P._applyPMREM(rt);
          P._blur(rt, 0.04);
        } finally {
          P._renderCube = draw;
        }
        for (const m of [P._blurMaterial, P._ggxMaterial, P._integrationMaterial])
          if (m) shaders.add(new THREE.Mesh(P._boxMesh.geometry, m));
      }
      if (!shaders.children.length) throw new Error('PMREM internals changed');
      r.setRenderTarget(rt);
      const ready = Promise.all([r.compileAsync(shaders, cam), r.compileAsync(room, cam)]);
      r.setRenderTarget(prev);
      rt.dispose();
      await ready;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('PMREM warm-up skipped:', e); /* bake right away */
    }
    this.scene.environment = pm.fromScene(room, 0.04).texture;
    pm.dispose();
    this.recompile();
  }
  /**
   * Ambient occlusion (three's GTAO): the soft darkening where furniture meets the floor and walls meet each other,
   * the cue that makes a box read as standing in a room. Rendered through a composer with a multisampled target,
   * so edges stay smooth; loaded on demand.
   */
  async setAO(on: boolean) {
    this.aoWanted = on;
    if (!on) {
      this.composer?.dispose();
      this.composer = null;
      this.dirty = true;
      return;
    }
    if (this.composer) return;
    const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/GTAOPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
    if (!this.aoWanted || this.composer) return;
    const { w, h } = this.size,
      pr = this.renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(Math.max(1, w * pr), Math.max(1, h * pr), { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, Math.max(1, w), Math.max(1, h));
    // a short radius and thin occluders: soft shade in corners and under cabinets, no dark halo behind a fridge or
    // a chair; more samples and a wider denoise, or Intel GPUs show it as grain (compared frame by frame, 21.11.)
    ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 2, thickness: 0.3, scale: 1, samples: 32 });
    ao.updatePdMaterial({ radius: 12, samples: 24, rings: 3, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
    ao.blendIntensity = 1;
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(pr);
    composer.setSize(Math.max(1, w), Math.max(1, h));
    this.composer = composer;
    this.dirty = true;
  }
  get aoOn() {
    return !!this.composer;
  }
  /** Draw the scene once, through the composer when ambient occlusion is on. */
  private draw() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Prepare the shaders of objects that will be added later (decorative models), without drawing them. */
  warm(obj: THREE.Object3D) {
    return this.renderer.compileAsync(obj, this.camera, this.scene).catch(() => undefined);
  }

  setView(v: View, instant = false) {
    this.walkAnim = null;
    this.walkQueue = [];
    this.interior = v.interior;
    this.controls.enabled = !v.interior;
    const to = new THREE.Vector3(...v.pos),
      tt = new THREE.Vector3(...v.target);
    if (v.id === 'overview' && !this.flat.isEmpty()) to.copy(this.frame(to, tt));
    // other outside views are framed for a wide screen; on a tall phone screen step back so the whole flat fits
    else if (!v.interior && this.camera.aspect < 1.05)
      to.sub(tt)
        .multiplyScalar(Math.min(1.8, 1.05 / this.camera.aspect))
        .add(tt);
    if (v.interior) {
      const d = tt.clone().sub(to);
      this.look.yaw = Math.atan2(d.x, d.z);
      this.look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      this.fovScale = 1;
      this.camera.fov = interiorFov(this.camera.aspect);
    } else this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(to);
      this.controls.target.copy(tt);
      this.finishMove();
    } else this.anim = { from: this.camera.position.clone(), to, ft: this.controls.target.clone(), tt, t0: performance.now(), dur: 650 };
    this.dirty = true;
  }

  /**
   * The overview camera keeps its direction but moves to the distance at which the whole flat just fills the
   * screen (with a margin for the room labels), whatever the screen's shape: a small flat no longer sits in the
   * middle of an empty frame, and a phone sees all of it.
   */
  private frame(pos: THREE.Vector3, target: THREE.Vector3) {
    const dir = pos.clone().sub(target).normalize(),
      cam = new THREE.PerspectiveCamera(45, this.camera.aspect || 1, 0.05, 200);
    const b = this.flat,
      corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
        i => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z),
      );
    const fits = (d: number) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return corners.every(c => {
        const p = c.clone().project(cam);
        return Math.abs(p.x) <= 0.86 && Math.abs(p.y) <= 0.8 && p.z < 1;
      });
    };
    let lo = 1,
      hi = 80;
    if (!fits(hi)) return pos;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return target.clone().addScaledVector(dir, hi);
  }

  /** Arrow keys / buttons in room mode: turn the head. */
  turn(dyaw: number, dpitch: number) {
    if (!this.interior) {
      const off = this.camera.position.clone().sub(this.controls.target),
        sph = new THREE.Spherical().setFromVector3(off);
      sph.theta += dyaw;
      sph.phi = Math.max(0.15, Math.min(Math.PI * 0.47, sph.phi - dpitch));
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.look.yaw += dyaw;
    this.look.pitch = Math.max(-1.1, Math.min(1.1, this.look.pitch + dpitch));
    this.applyLook();
  }
  zoom(f: number) {
    if (this.interior) {
      const base = interiorFov(this.camera.aspect);
      this.fovScale = Math.max(35 / base, Math.min(90 / base, this.fovScale * f));
      this.camera.fov = base * this.fovScale;
      this.camera.updateProjectionMatrix();
    } else {
      const d = this.camera.position.clone().sub(this.controls.target).multiplyScalar(f);
      this.camera.position.copy(this.controls.target).add(d);
      this.controls.update();
    }
    this.dirty = true;
  }

  private applyLook() {
    const cp = Math.cos(this.look.pitch);
    const dir = new THREE.Vector3(Math.sin(this.look.yaw) * cp, Math.sin(this.look.pitch), Math.cos(this.look.yaw) * cp);
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.dirty = true;
  }
  private finishMove() {
    if (this.interior) this.applyLook();
    else {
      this.camera.lookAt(this.controls.target);
      this.controls.update();
    }
  }
  private clampTarget() {
    const t = this.controls.target;
    t.x = Math.max(this.bounds.min.x, Math.min(this.bounds.max.x, t.x));
    t.z = Math.max(this.bounds.min.z, Math.min(this.bounds.max.z, t.z));
    t.y = Math.max(0, Math.min(2, t.y));
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; id: number; moved: boolean } | null = null;
    let grab: {
      key: SlotId;
      from: Pose;
      floor0: THREE.Vector3;
      objs: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[];
      to: Pose;
      started: boolean;
    } | null = null;
    // capture phase on the host: decide about dragging before the orbit controls see the press
    this.host.addEventListener(
      'pointerdown',
      e => {
        grab = null;
        if (!this.drag || e.button !== 0 || e.target !== el) return;
        const hit = this.hit(e),
          g = hit && this.drag.grab(hit);
        const floor0 = g && this.floorPoint(e);
        if (!g || !floor0) return;
        this.controls.enabled = false;
        const objs = (this.root?.children || [])
          .filter(c => {
            let any = false;
            c.traverse(o => {
              if (g.group.includes(o.userData.slot)) any = true;
            });
            return any;
          })
          .map(o => ({ o, p: o.position.clone(), q: o.quaternion.clone() }));
        grab = { key: g.key, from: g.pose, floor0, objs, to: g.pose, started: false };
      },
      { capture: true },
    );
    el.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      if (this.interior || grab) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
      }
    });
    el.addEventListener('pointermove', e => {
      if (!down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x,
        dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (grab && down.moved) {
        const f = this.floorPoint(e);
        if (!f || !this.drag) return;
        if (!grab.started) {
          grab.started = true;
          this.dragging = true;
          el.style.cursor = 'grabbing';
          this.host.classList.add('dragging');
        }
        const r = this.drag.move(grab.key, grab.from.x + f.x - grab.floor0.x, grab.from.z + f.z - grab.floor0.z, grab.from.rot);
        grab.to = r.pose;
        this.applyPose(grab.objs, grab.from, r.pose);
        this.selOk = r.ok;
        this.updateSelBox();
        this.dirty = true;
        return;
      }
      if (this.interior && down.moved) {
        this.turn(-dx * 0.005, -dy * 0.004);
        down.x = e.clientX;
        down.y = e.clientY;
      }
    });
    el.addEventListener('pointerup', e => {
      const g = grab;
      grab = null;
      if (g?.started) {
        this.dragging = false;
        el.style.cursor = '';
        this.host.classList.remove('dragging');
        this.selOk = true;
        this.controls.enabled = !this.interior;
        this.drag?.drop(g.key, g.to);
        down = null;
        return;
      }
      if (g) this.controls.enabled = !this.interior;
      if (down && !down.moved && !(this.interior && this.walkClick(e))) this.pick(e);
      down = null;
    });
    el.addEventListener('pointercancel', () => {
      if (grab?.started) {
        this.applyPose(grab.objs, grab.from, grab.from);
        this.dragging = false;
        this.selOk = true;
        this.updateSelBox();
        this.dirty = true;
      }
      if (grab) this.controls.enabled = !this.interior;
      grab = null;
      down = null;
      el.style.cursor = '';
      this.host.classList.remove('dragging');
    });
    el.addEventListener(
      'wheel',
      e => {
        if (!this.interior) return;
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.06 : 1 / 1.06);
      },
      { passive: false },
    );
  }

  /** Move the meshes of a dragged piece from one pose to another without rebuilding the scene. */
  private applyPose(objs: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[], from: Pose, to: Pose) {
    const dr = to.rot - from.rot,
      Y = new THREE.Vector3(0, 1, 0),
      qr = new THREE.Quaternion().setFromAxisAngle(Y, dr);
    for (const { o, p, q } of objs) {
      o.position
        .set(p.x - from.x, p.y, p.z - from.z)
        .applyAxisAngle(Y, dr)
        .add(new THREE.Vector3(to.x, 0, to.z));
      o.quaternion.copy(qr).multiply(q);
    }
    this.root?.updateMatrixWorld(true);
    this.renderer.shadowMap.needsUpdate = true;
  }
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private floorPoint(e: { clientX: number; clientY: number }) {
    this.setRay(e);
    return this.ray.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
  }

  private ray = new THREE.Raycaster();
  private setRay(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      this.camera,
    );
  }
  /** Slot of the furniture under the pointer, if any. */
  hit(e: { clientX: number; clientY: number }): SlotId | null {
    if (!this.root) return null;
    this.setRay(e);
    const h = this.ray.intersectObject(this.root, true).find(x => (x.object as THREE.Mesh).isMesh && x.object.visible);
    return (h?.object.userData.slot as SlotId) || null;
  }
  pick(e: { clientX: number; clientY: number }) {
    if (this.root) this.onPick(this.hit(e));
  }
  /** Screen position of a world point, for tests that drag with a real mouse. */
  toScreen(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera),
      r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private selSlot: SlotId | null = null;
  private selOk = true;
  highlight(slot: SlotId | null) {
    this.selSlot = slot;
    this.updateSelBox();
    this.dirty = true;
  }
  private foot: THREE.Mesh | null = null;
  private updateSelBox() {
    if (this.sel) {
      this.scene.remove(this.sel);
      this.sel = null;
    }
    if (this.foot) {
      this.scene.remove(this.foot);
      this.foot.geometry.dispose();
      (this.foot.material as THREE.Material).dispose();
      this.foot = null;
    }
    if (!this.selSlot || !this.root) return;
    // a freshly built root has not been rendered yet: without this its world matrices are identity and the box lands at 0,0
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let any = false;
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o.userData.slot === this.selSlot) {
        box.expandByObject(o);
        any = true;
      }
    });
    if (!any) return;
    const col = new THREE.Color(this.dragging ? (this.selOk ? '#12b76a' : '#f00f2c') : '#e0662e');
    this.sel = new THREE.Box3Helper(box.expandByScalar(0.03), col);
    (this.sel.material as THREE.LineBasicMaterial).toneMapped = false;
    this.scene.add(this.sel);
    if (this.dragging) {
      // a coloured footprint on the floor says at a glance whether the piece fits where it is
      const sz = box.getSize(new THREE.Vector3()),
        c = box.getCenter(new THREE.Vector3());
      this.foot = new THREE.Mesh(
        new THREE.PlaneGeometry(sz.x, sz.z),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
      );
      this.foot.rotation.x = -Math.PI / 2;
      this.foot.position.set(c.x, 0.02, c.z);
      this.foot.renderOrder = 2;
      this.scene.add(this.foot);
    }
  }
  /** Centre of all meshes of a slot, to turn the camera toward it. */
  slotCenter(slot: SlotId) {
    const box = new THREE.Box3();
    let any = false;
    this.root?.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o.userData.slot === slot) {
        box.expandByObject(o);
        any = true;
      }
    });
    return any ? box.getCenter(new THREE.Vector3()) : null;
  }
  lookAtPoint(p: THREE.Vector3) {
    if (!this.interior) {
      this.anim = {
        from: this.camera.position.clone(),
        to: this.camera.position.clone(),
        ft: this.controls.target.clone(),
        tt: p.clone(),
        t0: performance.now(),
        dur: 500,
      };
      return;
    }
    const d = p.clone().sub(this.camera.position);
    this.look.yaw = Math.atan2(d.x, d.z);
    this.look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.applyLook();
  }

  /** Rings on the floor of the room the camera stands in, each leading into the next room. */
  setWalk(list: WalkTarget[]) {
    if (!this.walkHost) return;
    this.walkG.clear();
    this.walkHost.innerHTML = '';
    this.walkEls = [];
    for (const w of list) {
      const ring = new THREE.Mesh(RING, WALK_RING),
        disc = new THREE.Mesh(DISC, WALK_DISC);
      for (const m of [ring, disc]) {
        m.rotation.x = -Math.PI / 2;
        m.position.set(w.x, 0.015, w.z);
        m.renderOrder = 5;
        m.userData.go = w.go;
        this.walkG.add(m);
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'walk-spot';
      el.textContent = `› ${w.label}`;
      el.onclick = () => w.go();
      this.walkHost.appendChild(el);
      // the label floats in the doorway a little below the eyes: a ring right at your feet is below the picture
      this.walkEls.push({ el, p: new THREE.Vector3(w.lx ?? w.x, 1.45, w.lz ?? w.z) });
    }
    this.dirty = true;
  }
  /** true while the camera walks (tests wait for the end of a walk with several legs) */
  get walking() {
    return !!this.walkAnim || this.walkQueue.length > 0;
  }
  /** Where the camera stands on the floor, and which way it faces (yaw, radians). */
  get standing() {
    return { x: this.camera.position.x, z: this.camera.position.z, yaw: this.look.yaw };
  }
  /** Walk the camera to a floor point at eye height; `face` turns it the way it walks, as a person would. */
  walkTo(x: number, z: number, face = false, rest: [number, number][] = [], look?: [number, number]) {
    if (!this.interior) return;
    this.walkQueue = rest;
    this.walkLook = look;
    const from = this.camera.position.clone(),
      to = new THREE.Vector3(x, EYE, z),
      d = to.clone().sub(from);
    d.y = 0;
    const dist = d.length();
    let y1 = this.look.yaw,
      p1 = this.look.pitch;
    if (face && dist > 0.4) {
      y1 = Math.atan2(d.x, d.z);
      p1 = -0.12;
    }
    // at the end of the walk into a room, turn to look into it; in a small room (a bathroom, a kitchen niche) its
    // middle is right in front of you, and looking on the way you walked shows more of it
    if (look && !rest.length && Math.hypot(look[0] - x, look[1] - z) > 1) {
      y1 = Math.atan2(look[0] - x, look[1] - z);
      p1 = -0.15;
    }
    y1 = this.look.yaw + Math.atan2(Math.sin(y1 - this.look.yaw), Math.cos(y1 - this.look.yaw));
    this.anim = null;
    const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(1200, 300 + dist * 300);
    this.walkAnim = { from, to, y0: this.look.yaw, y1, p0: this.look.pitch, p1, t0: performance.now(), dur };
    this.dirty = true;
  }
  /** A click inside a room: a ring walks to the next room, the floor walks there; furniture is left to pick(). */
  private walkClick(e: { clientX: number; clientY: number }) {
    if (this.walkAnim || !this.root) return false;
    this.setRay(e);
    if (this.walkG.visible) {
      const ring = this.ray.intersectObjects(this.walkG.children, false)[0];
      if (ring) {
        (ring.object.userData.go as () => void)();
        return true;
      }
    }
    const h = this.ray.intersectObject(this.root, true).find(x => (x.object as THREE.Mesh).isMesh && x.object.visible);
    // the rug is floor to walk on; clicking it walks instead of opening its card
    const slot = h?.object.userData.slot;
    if (h && (slot === 'rug' || (h.object.userData.room && !slot))) {
      this.onFloor(h.point.x, h.point.z);
      return slot === 'rug';
    }
    return false;
  }
  setLabels(list: Label[]) {
    this.labelHost.innerHTML = '';
    this.labelEls = [];
    for (const l of list) {
      const el = document.createElement('span');
      el.className = 'room-label';
      el.textContent = l.text;
      this.labelHost.appendChild(el);
      this.labelEls.push({ el, p: new THREE.Vector3(l.x, 0.3, l.z) });
    }
    this.dirty = true;
  }
  /** Room labels follow the camera. Uses the size kept by resize(): reading layout here forced a reflow every frame. */
  private placeLabels() {
    const { w, h } = this.size;
    for (const { el, p } of this.labelEls) {
      const v = p.clone().project(this.camera),
        hide = this.interior || v.z > 1;
      if (el.hidden !== hide) el.hidden = hide;
      if (!hide) el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
    const showWalk = this.interior && !this.walkAnim;
    this.walkG.visible = showWalk;
    for (const { el, p } of this.walkEls) {
      const v = p.clone().project(this.camera),
        hide = !showWalk || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      if (el.hidden !== hide) el.hidden = hide;
      if (!hide) el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }
  private size = { w: 0, h: 0 };
  /** zoom inside a room, relative to the field of view that suits the screen's shape */
  private fovScale = 1;

  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.size = { w: r.width, h: r.height };
    this.renderer.setSize(r.width, r.height, false);
    this.composer?.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    // turning a phone or resizing the window: inside a room the angle follows the new shape, keeping the zoom
    if (this.interior) this.camera.fov = interiorFov(this.camera.aspect) * this.fovScale;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  requestRender() {
    this.dirty = true;
  }
  /** Copy of the current view into a 2D canvas (drawn and copied in the same task, so no preserved buffer is needed). */
  snapshot(target: HTMLCanvasElement) {
    const src = this.renderer.domElement;
    if (!src.width) return;
    if (this.sel) this.sel.visible = false;
    this.draw();
    target.width = src.width;
    target.height = src.height;
    target.getContext('2d')!.drawImage(src, 0, 0);
    if (this.sel) this.sel.visible = true;
    this.dirty = true;
  }

  private tick() {
    if (this.walkAnim) {
      const a = this.walkAnim,
        k = a.dur ? Math.min(1, (performance.now() - a.t0) / a.dur) : 1,
        e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.look.yaw = a.y0 + (a.y1 - a.y0) * e;
      this.look.pitch = a.p0 + (a.p1 - a.p0) * e;
      this.applyLook();
      if (k >= 1) {
        this.walkAnim = null;
        const next = this.walkQueue.shift();
        if (next) this.walkTo(next[0], next[1], true, this.walkQueue, this.walkLook);
        else this.onArrive(a.to.x, a.to.z);
      }
    } else if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur),
        e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
      this.controls.target.lerpVectors(this.anim.ft, this.anim.tt, e);
      if (this.interior && k >= 1) this.finishMove();
      else this.camera.lookAt(this.controls.target);
      if (k >= 1) {
        this.anim = null;
        this.finishMove();
      }
      this.dirty = true;
    } else if (!this.interior && this.controls.update()) this.dirty = true;
    if (!this.dirty || document.hidden || this.compiling) return;
    this.dirty = false;
    this.draw();
    this.placeLabels();
  }

  /** Pixel buffers of the current view for the denoiser: surface colour without lighting, and normals. */
  renderAux(w: number, h: number, root: THREE.Object3D) {
    const rt = new THREE.WebGLRenderTarget(w, h),
      cam = this.camera.clone();
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const read = () => {
      const b = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, b);
      const o = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) o.set(b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      return o;
    };
    const sc = new THREE.Scene();
    sc.add(root);
    const tm = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(rt);
    sc.background = new THREE.Color(0.5, 0.5, 1);
    sc.overrideMaterial = new THREE.MeshNormalMaterial();
    this.renderer.render(sc, cam);
    const normal = read();
    sc.overrideMaterial = null;
    const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mt = m.material as THREE.MeshStandardMaterial;
      swaps.push([m, m.material]);
      m.material = new THREE.MeshBasicMaterial({
        color: mt.color,
        map: mt.map || null,
        transparent: mt.transparent,
        opacity: mt.opacity,
        side: mt.side,
      });
    });
    sc.background = new THREE.Color(0.75, 0.82, 0.88);
    this.renderer.render(sc, cam);
    const albedo = read();
    swaps.forEach(([m, mt]) => {
      (m.material as THREE.Material).dispose();
      m.material = mt;
    });
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.renderer.toneMapping = tm;
    sc.remove(root);
    return { normal, albedo };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
  }
}

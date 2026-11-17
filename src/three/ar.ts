import * as THREE from 'three';

/**
 * "See it in your room": the chosen piece, at its real size, in augmented reality on a phone.
 * - Android (Chrome with ARCore): a WebXR immersive-ar session drawn by three.js; point at the floor, tap to put the
 *   piece down, turn it, tap again to move it.
 * - iPhone and iPad (Safari): the piece is exported to USDZ and opened in AR Quick Look.
 * Nothing leaves the device. This module is loaded only when the button is pressed.
 */
export type ArMode = 'webxr' | 'quicklook';

export async function arSupport(): Promise<ArMode | null> {
  try {
    if (navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))) return 'webxr';
  } catch {
    /* no WebXR */
  }
  const a = document.createElement('a');
  return a.relList?.supports?.('ar') ? 'quicklook' : null;
}

/** A copy of one piece's meshes, standing on y = 0 and centred on the origin, sizes in metres. */
export function pieceObject(root: THREE.Object3D, slot: string): THREE.Group | null {
  const out = new THREE.Group();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.slot !== slot || !m.visible) return;
    const c = new THREE.Mesh(m.geometry, m.material);
    c.applyMatrix4(m.matrixWorld);
    out.add(c);
  });
  if (!out.children.length) return null;
  const box = new THREE.Box3().setFromObject(out),
    centre = box.getCenter(new THREE.Vector3());
  for (const c of out.children) c.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
  return out;
}

export async function showInAR(mode: ArMode, piece: THREE.Group, text: { hint: string; turn: string; done: string }) {
  if (mode === 'quicklook') return quickLook(piece);
  return webXR(piece, text);
}

async function quickLook(piece: THREE.Group) {
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
  const scene = new THREE.Scene();
  scene.add(piece);
  const bytes = await new USDZExporter().parseAsync(scene);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/vnd.usdz+zip' }));
  // Quick Look opens from a link with rel="ar" that holds an image
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = url;
  a.appendChild(document.createElement('img'));
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

async function webXR(piece: THREE.Group, text: { hint: string; turn: string; done: string }) {
  const overlay = document.createElement('div');
  overlay.className = 'ar-overlay';
  overlay.innerHTML = `<p class="ar-hint"></p><div class="ar-row"><button type="button" class="btn" data-ar-turn></button><button type="button" class="btn primary" data-ar-done></button></div>`;
  overlay.querySelector('.ar-hint')!.textContent = text.hint;
  overlay.querySelector('[data-ar-turn]')!.textContent = text.turn;
  overlay.querySelector('[data-ar-done]')!.textContent = text.done;
  document.body.appendChild(overlay);

  const xr = navigator.xr!;
  let session: XRSession;
  try {
    session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    });
  } catch (e) {
    overlay.remove();
    throw e;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, 3, 2);
  scene.add(sun);
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  piece.visible = false;
  scene.add(piece);

  await renderer.xr.setSession(session);
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource?.({ space: viewerSpace });

  session.addEventListener('select', () => {
    if (!reticle.visible) return;
    piece.position.setFromMatrixPosition(reticle.matrix);
    piece.visible = true;
  });
  overlay.querySelector('[data-ar-turn]')!.addEventListener('click', e => {
    e.stopPropagation();
    piece.rotation.y += Math.PI / 2;
  });
  overlay.querySelector('[data-ar-done]')!.addEventListener('click', () => session.end());
  // taps on the overlay's buttons are not placements
  overlay.addEventListener('beforexrselect', e => e.preventDefault());

  renderer.setAnimationLoop((_t, frame) => {
    if (frame && hitSource) {
      const hits = frame.getHitTestResults(hitSource),
        space = renderer.xr.getReferenceSpace();
      const pose = hits.length && space ? hits[0].getPose(space) : undefined;
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
    }
    renderer.render(scene, camera);
  });
  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    hitSource?.cancel();
    renderer.dispose();
    overlay.remove();
  });
}

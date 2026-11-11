// The three.js stage: renderer, scene, lights, the camera object, drawing and resizing. Drawn on
// demand (only when something changed), never in a loop.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type Stage = {
  el: HTMLElement;
  renderer: THREE.WebGLRenderer;
  world: THREE.Scene;
  root: THREE.Group; // the model, turned Z-up like Onshape; everything in model space goes in here
  camera: ViewCamera; // one object for both projections, so every module can keep its reference
  studio: THREE.Texture; // CAD mode's environment (paint.ts turns it on)
  render: () => void;
  beforeRender: (() => void)[]; // run before each frame (camera.ts sets the near / far planes there)
  dispose: () => void;
};

// The view's camera: perspective, or orthographic (Onshape's default) when `ortho` is on. One
// object switches between the two instead of swapping cameras, because picking, measuring and the
// controls hold on to it; three.js reads `isPerspectiveCamera` / `isOrthographicCamera` to pick
// the maths (rays, panning, lighting), so those flags follow `ortho`. In ortho, `orthoHalf` is half
// the view's height in metres at zoom 1; `left` … `bottom` are kept for OrbitControls' panning.
export class ViewCamera extends THREE.PerspectiveCamera {
  ortho = false;
  orthoHalf = 1;
  left = -1;
  right = 1;
  top = 1;
  bottom = -1;
  setOrtho(on: boolean) {
    this.ortho = on;
    const flags = this as unknown as { isPerspectiveCamera: boolean; isOrthographicCamera: boolean };
    flags.isPerspectiveCamera = !on;
    flags.isOrthographicCamera = on;
    this.updateProjectionMatrix();
  }
  override updateProjectionMatrix() {
    if (!this.ortho) return super.updateProjectionMatrix();
    this.top = this.orthoHalf;
    this.bottom = -this.orthoHalf;
    this.right = this.orthoHalf * this.aspect;
    this.left = -this.right;
    const z = this.zoom;
    this.projectionMatrix.makeOrthographic(this.left / z, this.right / z, this.top / z, this.bottom / z, this.near, this.far, this.coordinateSystem, this.reversedDepth);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

export type Snip = { dataUrl: string; w: number; h: number };
export type StageTools = {
  // A rectangle of the view (CSS px from its top left) as a JPEG on `background`; null if empty.
  snapshot: (rect: { x: number; y: number; w: number; h: number }, background: string) => Snip | null;
};

export function createStage(el: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true }); // stencil: section caps (S4)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Onshape's soft background (S9): near white at the top to a light blue-grey at the bottom. Made
  // from the page's own colours, so the dark mode (and the greyscale slider) keeps a dark one.
  renderer.domElement.style.background = "linear-gradient(to bottom, color-mix(in srgb, var(--color-surface) 95%, #8796ad), color-mix(in srgb, var(--color-ink) 80%, #8796ad))";
  el.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  // Lit like Onshape: mostly from the viewer (a light riding on the camera, a little above and
  // to the left), with a soft sky fill, so faces turned away read darker and edges stay crisp.
  world.add(new THREE.HemisphereLight(0xffffff, 0x5d6372, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(2, 4, 3);
  world.add(sun);
  // CAD mode's studio reflections, kept faint, so metal parts read as metal without glare.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  world.environmentIntensity = 0.35;
  const camera = new ViewCamera(40, 1, 0.005, 200);
  camera.position.set(1.4, 1, 1.4);
  const headlight = new THREE.DirectionalLight(0xffffff, 2.1);
  headlight.position.set(-0.4, 0.6, 0);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);
  world.add(camera);
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2; // Onshape is Z-up
  world.add(root);

  const beforeRender: (() => void)[] = [];
  const render = () => {
    for (const f of beforeRender) f();
    renderer.render(world, camera);
  };
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = el;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(el);

  return {
    el,
    renderer,
    world,
    root,
    camera,
    studio,
    render,
    beforeRender,
    dispose: () => {
      observer.disconnect();
      studio.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// Snip (Harel, 2026-11-10): drawn again and copied out at once, while the frame is still in the
// canvas (no preserveDrawingBuffer, which would slow every frame), at the screen's own pixels.
export function stageTools(stage: Stage): StageTools {
  const snapshot = (rect: { x: number; y: number; w: number; h: number }, background: string) => {
    const src = stage.renderer.domElement;
    const scale = src.width / Math.max(1, src.clientWidth);
    const sx = Math.max(0, rect.x * scale), sy = Math.max(0, rect.y * scale);
    const sw = Math.min(src.width - sx, rect.w * scale), sh = Math.min(src.height - sy, rect.h * scale);
    if (sw < 4 || sh < 4) return null;
    const k = Math.min(1, 2000 / Math.max(sw, sh));
    const out = document.createElement("canvas");
    out.width = Math.round(sw * k);
    out.height = Math.round(sh * k);
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    stage.render();
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return { dataUrl: out.toDataURL("image/jpeg", 0.9), w: out.width, h: out.height };
  };
  return { snapshot };
}

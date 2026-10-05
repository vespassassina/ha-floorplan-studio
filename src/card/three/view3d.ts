// The card's 3D view: the one module that imports three.js. The card loads it with `import()` the first time 3D is picked, so
// three.js is a chunk of its own beside the card file and costs nothing until then (docs/DECISIONS.md, S12.3 spike).
// It builds the scene of the floor (core/scene.ts), turns each solid into a mesh, and runs a small orbit camera. Colours
// are the card's `--fp-*` theme tokens, read from the card itself once per theme change. No network, no textures.
import { DirectionalLight, BufferAttribute, BufferGeometry, Color, HemisphereLight, InstancedMesh, LineDashedMaterial, LineLoop, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer, DoubleSide } from "three";
// Types only: this module imports nothing from the card at run time, so the bundler keeps it a chunk of its own (see palette.ts).
import type { Scene as Plan3D } from "../../core/scene";
import { prismTriangles, type Triangles } from "./mesh";
import { lowerWalls, wallBodies, wallZ, type WallBody, type Walls } from "./cut";
import { Orbit } from "./orbit";
import { MARKER_R, Picker, type Pick } from "./pick";
import { roleStyle } from "./palette";

export interface View3DOptions {
  /** `buildScene` of core/scene.ts, passed in by the card (which already carries that code) so that this chunk shares none of it. */
  buildScene(floor: unknown, around?: unknown): Plan3D;
  /** Called once if the view cannot go on (the graphics context is lost): the card then draws 2D and says why. */
  onFail(reason: string): void;
  /** The plan's turn in degrees, the camera's starting azimuth. */
  turnDeg: number;
  /** cm. Where a lowered wall stops: `CUT_WALL_HEIGHT` of core/scene.ts, passed in so this chunk shares no core code. */
  lowWall: number;
}
export interface View3D {
  /** Replaces the scene with this floor's. Never throws. */
  setFloor(floor: unknown, around?: unknown): void;
  /** The card's theme or dark mode may have changed: `key` identifies them, and the colours are read again when it differs. */
  setTheme(key: string): void;
  /** The container's size may have changed. */
  resize(): void;
  /** The walls mode: "full", "cut" (the walls facing the camera drop to `lowWall`) or "low" (all of them do). */
  setWalls(mode: string): void;
  /** A panel covers the left and the right part of the view (fractions of its width): frame the house in the free part. */
  setInset(left: number, right: number): void;
  /** What is under this point of the page (client coordinates), or null: the same answer a tap there gets. */
  pick(clientX: number, clientY: number): Pick | null;
  /** The picked room (its index on the floor) gets a dashed ring along its outline, just above its floor; null removes it. A room with no floor of its own (a zone) gets none. */
  setRing(room: number | null): void;
  /** Back to the first camera. */
  reset(): void;
  /** Whether the last pointer gesture moved: a drag, which is never a tap (S12.4 reads this). */
  readonly dragged: boolean;
  dispose(): void;
}

/** How many renderers are alive in this page. A test hook (the card reads it): the lifecycle test must see it return to 0. */
let live = 0;
export const liveRenderers = (): number => live;

/** Why a view could not be made: WebGL is missing. The card turns this into its one line. */
export class NoWebGL extends Error {}

const FOV = 40;
/** Copy of the card's `TAP_SLOP_PX` (the chunk imports no card code); a test holds the two equal. */
export const DRAG_PX = 6;
/** The far plane, as a multiple of the distance that frames the house. */
const FAR_PLANES = 40;
const hex = (n: number) => n.toString(16).padStart(6, "0");

/** A CSS colour the browser accepts, as 0xRRGGBB, or `null`. Resolved on `probe`, which sits inside the card and so sees its tokens. */
function resolveColour(probe: HTMLElement, css: string): number | null {
  probe.style.color = "";
  probe.style.color = css;
  if (!probe.style.color) return null;
  const c = getComputedStyle(probe).color;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c) ?? null;
  if (m) return (Math.round(+m[1]) << 16) | (Math.round(+m[2]) << 8) | Math.round(+m[3]);
  const s = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
  if (s) return (Math.round(+s[1] * 255) << 16) | (Math.round(+s[2] * 255) << 8) | Math.round(+s[3] * 255);
  return null;
}

export function createView3D(container: HTMLElement, opts: View3DOptions): View3D {
  const canvas = document.createElement("canvas");
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    throw new NoWebGL("WebGL is not available");
  }
  live++;
  let disposed = false;

  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "3D view of the floor");
  container.appendChild(canvas);
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  container.appendChild(probe);

  const scene = new Scene(), camera = new PerspectiveCamera(FOV, 1, 1, 1000);
  scene.add(new HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.9);
  sun.position.set(-0.5, 1, 0.8); // from the south-west, above: the south and west faces catch it, the others stay in half tone
  scene.add(sun);

  let orbit = new Orbit({ min: [0, 0, 0], max: [0, 0, 0] }, 1, FOV, opts.turnDeg);
  let plan: Plan3D | null = null, themeKey = "", meshes: Mesh[] = [], raf = 0, dragged = false;
  // The walls are meshes of their own, built again only when the set of lowered walls changes, never per frame.
  let picker: Picker | null = null, markers: InstancedMesh | null = null, ring: LineLoop | null = null;
  let ringRoom: number | null = null;
  const raycaster = new Raycaster();
  let wallMeshes: Mesh[] = [], bodies: WallBody[] = [], lowered = new Set<string>(), walls: Walls = "cut";

  const size = () => ({ w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) });
  const publish = () => {
    container.dataset.az = orbit.azimuth.toFixed(4);
    container.dataset.polar = orbit.polar.toFixed(4);
    container.dataset.dist = orbit.distance.toFixed(1);
    container.dataset.target = `${orbit.target[0].toFixed(1)},${orbit.target[2].toFixed(1)}`;
  };
  /** Decides which walls are lowered for a camera at `cam` (plan frame); rebuilds the wall meshes only if that changed. */
  const updateWalls = (cam: [number, number, number]) => {
    const next = lowerWalls(bodies, cam, walls, lowered);
    if (next.size === lowered.size && [...next].every((k) => lowered.has(k))) return;
    lowered = next;
    buildWalls();
  };
  /** Puts the camera where the orbit says and decides the lowered walls for it: what a frame and a pick both need first. */
  const prepare = () => {
    const [x, y, z] = orbit.position();
    camera.position.set(x, y, z);
    camera.near = Math.max(1, orbit.framing * 0.02);
    camera.far = orbit.framing * FAR_PLANES;
    camera.lookAt(orbit.target[0], orbit.target[1], orbit.target[2]);
    const { w, h } = size(), shift = orbit.shift;
    if (shift !== 0) camera.setViewOffset(w, h, -shift * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    updateWalls([x, z, y]);
  };
  const draw = () => {
    raf = 0;
    if (disposed) return;
    prepare();
    renderer.render(scene, camera);
    container.dataset.drawn = String(+(container.dataset.drawn ?? 0) + 1);
    publish();
  };
  /** Renders once, on the next frame. A burst of changes (a drag) is one frame; with no change there is no frame at all. */
  const want = () => { if (!raf && !disposed) raf = requestAnimationFrame(draw); };

  const resize = () => {
    if (disposed) return;
    const { w, h } = size();
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    orbit.setAspect(w / h);
    want();
  };

  // ---- the pointer: drag orbits, right drag or shift-drag pans, two fingers pan and pinch, the wheel zooms. A drag is not a tap.
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 }, pinch = 0, mid = { x: 0, y: 0 };
  const twoFingers = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
  let panning = false;
  const onDown = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: nothing to capture */ }
    container.dataset.dragged = "false";
    if (pointers.size === 1) { dragged = false; start = { x: e.clientX, y: e.clientY }; panning = e.button === 2 || e.shiftKey; }
    else if (pointers.size === 2) { const t = twoFingers(); pinch = t.d; mid = t.m; dragged = true; container.dataset.dragged = "true"; }
  };
  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_PX) return; // still a tap, maybe
      dragged = true;
      container.dataset.dragged = "true";
      if (panning) orbit.pan(dx, dy, size().h); else orbit.rotate(dx, dy);
    } else if (pointers.size === 2) {
      const t = twoFingers();
      if (pinch > 0 && t.d > 0) orbit.zoom(pinch / t.d);
      orbit.pan(t.m.x - mid.x, t.m.y - mid.y, size().h);
      pinch = t.d; mid = t.m;
    }
    want();
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (pointers.size === 1) { const [r] = pointers.values(); start = { x: r.x, y: r.y }; }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    orbit.zoom(Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * (e.ctrlKey ? 0.01 : 0.0015)));
    want();
  };
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", noMenu);

  const onLost = (e: Event) => { e.preventDefault(); if (!disposed) opts.onFail("the graphics context was lost"); };
  canvas.addEventListener("webglcontextlost", onLost);

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  // ---- the meshes: one per colour, all the solids of that colour merged, so thousands of pieces are a handful of draw calls.
  const palette = new Map<string, { colour: Color; opacity: number }>();
  const paintOf = (role: string, color: string | undefined) => {
    const key = `${role}|${color ?? ""}`;
    let p = palette.get(key);
    if (!p) {
      const s = roleStyle(role), own = color !== undefined ? resolveColour(probe, color) : null, c = own ?? resolveColour(probe, s.css) ?? 0x888888;
      p = { colour: new Color(`#${hex(c)}`), opacity: s.opacity };
      palette.set(key, p);
    }
    return p;
  };
  const dispose = (list: Mesh[]) => { for (const m of list) { scene.remove(m); m.geometry.dispose(); (m.material as MeshLambertMaterial).dispose(); } };
  /** One mesh per colour from the solids `pick` accepts, drawn over the z range `zOf` gives (null: left out). */
  const meshesOf = (pick: (s: Plan3D["solids"][number]) => boolean, zOf: (s: Plan3D["solids"][number]) => [number, number] | null): Mesh[] => {
    const groups = new Map<string, { tris: Triangles; colour: Color; opacity: number }>();
    for (const s of plan?.solids ?? []) {
      if (s.shape.type !== "prism" || !pick(s)) continue; // a point (a device with no body of its own) is S12.5's
      const z = zOf(s);
      if (!z) continue;
      const p = paintOf(s.paint.role, s.paint.color), key = `${p.colour.getHexString()}|${p.opacity}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { tris: { position: [], normal: [] }, colour: p.colour, opacity: p.opacity }));
      prismTriangles(s.shape.base, z[0], z[1], g.tris);
    }
    const out: Mesh[] = [];
    for (const g of groups.values()) {
      if (!g.tris.position.length) continue;
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(g.tris.position), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(g.tris.normal), 3));
      geo.computeBoundingSphere();
      const glass = g.opacity < 1, mat = new MeshLambertMaterial({ color: g.colour, transparent: glass, opacity: g.opacity, depthWrite: !glass, side: glass ? DoubleSide : undefined });
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = glass ? 1 : 0;
      scene.add(mesh);
      out.push(mesh);
    }
    return out;
  };
  const isWall = (s: Plan3D["solids"][number]) => s.kind === "wall" || s.kind === "opening";
  const clear = () => {
    dispose(meshes); dispose(wallMeshes); meshes = []; wallMeshes = [];
    if (markers) { scene.remove(markers); markers.geometry.dispose(); (markers.material as MeshLambertMaterial).dispose(); markers.dispose(); markers = null; }
    picker = null;
  };
  /** One ball per device that has no body of its own, at its z, in the colour of its type. The tap's proxy (pick.ts) is bigger and has no mesh. */
  const buildMarkers = () => {
    const pts = (plan?.solids ?? []).filter((s) => s.kind === "device" && s.shape.type === "point");
    if (!pts.length) return;
    const m = new InstancedMesh(new SphereGeometry(MARKER_R, 14, 10), new MeshLambertMaterial({ color: 0xffffff }), pts.length), at = new Matrix4();
    pts.forEach((sol, i) => {
      if (sol.shape.type !== "point") return;
      at.makeTranslation(sol.shape.at[0], sol.shape.z, sol.shape.at[1]);
      m.setMatrixAt(i, at);
      m.setColorAt(i, paintOf(sol.paint.role, sol.paint.color).colour);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    scene.add(m);
    markers = m;
  };
  /** The picked room's outline, dashed, a little above its floor so the slab does not eat it. */
  const buildRing = () => {
    if (ring) { scene.remove(ring); ring.geometry.dispose(); (ring.material as LineDashedMaterial).dispose(); ring = null; }
    const sol = ringRoom === null ? undefined : plan?.solids.find((x) => x.kind === "room" && x.ref.room === ringRoom);
    if (!sol || sol.shape.type !== "prism") return;
    const z = sol.shape.z1 + 2;
    const geo = new BufferGeometry().setFromPoints(sol.shape.base.map((q) => new Vector3(q[0], z, q[1])));
    const mat = new LineDashedMaterial({ color: paintOf("ring", undefined).colour, dashSize: 18, gapSize: 10, depthTest: false }); // the outline lies inside the walls' footprint: it is drawn over them, as in 2D
    ring = new LineLoop(geo, mat);
    ring.renderOrder = 10;
    ring.computeLineDistances();
    scene.add(ring);
  };
  const buildWalls = () => {
    dispose(wallMeshes);
    wallMeshes = meshesOf(isWall, (s) => wallZ(s, lowered, opts.lowWall));
    container.dataset.lowered = [...lowered].sort().join(" ");
  };
  const build = () => {
    clear();
    if (!plan) return;
    meshes = meshesOf((s) => !isWall(s), (s) => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : null));
    bodies = wallBodies(plan.solids);
    lowered = new Set();
    buildMarkers();
    picker = new Picker(plan.solids);
    buildWalls();
    buildRing();
  };

  resize();
  const api: View3D = {
    setFloor(floor, around) {
      try { plan = opts.buildScene(floor, around); } catch { plan = null; }
      const { w, h } = size();
      orbit = new Orbit(plan?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] }, w / h, FOV, opts.turnDeg);
      build();
      want();
    },
    setTheme(key) {
      if (key === themeKey) return;
      themeKey = key;
      palette.clear();
      build();
      want();
    },
    resize,
    setWalls(mode) {
      const m: Walls = mode === "full" || mode === "low" ? mode : "cut";
      if (m === walls) return;
      walls = m;
      want(); // the next frame decides, and rebuilds if the set changed
    },
    setInset(left, right) {
      orbit.setInset(left, right);
      container.dataset.inset = `${Math.max(0, +left || 0).toFixed(3)},${Math.max(0, +right || 0).toFixed(3)}`;
      want();
    },
    pick(clientX, clientY) {
      if (disposed || !plan || !picker) return null;
      const r = canvas.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      prepare();
      raycaster.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)), camera);
      const o = raycaster.ray.origin, d = raycaster.ray.direction; // three's frame to the plan's: (x, y, z) -> (x, z, y)
      return picker.pick({ o: [o.x, o.z, o.y], d: [d.x, d.z, d.y] }, (sol) => wallZ(sol, lowered, opts.lowWall));
    },
    setRing(room) {
      ringRoom = typeof room === "number" && Number.isFinite(room) ? room : null;
      container.dataset.ring = ringRoom === null ? "" : String(ringRoom);
      buildRing();
      want();
    },
    reset() { orbit.reset(); want(); },
    get dragged() { return dragged; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", noMenu);
      canvas.removeEventListener("webglcontextlost", onLost);
      clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      probe.remove();
      for (const k of ["az", "polar", "dist", "target", "drawn", "dragged", "lowered", "inset", "ring"]) delete container.dataset[k];
      if (testHook && (globalThis as Record<string, unknown>).__fp3d === testHook) delete (globalThis as Record<string, unknown>).__fp3d;
      ring = null; // its geometry went with the scene
      live--;
    },
  };
  // A hook for the tests, off unless the page sets `__FP3D_TEST__` first: where a point of the plan lies on the screen, so a
  // Playwright test can drive a real mouse at it, and what a point of the screen would pick.
  let testHook: object | null = null;
  if ((globalThis as Record<string, unknown>).__FP3D_TEST__ === true) {
    const project = (x: number, y: number, z: number) => {
      prepare();
      const v = new Vector3(x, z, y).project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    testHook = {
      project,
      /** Where the middle of the top of a solid (a device `kind` "device" with its index, say) is on the screen, or null. */
      where(kind: string, index: number) {
        const sol = plan?.solids.find((x) => x.kind === kind && x.ref.index === index);
        if (!sol) return null;
        if (sol.shape.type === "point") return project(sol.shape.at[0], sol.shape.at[1], sol.shape.z);
        const b = sol.shape.base, cx = b.reduce((a, q) => a + q[0], 0) / b.length, cy = b.reduce((a, q) => a + q[1], 0) / b.length;
        return project(cx, cy, sol.shape.z1);
      },
      pick: (cx: number, cy: number) => api.pick(cx, cy),
    };
    (globalThis as Record<string, unknown>).__fp3d = testHook;
  }
  return api;
}


// The card's 3D view: the one module that imports three.js. The card loads it with `import()` the first time 3D is picked, so
// three.js is a chunk of its own beside the card file and costs nothing until then (docs/DECISIONS.md, S12.3 spike).
// It builds the scene of the floor (core/scene.ts), turns each solid into a mesh, and runs a small orbit camera. Colours
// are the card's `--fp-*` theme tokens, read from the card itself once per theme change. No network, no textures.
// S12.5: `setLive` brings the live state in (core/live.ts, plain JSON): lit rooms and lamp pools, doors, bodies, balls, the
// motion edge, and the HTML overlay. Every part changes in place; the scene is built again only for a new floor or theme.
import { CylinderGeometry, DirectionalLight, BufferAttribute, BufferGeometry, Color, HemisphereLight, InstancedMesh, LineDashedMaterial, LineLoop, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer, DoubleSide } from "three";
// Types only: this module imports nothing from the card at run time, so the bundler keeps it a chunk of its own (see palette.ts).
import { CUT_WALL_HEIGHT, makeBuildScene, type Scene as Plan3D, type Solid, type SceneDeps } from "../../core/scene-build";
import { makeLiveOf, type Live3D, type LiveDeps } from "../../core/live-build";
import type { RenderOpts } from "../../core/render";
import { prismTriangles, type Triangles } from "./mesh";
import { lowerWalls, wallBodies, wallZ, type WallBody, type Walls } from "./cut";
import { Orbit } from "./orbit";
import { MARKER_R, Picker, type Pick } from "./pick";
import { roleStyle } from "./palette";
import { MAX_POOLS, pickLights, roomLifts, roomOfPoint, WALL_REACH, type Poly, type Rgb, type RoomShape } from "./light";
import { createPools, createRings } from "./fx";
import { createOverlay, type Anchors } from "./overlay";
import { pulseAt } from "./ring";

export interface View3DOptions {
  /** The core helpers the scene and the live state are built from, passed in by the card, which already carries them for the 2D plan, so the chunk holds no second copy (core/three-deps.ts). */
  deps: { scene: SceneDeps; live: LiveDeps };
  /** Called once if the view cannot go on (the graphics context is lost): the card then draws 2D and says why. */
  onFail(reason: string): void;
  /** The plan's turn in degrees, the camera's starting azimuth. */
  turnDeg: number;
}
/** A floor under the selected one: its data, what its stairs face (`around`), and where it stands (cm, relative to the selected floor's slab top). */
export interface BelowFloor { key: string; floor: unknown; around?: unknown; elevation: number }
export interface View3D {
  /**
   * Replaces the scene with this floor's. Never throws. `below` are the floors under it, each with its `elevation` in cm relative to
   * this floor's slab top (negative): they are drawn dimmed, with no live state, and the pick ignores them. The camera keeps its
   * azimuth and polar and frames this floor; the old meshes are disposed.
   */
  setFloor(floor: unknown, around?: unknown, below?: BelowFloor[]): void;
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
  /**
   * The live state of the floor (`liveOf` of core/live-build.ts, run here on the card's inputs): what is lit, which door is open, what each
   * device wears. Changes the scene's parts in place, never rebuilds it, and does nothing at all (no frame) when it equals the last one.
   * `null` clears it.
   */
  setLive(floor: unknown, o: RenderOpts, now: number): void;
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
/** radians. How far an open door's leaf swings about its hinge: about 70 degrees. */
const SWING = (70 * Math.PI) / 180;
/** The lights' strength by day and by night, and how much more a lit room and a lamp's pool count at night, against the dark. */
const DAY = { hemi: 1.6, sun: 1.9, boost: 1.3 }, NIGHT = { hemi: 0.5, sun: 0.35, boost: 3.5 };
/** How much of its own opacity a floor below keeps: dim enough to read as "another floor", solid enough to read as a house. */
const DIM = 0.3;
const EMPTY: Live3D = { pulse: [3, 1.4], night: false, labels: false, names: false, colours: "", lights: [], doors: [], devices: [], rooms: [] };
const hexOf = (c: Color) => `#${c.getHexString()}`;

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

  const buildScene = makeBuildScene(opts.deps.scene), liveOf = makeLiveOf(opts.deps.live);
  const scene = new Scene(), camera = new PerspectiveCamera(FOV, 1, 1, 1000);
  const hemi = new HemisphereLight(0xffffff, 0x8a8a8a, DAY.hemi);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, DAY.sun);
  sun.position.set(-0.5, 1, 0.8); // from the south-west, above: the south and west faces catch it, the others stay in half tone
  scene.add(sun);

  let framed = false;
  let orbit = new Orbit({ min: [0, 0, 0], max: [0, 0, 0] }, 1, FOV, opts.turnDeg);
  let plan: Plan3D | null = null, themeKey = "", meshes: Mesh[] = [], raf = 0, dragged = false;
  // The walls are meshes of their own, built again only when the set of lowered walls changes, never per frame.
  let picker: Picker | null = null, markers: InstancedMesh | null = null, ring: LineLoop | null = null;
  let ringRoom: number | null = null, inset: [number, number] = [0, 0];
  const raycaster = new Raycaster();
  let belowPlans: { key: string; plan: Plan3D; meshes: Mesh[] }[] = [];
  let wallMeshes: Mesh[] = [], bodies: WallBody[] = [], lowered = new Set<string>(), walls: Walls = "cut";
  // ---- the live state (S12.5). `liveNow` is what core/live.ts last said; every part below is changed in place from it.
  let liveNow: Live3D | null = null, liveSig = "", builds = 0, pulsing = false, pulseStart = 0, liftKey = "";
  let lifts = new Map<number, Rgb>(), roomShapes: RoomShape[] = [];
  const roomSolid = new Map<number, { base: Poly; z: number }>();
  let parts: { index: number; tag: string; mesh: Mesh; mat: MeshLambertMaterial; rest: Color }[] = [];
  let devBodies: { index: number; type: string; mesh: Mesh; mat: MeshLambertMaterial; rest: Color; lit: Mesh[]; on: boolean }[] = [];
  let ballIdx: number[] = [], ballRest: Color[] = [], anchors: Anchors = { devices: new Map(), rooms: new Map() };
  const overlay = createOverlay(container), pools = createPools(scene), rings = createRings(scene);

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
  const v3 = new Vector3();
  /** A point of the model (three's frame) on the page, px from the view's top left, and whether it is in front of the camera. */
  const project = (p: readonly [number, number, number]) => {
    const { w, h } = size();
    v3.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
    const front = v3.z < -camera.near;
    v3.set(p[0], p[1], p[2]).project(camera);
    return { x: ((v3.x + 1) / 2) * w, y: ((1 - v3.y) / 2) * h, front };
  };
  /** Whether a wall, a stair, a door's leaf or a panel stands between the camera and the point (S12.5 occlusion rule, pick.ts `BLOCKS`). */
  const hidden = (p: readonly [number, number, number]) => {
    if (!picker) return false;
    const o = camera.position, d: [number, number, number] = [p[0] - o.x, p[2] - o.z, p[1] - o.y], len = Math.hypot(d[0], d[1], d[2]);
    return picker.blocked({ o: [o.x, o.z, o.y], d }, len - 3, (sol) => wallZ(sol, lowered, CUT_WALL_HEIGHT));
  };
  const draw = () => {
    raf = 0;
    if (disposed) return;
    prepare();
    // The motion edge breathes while a pulse plays: one frame asks for the next, and the one that ends it sets the held value.
    if (pulsing) pulsing = applyRings();
    renderer.render(scene, camera);
    const { w, h } = size();
    overlay.place(project, hidden, w, h);
    container.dataset.drawn = String(+(container.dataset.drawn ?? 0) + 1);
    publish();
    if (pulsing) want();
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
  const meshesOf = (pick: (s: Plan3D["solids"][number]) => boolean, zOf: (s: Plan3D["solids"][number]) => [number, number] | null, src: Plan3D | null = plan, dim = false): Mesh[] => {
    const groups = new Map<string, { tris: Triangles; colour: Color; opacity: number }>();
    for (const s of src?.solids ?? []) {
      if (s.shape.type !== "prism" || !pick(s)) continue; // a point (a device with no body of its own) is a ball, below
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
      geo.setAttribute("color", new BufferAttribute(new Float32Array(g.tris.position.length).fill(1), 3)); // white: a lit room multiplies it (paintLifts)
      geo.computeBoundingSphere();
      // A floor below is see-through whatever it is made of, and writes no depth: the selected floor's own parts stay in front of it.
      const glass = dim || g.opacity < 1, mat = new MeshLambertMaterial({ color: g.colour, vertexColors: !dim, transparent: glass, opacity: dim ? g.opacity * DIM : g.opacity, depthWrite: !glass, ...(glass ? { side: DoubleSide } : {}) }); // `side: undefined` makes three warn
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = dim ? -1 : glass ? 1 : 0;
      scene.add(mesh);
      out.push(mesh);
    }
    return out;
  };
  const isWall = (s: Solid) => s.kind === "wall" || s.kind === "opening";
  /** A door's leaf and a window's pane are parts of their own (they swing and vanish with the state); a sealed panel stays in the wall. */
  const isPart = (s: Solid) => s.kind === "opening" && (s.tag === "door-leaf" || s.tag === "glass");
  const drop = (m: Mesh) => { scene.remove(m); m.geometry.dispose(); (m.material as MeshLambertMaterial).dispose(); };
  const clear = () => {
    dispose(meshes); dispose(wallMeshes); meshes = []; wallMeshes = [];
    for (const b of belowPlans) { dispose(b.meshes); b.meshes = []; }
    for (const x of parts) drop(x.mesh);
    for (const b of devBodies) { drop(b.mesh); b.lit.forEach(drop); }
    parts = []; devBodies = []; ballIdx = []; ballRest = [];
    rings.dispose();
    roomShapes = []; roomSolid.clear();
    if (markers) { scene.remove(markers); markers.geometry.dispose(); (markers.material as MeshLambertMaterial).dispose(); markers.dispose(); markers = null; }
    picker = null;
  };
  /** One ball per device that has no body of its own, at its z; its colour is the icon's, set by `applyBalls`. A room's own sensor has none. The tap's proxy (pick.ts) is bigger and has no mesh. */
  const buildMarkers = () => {
    const pts = (plan?.solids ?? []).filter((s) => s.kind === "device" && s.shape.type === "point" && !s.ref.hidden && typeof s.ref.index === "number");
    if (!pts.length) return;
    const m = new InstancedMesh(new SphereGeometry(MARKER_R, 14, 10), new MeshLambertMaterial({ color: 0xffffff }), pts.length), at = new Matrix4();
    pts.forEach((sol, i) => {
      if (sol.shape.type !== "point") return;
      at.makeTranslation(sol.shape.at[0], sol.shape.z, sol.shape.at[1]);
      m.setMatrixAt(i, at);
      ballIdx.push(sol.ref.index as number);
      ballRest.push(paintOf(sol.paint.role, sol.paint.color).colour);
      m.setColorAt(i, ballRest[i]);
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
    wallMeshes = meshesOf((x) => isWall(x) && !isPart(x), (x) => wallZ(x, lowered, CUT_WALL_HEIGHT));
    for (const m of wallMeshes) paintLifts(m);
    buildParts();
    container.dataset.lowered = [...lowered].sort().join(" ");
  };

  // ---- the live state, in place -------------------------------------------------------------------------------------
  /** Which room each vertex of a mesh belongs to (its plan x, y in the room's outline; a wall's own faces go to the room they face), worked out the first time a lamp needs it. */
  const ownersOf = (m: Mesh): Int32Array => {
    let o = m.userData.owners as Int32Array | undefined;
    if (!o) {
      const pos = m.geometry.getAttribute("position");
      o = new Int32Array(pos.count);
      for (let i = 0; i < o.length; i++) o[i] = roomOfPoint(roomShapes, pos.getX(i), pos.getZ(i), WALL_REACH);
      m.userData.owners = o;
    }
    return o;
  };
  /** Multiplies the vertex colours of the lit rooms' floors, furniture and walls (white elsewhere): the lamp's room is brighter and warmer, the neighbour is not touched. */
  function paintLifts(m: Mesh) {
    const lit = lifts.size > 0;
    if (!lit && !m.userData.lit) return;
    m.userData.lit = lit;
    const col = m.geometry.getAttribute("color") as BufferAttribute, a = col.array as Float32Array;
    if (!lit) a.fill(1);
    else {
      const own = ownersOf(m);
      for (let i = 0; i < own.length; i++) { const l = lifts.get(own[i]); a[i * 3] = l ? l[0] : 1; a[i * 3 + 1] = l ? l[1] : 1; a[i * 3 + 2] = l ? l[2] : 1; }
    }
    col.needsUpdate = true;
  }
  /** A door's leaf and a window's pane: one mesh each, built round the hinge so the leaf can swing. Built again with the walls (it lowers with its wall). */
  function buildParts() {
    for (const x of parts) drop(x.mesh);
    parts = [];
    for (const s of plan?.solids ?? []) {
      if (!isPart(s) || s.shape.type !== "prism" || typeof s.ref.index !== "number" || s.shape.base.length < 4) continue;
      const z = wallZ(s, lowered, CUT_WALL_HEIGHT);
      if (!z) continue;
      const b = s.shape.base, hx = (b[0][0] + b[3][0]) / 2, hy = (b[0][1] + b[3][1]) / 2, tris: Triangles = { position: [], normal: [] };
      prismTriangles(b.map((q) => [q[0] - hx, q[1] - hy] as [number, number]), z[0], z[1], tris);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(tris.position), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(tris.normal), 3));
      const p = paintOf(s.paint.role, s.paint.color), glass = p.opacity < 1;
      const mat = new MeshLambertMaterial({ color: p.colour, transparent: glass, opacity: p.opacity, depthWrite: !glass, side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(hx, 0, hy);
      mesh.renderOrder = glass ? 1 : 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      parts.push({ index: s.ref.index, tag: s.tag, mesh, mat, rest: p.colour });
    }
    applyDoors();
  }
  /** The bodies of the radiator, speaker and TV: a mesh each (so its colour can change), a screen on the TV, two drivers on the speaker. */
  function buildBodies() {
    for (const s of plan?.solids ?? []) {
      if (s.kind !== "device" || s.shape.type !== "prism" || s.ref.hidden || typeof s.ref.index !== "number") continue;
      const b = s.shape.base, z0 = s.shape.z0, z1 = s.shape.z1, tris: Triangles = { position: [], normal: [] };
      prismTriangles(b, z0, z1, tris);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(tris.position), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(tris.normal), 3));
      const p = paintOf(s.paint.role, s.paint.color), mat = new MeshLambertMaterial({ color: p.colour }), mesh = new Mesh(geo, mat);
      scene.add(mesh);
      const lit: Mesh[] = [], glow = (g: BufferGeometry) => { const m = new Mesh(g, new MeshBasicMaterial({ color: 0x000000, side: DoubleSide })); m.renderOrder = 1; scene.add(m); lit.push(m); return m; };
      const cx = b.reduce((a, q) => a + q[0], 0) / b.length, cy = b.reduce((a, q) => a + q[1], 0) / b.length;
      if (s.tag === "tv" && b.length === 4) {
        // The screen is the face on the far side of the wall (base[2] to base[3]), a hair proud of it, inset like the 2.5D bezel.
        const e0 = b[3], e1 = b[2], ex = e1[0] - e0[0], ey = e1[1] - e0[1], el = Math.hypot(ex, ey) || 1;
        let nx = ey / el, ny = -ex / el;
        if (nx * ((e0[0] + e1[0]) / 2 - cx) + ny * ((e0[1] + e1[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
        const ins = 4, ux = ex / el, uy = ey / el, a = [e0[0] + ux * ins + nx * 0.4, e0[1] + uy * ins + ny * 0.4], c = [e1[0] - ux * ins + nx * 0.4, e1[1] - uy * ins + ny * 0.4];
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(new Float32Array([a[0], z0 + ins, a[1], c[0], z0 + ins, c[1], c[0], z1 - ins, c[1], a[0], z0 + ins, a[1], c[0], z1 - ins, c[1], a[0], z1 - ins, a[1]]), 3));
        glow(g);
      } else if (s.tag === "speaker" && b.length === 4) {
        const ux = b[1][0] - b[0][0], uy = b[1][1] - b[0][1];
        [[0.2, 5], [-0.22, 3]].forEach(([k, r]) => { const m = glow(new CylinderGeometry(r, r, 0.6, 18)); m.position.set(cx + ux * k, z1 + 0.3, cy + uy * k); });
      }
      devBodies.push({ index: s.ref.index, type: s.tag, mesh, mat, rest: p.colour, lit, on: false });
    }
  }
  function applyDoors() {
    const L = liveNow ?? EMPTY, open = paintOf("open-door", undefined).colour, cover = paintOf("door-cover", undefined).colour;
    for (const x of parts) {
      const d = L.doors[x.index] ?? null, swing = !!d && (d.open || d.cover);
      if (x.tag === "door-leaf") x.mesh.rotation.y = swing ? -SWING : 0;
      x.mesh.visible = x.tag === "door-leaf" || !(d && d.open);
      x.mat.color.copy(d && (d.alarm || d.open) ? open : d && d.cover && x.tag === "door-leaf" ? cover : x.rest);
    }
  }
  function applyBodies() {
    const L = liveNow ?? EMPTY, heat = paintOf("body-heating", undefined).colour, on = paintOf("screen-on", undefined).colour, driver = paintOf("driver-on", undefined).colour, off = paintOf("driver-off", undefined).colour;
    for (const b of devBodies) {
      const d = L.devices[b.index] ?? null;
      if (b.type === "heater") b.mat.color.copy(d && d.state === "on" ? heat : b.rest);
      b.on = b.type === "tv" ? !!d && d.state === "on" : b.type === "speaker" ? !!d && d.playing : false;
      for (const m of b.lit) (m.material as MeshBasicMaterial).color.copy(b.on ? (b.type === "tv" ? on : driver) : off);
    }
  }
  /** A ball is the colour its icon is drawn in (the card's stylesheet decides, as in 2D), faded toward the backdrop by the icon's opacity. */
  function applyBalls() {
    if (!markers) return;
    const back = paintOf("backdrop", undefined).colour, c = new Color();
    ballIdx.forEach((di, k) => {
      const f = overlay.fill(di), css = f ? resolveColour(probe, f.css) : null;
      if (css === null || !f) { markers!.setColorAt(k, ballRest[k]); return; }
      c.set(`#${hex(css)}`);
      if (f.opacity < 1) c.lerp(back, 1 - Math.max(0, f.opacity));
      markers!.setColorAt(k, c);
    });
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
  }
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The motion edges: a pulse plays for a room just tripped (three pulses, then hold), the hold fades by the plan's own figure. Returns whether a pulse is still playing. */
  function applyRings(): boolean {
    const L = liveNow ?? EMPTY, t = (performance.now() - pulseStart) / 1000, calm = reduced();
    let more = false;
    for (const [room, rs] of roomSolid) {
      const m = L.rooms[room]?.motion ?? null;
      if (!m || !(m.v > 0)) { rings.set(room, rs.base, rs.z, null); continue; }
      let opacity = m.v;
      if (m.pulseAge !== null && !calm) {
        const age = m.pulseAge + t;
        if (age < L.pulse[0] * L.pulse[1]) { opacity = m.v * pulseAt(age, L.pulse[1]); more = true; }
      }
      rings.set(room, rs.base, rs.z, { colour: paintOf(m.radar ? "motion-radar" : "motion", undefined).colour, opacity });
    }
    return more;
  }
  const rgbOf = (css: string | null): Rgb => {
    const n = resolveColour(probe, css ?? roleStyle("lamp").css);
    return n === null ? [1, 0.85, 0.6] : [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  /** Everything the live state changes, brought in line with `liveNow`. Touches only what differs; never builds the scene. */
  function applyLive() {
    const L = liveNow ?? EMPTY, mode = L.night ? NIGHT : DAY;
    hemi.intensity = mode.hemi;
    sun.intensity = mode.sun;
    const lit = L.lights.map((l) => ({ room: l.room, at: l.at, rgb: rgbOf(l.rgb), level: l.level }));
    lifts = roomLifts(lit, mode.boost);
    const key = JSON.stringify([...lifts]);
    if (key !== liftKey) { liftKey = key; for (const m of meshes) paintLifts(m); for (const m of wallMeshes) paintLifts(m); }
    const b = plan?.bounds, centre: [number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0];
    const here = lit.filter((l) => roomSolid.has(l.room));
    pools.set(pickLights(here, centre, MAX_POOLS).map((l) => { const r = roomSolid.get(l.room)!; return { at: l.at, z: r.z, base: r.base, rgb: l.rgb, level: l.level, room: l.room, boost: mode.boost }; }));
    container.dataset.pools = `${pools.visible()}/${here.length}`;
    overlay.set(L, anchors);
    applyBalls();
    applyBodies();
    applyDoors();
    pulsing = applyRings();
    want();
  }
  const anchorsOf = (): Anchors => {
    const devices = new Map<number, [number, number, number]>(), roomsA = new Map<number, [number, number, number]>();
    for (const s of plan?.solids ?? []) {
      if (s.kind === "device" && !s.ref.hidden && typeof s.ref.index === "number") {
        if (s.shape.type === "point") devices.set(s.ref.index, [s.shape.at[0], s.shape.z, s.shape.at[1]]);
        else { const b = s.shape.base; devices.set(s.ref.index, [b.reduce((a, q) => a + q[0], 0) / b.length, s.shape.z1 + 6, b.reduce((a, q) => a + q[1], 0) / b.length]); }
      }
    }
    for (const [r, rs] of roomSolid) roomsA.set(r, [0, rs.z + 2, 0]);
    return { devices, rooms: roomsA };
  };

  const build = () => {
    clear();
    builds++;
    if (!plan) { anchors = { devices: new Map(), rooms: new Map() }; applyLive(); return; }
    meshes = meshesOf((s) => !isWall(s) && s.kind !== "device", (s) => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : null));
    // Rooms by index: where lamps and edges go, and which room a vertex belongs to.
    for (const s of plan.solids) {
      if (s.kind === "room" && s.tag !== "fill" && s.shape.type === "prism" && typeof s.ref.room === "number") {
        const base = s.shape.base, area = Math.abs(base.reduce((a, q, i) => { const n = base[(i + 1) % base.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
        roomSolid.set(s.ref.room, { base, z: s.shape.z1 });
        roomShapes.push({ index: s.ref.room, base, top: s.shape.z1, area });
      }
    }
    // The floors below: every solid but a device (their lights, doors and icons are not shown), whole, at their elevation.
    for (const b of belowPlans) b.meshes = meshesOf((s) => s.kind !== "device", (s) => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : null), b.plan, true);
    container.dataset.below = String(belowPlans.length);
    lifts = new Map(); liftKey = "";
    bodies = wallBodies(plan.solids);
    lowered = new Set();
    buildMarkers();
    buildBodies();
    anchors = anchorsOf();
    picker = new Picker(plan.solids);
    buildWalls();
    buildRing();
    applyLive();
  };

  resize();
  const api: View3D = {
    setFloor(floor, around, below) {
      try { plan = buildScene(floor as never, { around: around as never }); } catch { plan = null; }
      clear(); // the old floor's meshes and the old floors below go now, before the new ones are made
      belowPlans = [];
      for (const b of Array.isArray(below) ? below : []) {
        try { if (b && Number.isFinite(b.elevation)) belowPlans.push({ key: String(b.key), plan: buildScene(b.floor as never, { around: b.around as never, elevation: b.elevation }), meshes: [] }); } catch { /* a floor that cannot be built is left out */ }
      }
      // The camera frames the stack: the selected floor and what stands under it, so the dimmed floors are not cut off by the edge.
      const own = plan?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
      const bounds = { min: [...own.min] as [number, number, number], max: [...own.max] as [number, number, number] }; // a copy: the plan's own bounds centre the lamps' pools
      for (const b of belowPlans) if (b.plan.solids.length) for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], b.plan.bounds.min[i]); bounds.max[i] = Math.max(bounds.max[i], b.plan.bounds.max[i]); }
      if (framed) orbit.reframe(bounds); // the same way of looking, at the new floor
      else {
        const { w, h } = size();
        orbit = new Orbit(bounds, w / h, FOV, opts.turnDeg);
        orbit.setInset(inset[0], inset[1]); // a new floor keeps the room the list takes
        framed = true;
      }
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
      const key = `${Math.max(0, +left || 0).toFixed(3)},${Math.max(0, +right || 0).toFixed(3)}`;
      if (key === container.dataset.inset) return; // the card says it after every render: the same inset is no frame
      inset = [left, right];
      orbit.setInset(left, right);
      container.dataset.inset = key;
      want();
    },
    pick(clientX, clientY) {
      if (disposed || !plan || !picker) return null;
      const r = canvas.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const icon = overlay.hit(clientX - r.left, clientY - r.top); // an icon is on top of the model: it is what a tap on it means
      if (icon !== null) return { type: "device", index: icon };
      prepare();
      raycaster.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)), camera);
      const o = raycaster.ray.origin, d = raycaster.ray.direction; // three's frame to the plan's: (x, y, z) -> (x, z, y)
      return picker.pick({ o: [o.x, o.z, o.y], d: [d.x, d.z, d.y] }, (sol) => wallZ(sol, lowered, CUT_WALL_HEIGHT));
    },
    setRing(room) {
      const next = typeof room === "number" && Number.isFinite(room) ? room : null;
      if (next === ringRoom && container.dataset.ring !== undefined) return;
      ringRoom = next;
      container.dataset.ring = ringRoom === null ? "" : String(ringRoom);
      buildRing();
      want();
    },
    setLive(floor, o, now) {
      if (disposed) return;
      let l: Live3D | null = null;
      try { l = liveOf(floor as never, o, now); } catch { l = null; } // liveOf never throws; a layout is untrusted all the same
      // A steady edge (reduced motion) has no use for the age of a pulse, which changes with every render and would redraw for nothing.
      const sig = l ? JSON.stringify(reduced() ? { ...l, rooms: l.rooms.map((r) => (r && r.motion ? { ...r, motion: { ...r.motion, pulseAge: null } } : r)) } : l) : "";
      if (sig === liveSig) return; // nothing changed: no work and no frame
      liveSig = sig;
      liveNow = l ?? null;
      pulseStart = performance.now();
      try { applyLive(); } catch { /* a live state that cannot be drawn leaves the last one on screen */ }
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
      pools.dispose();
      overlay.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      probe.remove();
      for (const k of ["az", "polar", "dist", "target", "drawn", "dragged", "lowered", "inset", "ring", "pools", "below"]) delete container.dataset[k];
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
      /** Points the camera (az: 0 is south of the house, positive turns east; polar: 0 straight down). */
      look(az: number, polar: number) { orbit.azimuth = az; orbit.polar = Math.max(0.1, Math.min(1.45, polar)); want(); },
      /** The floors below and the height range of everything drawn (cm, plan z): what the stacking test reads. */
      floors() {
        const range = (list: Mesh[]) => {
          let y0 = Infinity, y1 = -Infinity;
          for (const m of list) { const b = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox!); y0 = Math.min(y0, b.min.y + m.position.y); y1 = Math.max(y1, b.max.y + m.position.y); }
          return { y0, y1 };
        };
        const own = [...meshes, ...wallMeshes, ...parts.map((x) => x.mesh), ...devBodies.map((x) => x.mesh)];
        const all = range([...own, ...belowPlans.flatMap((b) => b.meshes)]);
        return {
          below: belowPlans.map((b) => ({ key: b.key, ...range(b.meshes), opacity: Math.max(0, ...b.meshes.map((m) => (m.material as MeshLambertMaterial).opacity)), meshes: b.meshes.length, pickable: !!picker && plan !== null && b.plan === plan })),
          extent: all,
        };
      },
      /** three's own count of what the graphics card holds: 21 floor switches must leave it where 2 did. */
      memory: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      /** What the live state did to the scene: for the tests, which read the pixels too. */
      live() {
        const body = (b: (typeof devBodies)[number]) => ({ index: b.index, type: b.type, colour: hexOf(b.mat.color), emissive: b.on && b.lit[0] ? hexOf((b.lit[0].material as MeshBasicMaterial).color) : "#000000" });
        const c = new Color();
        return {
          builds, children: scene.children.length, pulsing,
          doors: parts.map((x) => ({ index: x.index, tag: x.tag, visible: x.mesh.visible, rot: x.mesh.rotation.y || 0, colour: hexOf(x.mat.color) })),
          bodies: devBodies.map(body),
          balls: ballIdx.map((di, k) => { markers?.getColorAt(k, c); return { index: di, colour: hexOf(c), shown: true }; }),
          pools: pools.info(),
          lifted: [...lifts.keys()].sort((a, b) => a - b),
          rings: rings.info([...roomSolid.keys()]),
        };
      },
    };
    (globalThis as Record<string, unknown>).__fp3d = testHook;
  }
  return api;
}


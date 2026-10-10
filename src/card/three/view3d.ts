// The card's 3D view: the one module that imports three.js. The card loads it with `import()` the first time 3D is picked, so
// three.js is a chunk of its own beside the card file and costs nothing until then (docs/DECISIONS.md, S12.3 spike).
// It builds the scene of the floor (core/scene.ts), turns each solid into a mesh, and runs a small orbit camera. Colours
// are the card's `--fp-*` theme tokens, read from the card itself once per theme change. No network. S13: a room's or tread's top face wears its floor texture (tex.ts), and a lit lamp lights the walls of its room (glow.ts).
// S12.5: `setLive` brings the live state in (core/live.ts, plain JSON): lit rooms and lamp pools, doors, bodies, balls, the
// motion edge, and the HTML overlay. Every part changes in place; the scene is built again only for a new floor or theme.
import { CylinderGeometry, DirectionalLight, type Material, BufferAttribute, BufferGeometry, Color, HemisphereLight, InstancedMesh, LineDashedMaterial, LineLoop, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer, DoubleSide, MultiplyBlending, PlaneGeometry } from "three";
// Types only: this module imports nothing from the card at run time, so the bundler keeps it a chunk of its own (see palette.ts).
import { CUT_WALL_HEIGHT, ICON_MARGIN, makeBuildScene, type Scene as Plan3D, type Solid, type SceneDeps } from "../../core/scene-build";
import { makeLiveOf, type Live3D, type LiveDeps } from "../../core/live-build";
import type { RenderOpts } from "../../core/render";
import { prismTriangles, type Triangles } from "./mesh";
import { lowerWalls, wallBodies, wallZ, type WallBody, type Walls } from "./cut";
import { Orbit } from "./orbit";
import { MARKER_R, Picker, type Pick } from "./pick";
import { dimRgb, parsePaintDim, roleStyle, type PaintDim } from "./palette";
import { MAX_POOLS, outwardSign, pickLights, roomLifts, roomOfPoint, WALL_REACH, type Poly, type Rgb, type RoomShape } from "./light";
import { createPools, createRings } from "./fx";
import { createGlow, type GlowSide, type GlowSpec } from "./glow";
import { createRasters, textureKey, uvOf, type TextureTile } from "./tex";
import { createOverlay, type Anchors } from "./overlay";
import { crownMesh } from "./crowns";
import { contactShadows, groundBox } from "./shade";
import { debugOnce } from "../../core/debug-once";
import { pulseAt } from "./ring";

export interface View3DOptions {
  /** The core helpers the scene and the live state are built from, passed in by the card, which already carries them for the 2D plan, so the chunk holds no second copy (core/three-deps.ts). */
  deps: { scene: SceneDeps; live: LiveDeps; /** A floor texture by id, turn and scale as the layout says them (`textureTile`, core/textures.ts): the tile to draw, or null for an id that is not a texture. */ texture: (id: unknown, rot: unknown, scale: unknown) => TextureTile | null };
  /** Called once if the view cannot go on (the graphics context is lost and does not come back, a frame cannot be drawn): the card then draws 2D and says why. `retry` says a later try may work (a lost context). */
  onFail(reason: string, retry?: boolean): void;
  /** The plan's turn in degrees, the camera's starting azimuth. */
  turnDeg: number;
  /** Called after the person moved the camera (a drag, a wheel turn, a pinch), once per gesture event: the card saves the camera for the floor, debounced. Never called for a `setCamera` or `reset`. */
  onCamera?(): void;
}
/** The camera as `Orbit.state` says it: numbers that do not depend on the size of the view. */
export interface CameraState { az: number; polar: number; zoom: number; dx: number; dz: number }
export interface View3D {
  /**
   * Replaces the scene with this floor's, alone: no other floor is drawn. Never throws. The camera keeps its azimuth and polar and
   * frames this floor; the old meshes are disposed.
   */
  setFloor(floor: unknown, around?: unknown): void;
  /**
   * S27.7: the floors below the one `setFloor` drew, under it. Each entry is `{ floor, elevation, shift }`: `elevation` is the floor's
   * walking surface in the frame of the current floor (cm, negative below it, `floorElevation` differences) and `shift` is `floorShift` (cm,
   * plan x and y). `mode`: "ghost" (translucent, no depth write), "solid" (their own colours), anything else draws none. They are never
   * picked, never lowered, carry no live state, and are not framed by the camera. Every call replaces the last; `setFloor` keeps them, so
   * the card calls this after it. Junk entries are skipped; it never throws.
   */
  setBelow(floors: unknown, mode: string): void;
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
  /** Where the camera stands now, to be stored per floor (S14.4). */
  camera(): CameraState;
  /** Puts the camera back where `camera()` once said, bounded by what a drag could reach; junk changes nothing. Call it after `setFloor`, which frames the floor first. */
  setCamera(c: CameraState): void;
  /** Whether the last pointer gesture moved: a drag, which is never a tap (S12.4 reads this). */
  readonly dragged: boolean;
  dispose(): void;
}

/** Set by the build (vite.config.ts `define`): true only in the test build the Playwright specs run against, so the hook below is dropped from the shipped chunk. */
declare const __FP3D_TEST__: boolean;
/** The test hooks of the live views, newest last: `window.__fp3d` is the newest, and removing one view puts the one before it back. */
const hooks: object[] = [];
const publishHook = () => { const g = globalThis as Record<string, unknown>; if (hooks.length) g.__fp3d = hooks[hooks.length - 1]; else delete g.__fp3d; };

/** How many renderers are alive in this page. A test hook (the card reads it): the lifecycle test must see it return to 0. */
let live = 0;
export const liveRenderers = (): number => live;

/** `onFail`'s reason for a lost graphics context: the card matches it to try again later. */
export const CONTEXT_LOST = "the graphics context was lost";
/** ms. How long a lost graphics context is waited for before the view gives up: a driver reset restores it within a moment. */
const RESTORE_MS = 3000;

/** Why a view could not be made: WebGL is missing. The card turns this into its one line. */
export class NoWebGL extends Error {}

const FOV = 40;
/** The most opaque a ghost floor below is (S27.7). */
const GHOST_OPACITY = 0.25;
/** Copy of the card's `TAP_SLOP_PX` (the chunk imports no card code); a test holds the two equal. */
export const DRAG_PX = 6;
/** The far plane, as a multiple of the distance that frames the house. */
const FAR_PLANES = 40;
const hex = (n: number) => n.toString(16).padStart(6, "0");
/** radians. How far an open door's leaf swings about its hinge: about 70 degrees. */
const SWING = (70 * Math.PI) / 180;
/** The lights' strength by day and by night, and how much more a lit room and a lamp's pool count at night, against the dark. */
const DAY = { hemi: 1.6, sun: 1.9, boost: 1.3 }, NIGHT = { hemi: 0.5, sun: 0.35, boost: 3.5 };
const EMPTY: Live3D = { pulse: [3, 1.4], night: false, labels: false, names: false, lights: [], doors: [], devices: [], pieces: [], rooms: [] };
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
  let plan: Plan3D | null = null, themeKey = "", meshes: Mesh[] = [], crowns: Mesh[] = [], raf = 0, dragged = false;
  // S28.8: the ground plane and one contact-shadow mesh per drawn floor. `shadeOn` is a test switch (the pixel test compares with and without).
  let ground: Mesh | null = null, shades: Mesh[] = [], belowShades: Mesh[] = [], belowLow = Infinity, belowBox = null as { min: number[]; max: number[] } | null, shadeOn = true;
  // The walls are meshes of their own, built again only when the set of lowered walls changes, never per frame.
  let picker: Picker | null = null, markers: InstancedMesh | null = null, ring: LineLoop | null = null;
  let ringRoom: number | null = null, inset: [number, number] = [0, 0];
  const raycaster = new Raycaster();
  let wallMeshes: Mesh[] = [], bodies: WallBody[] = [], lowered = new Set<string>(), walls: Walls = "cut";
  // ---- the live state (S12.5). `liveNow` is what core/live.ts last said; every part below is changed in place from it.
  let liveNow: Live3D | null = null, liveSig = "", builds = 0, pulsing = false, pulseStart = 0, liftKey = "";
  let lifts = new Map<number, Rgb>(), roomShapes: RoomShape[] = [];
  const roomSolid = new Map<number, { base: Poly; z: number }>();
  let parts: { index: number; tag: string; mesh: Mesh; mat: MeshLambertMaterial; rest: Color; shut?: boolean }[] = [];
  /** A linked tv, speaker or computer piece: a mesh of its own (so its colour can follow the state), at rest in the linked colour, on in the plan's on colour. */
  let pieceBodies: { index: number; mesh: Mesh; mat: MeshLambertMaterial; rest: Color; on: boolean }[] = [];
  let devBodies: { index: number; type: string; mesh: Mesh; mat: MeshLambertMaterial; rest: Color; lit: Mesh[]; on: boolean }[] = [];
  let ballIdx: number[] = [], ballRest: Color[] = [], anchors: Anchors = { devices: new Map(), rooms: new Map() };
  const overlay = createOverlay(container), pools = createPools(scene), rings = createRings(scene), glow = createGlow(scene);
  // ---- floor textures (S13): the meshes that wear one, and the rasters (made once, kept for the view). A mesh shows the texture's flat colour until its raster is ready.
  let texMeshes: { mesh: Mesh; mat: MeshLambertMaterial; tile: TextureTile }[] = [];
  const rasters = createRasters(() => { if (disposed) return; applyTextures(); want(); }, (e) => debugOnce("3D view: a floor texture could not be drawn; its flat colour stays", e));
  // ---- the lamp's light on the walls (S13): the faces of the drawn walls, and the lamps they were last given
  let wallSides: GlowSide[] = [], glowSpecs: GlowSpec[] = [], sidesVersion = 0, deviceZ = new Map<number, number>();

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
  /** The view cannot go on: say so once, and the card draws 2D with a line saying why (never a blank canvas). */
  const fail = (why: string, retry = false) => { if (!disposed) opts.onFail(why, retry); };
  let lost = false, restoreTimer: ReturnType<typeof setTimeout> | null = null;
  const draw = () => {
    raf = 0;
    if (disposed || lost) return; // a lost context draws nothing; `webglcontextrestored` asks for the next frame
    try {
      prepare();
      if (!orbit.finite) throw new Error("the camera has no finite position (the plan's numbers are out of range)");
      // The motion edge breathes while a pulse plays: one frame asks for the next, and the one that ends it sets the held value.
      if (pulsing) pulsing = applyRings();
      renderer.render(scene, camera);
      const { w, h } = size();
      overlay.place(project, hidden, w, h);
      container.dataset.drawn = String(+(container.dataset.drawn ?? 0) + 1);
      publish();
    } catch (err) {
      debugOnce("3D view: a frame could not be drawn", err);
      fail("it could not start");
      return;
    }
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

  // ---- the pointer: drag orbits; a middle drag, a right drag, a shift-drag or Space held plus a drag pans; two fingers pan and
  // pinch; the wheel zooms. A drag is not a tap.
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 }, pinch = 0, mid = { x: 0, y: 0 };
  const twoFingers = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
  let panning = false;
  // Space: held while the pointer is over the view, a left drag pans. The key reaches the page, not the canvas (a canvas has no
  // focus), so the listeners sit on the window but act only while the pointer is over this view (as the card's own view keys do), and
  // a key that starts in a control that Space activates is that control's.
  let hovered = false, spaceDown = false;
  const setSpace = (on: boolean) => { spaceDown = on; canvas.style.cursor = on ? "grab" : ""; };
  const isSpace = (e: KeyboardEvent) => e.code === "Space" || e.key === " " || e.key === "Spacebar";
  const takesSpace = (t: EventTarget | undefined) => t instanceof Element && !!t.closest('button,input,select,textarea,summary,a,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="tab"],[role="option"]');
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isSpace(e) || !hovered || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.isComposing || takesSpace(e.composedPath()[0])) return;
    e.preventDefault(); // the page would scroll
    if (!spaceDown) setSpace(true);
  };
  const onKeyUp = (e: KeyboardEvent) => { if (isSpace(e) && spaceDown) setSpace(false); };
  const onBlur = () => { if (spaceDown) setSpace(false); };
  const onEnter = () => { hovered = true; };
  const onLeave = () => { hovered = false; };
  // A cancelled pointerdown (below) stops the compatibility mousedown, which is what starts the browser's autoscroll (a test holds this); the middle click is let through only here.
  const noMiddle = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
  const onDown = (e: PointerEvent) => {
    if (e.button === 1) e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: nothing to capture */ }
    container.dataset.dragged = "false";
    if (pointers.size === 1) { dragged = false; start = { x: e.clientX, y: e.clientY }; panning = e.button === 1 || e.button === 2 || e.shiftKey || spaceDown; }
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
      opts.onCamera?.();
    } else if (pointers.size === 2) {
      const t = twoFingers();
      if (pinch > 0 && t.d > 0) orbit.zoom(pinch / t.d);
      orbit.pan(t.m.x - mid.x, t.m.y - mid.y, size().h);
      pinch = t.d; mid = t.m;
      opts.onCamera?.();
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
    opts.onCamera?.();
    want();
  };
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", noMenu);
  canvas.addEventListener("auxclick", noMiddle);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("keyup", onKeyUp);
  globalThis.addEventListener("blur", onBlur);

  // A lost context may come back (a driver reset, a tab returning to the front): preventDefault allows the restore, and three.js
  // builds its own state again when it comes. The view waits for it a moment; if it does not come, the card falls back to 2D
  // and tries 3D once more the next time the tab is shown or the card is attached.
  const onLost = (e: Event) => {
    e.preventDefault();
    if (disposed || lost) return;
    lost = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    restoreTimer = setTimeout(() => { restoreTimer = null; if (lost) fail(CONTEXT_LOST, true); }, RESTORE_MS);
  };
  const onRestored = () => {
    if (disposed || !lost) return;
    lost = false;
    if (restoreTimer !== null) { clearTimeout(restoreTimer); restoreTimer = null; }
    freeKeepers();
    resize(); // sets the size again and asks for a frame
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  // ---- the meshes: one per colour, all the solids of that colour merged, so thousands of pieces are a handful of draw calls.
  const palette = new Map<string, { colour: Color; opacity: number }>();
  // S28.9: the theme's --fp-paint-dim (a dark theme dims user paint, as the 2D plan does); read once per palette.
  let paintDim: PaintDim | null | undefined;
  const dimOf = () => (paintDim === undefined ? (paintDim = parsePaintDim(getComputedStyle(probe).getPropertyValue("--fp-paint-dim"))) : paintDim);
  const dimTile = (css: string) => { const c = new Color(css), d = dimOf(); if (d) c.multiplyScalar(Math.min(1, d.brightness)); return c; }; // a linear scale is close enough for a stand-in colour
  const dimGrey = () => { const d = dimOf(), v = d ? Math.round(255 * Math.min(1, d.brightness)) : 255; return (v << 16) | (v << 8) | v; };
  const paintOf = (role: string, color: string | undefined) => {
    const key = `${role}|${color ?? ""}`;
    let p = palette.get(key);
    if (!p) {
      const s = roleStyle(role), own = color !== undefined ? resolveColour(probe, color) : null, c = own ?? resolveColour(probe, s.css) ?? 0x888888;
      const d = own !== null ? dimOf() : null;
      const rgb = d ? dimRgb([(c >> 16) & 255, (c >> 8) & 255, c & 255], d).map(Math.round) : null;
      p = { colour: new Color(rgb ? `#${hex((rgb[0] << 16) | (rgb[1] << 8) | rgb[2])}` : `#${hex(c)}`), opacity: s.opacity };
      palette.set(key, p);
    }
    return p;
  };
  // S22.F1: three destroys a shader program when the last material that used it is disposed, so a floor switch, which disposes
  // every material of the old floor before the new one is drawn, compiled all its programs again: about 0.7 s a switch in the
  // tests' software GL, a stall on a wall tablet too. The first material to give up a program is kept, unused, for the life of
  // the view, so the program stays and the next floor or theme finds it. One per program: a handful, and no buffers or maps.
  const keepers = new Map<object, Material>();
  const retire = (m: Material) => {
    const prog = (renderer.properties.get(m) as { currentProgram?: object }).currentProgram; // three's own record of the material
    if (prog && !keepers.has(prog)) keepers.set(prog, m); else m.dispose();
  };
  /** A restored context starts a new program cache, and the view's end ends it: the kept materials go. */
  function freeKeepers() { for (const m of keepers.values()) m.dispose(); keepers.clear(); }
  const dropMat = (m: MeshLambertMaterial) => { m.map?.dispose(); retire(m); };
  const dispose = (list: Mesh[]) => { for (const m of list) { scene.remove(m); m.geometry.dispose(); dropMat(m.material as MeshLambertMaterial); if ((m as InstancedMesh).isInstancedMesh) (m as InstancedMesh).dispose(); } };
  /** S28.7: the crowns of the trees in `solids`, one InstancedMesh, in the tree role's colour; null when there is none. */
  const crownsOf = (solids: Plan3D["solids"]): InstancedMesh | null => {
    const p = paintOf("tree-crown", undefined), m = crownMesh(solids, new MeshLambertMaterial({ color: p.colour, flatShading: true }));
    if (m) scene.add(m);
    return m;
  };
  /** One mesh per colour from the solids `pick` accepts, drawn over the z range `zOf` gives (null: left out). A solid with a floor texture gives its top face to a mesh of its own, with UVs in plan cm (tex.ts); its other faces stay the flat colour. */
  const meshesOf = (pick: (s: Plan3D["solids"][number]) => boolean, zOf: (s: Plan3D["solids"][number]) => [number, number] | null, from: Plan3D["solids"] = plan?.solids ?? [], textured = true): Mesh[] => {
    const groups = new Map<string, { tris: Triangles; colour: Color; opacity: number; tile?: TextureTile; uv: number[] }>();
    const group = (key: string, colour: Color, opacity: number, tile?: TextureTile) => { let g = groups.get(key); if (!g) groups.set(key, (g = { tris: { position: [], normal: [] }, colour, opacity, tile, uv: [] })); return g; };
    for (const s of from) {
      if (s.shape.type !== "prism" || !pick(s)) continue; // a point (a device with no body of its own) is a ball, below
      const z = zOf(s);
      if (!z) continue;
      const p = paintOf(s.paint.role, s.paint.color), flat = group(`${p.colour.getHexString()}|${p.opacity}`, p.colour, p.opacity);
      const tile = textured && s.paint.texture !== undefined ? opts.deps.texture(s.paint.texture, s.paint.textureRot, s.paint.textureScale) : null;
      if (!tile) { prismTriangles(s.shape.base, z[0], z[1], flat.tris); continue; }
      const all: Triangles = { position: [], normal: [] };
      prismTriangles(s.shape.base, z[0], z[1], all);
      const top = group(`tex|${textureKey(tile)}|${tile.rot}`, dimTile(tile.preview), 1, tile);
      for (let t = 0; t < all.position.length; t += 9) {
        const to = all.normal[t + 1] > 0.5 ? top : flat; // the cap that faces up wears the texture
        to.tris.position.push(...all.position.slice(t, t + 9));
        to.tris.normal.push(...all.normal.slice(t, t + 9));
        if (to === top) for (let v = 0; v < 9; v += 3) to.uv.push(...uvOf(tile, all.position[t + v], all.position[t + v + 2]));
      }
    }
    const out: Mesh[] = [];
    for (const g of groups.values()) {
      if (!g.tris.position.length) continue;
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(g.tris.position), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(g.tris.normal), 3));
      geo.setAttribute("color", new BufferAttribute(new Float32Array(g.tris.position.length).fill(1), 3)); // white: a lit room multiplies it (paintLifts)
      if (g.tile) geo.setAttribute("uv", new BufferAttribute(new Float32Array(g.uv), 2));
      geo.computeBoundingSphere();
      const glass = g.opacity < 1, mat = new MeshLambertMaterial({ color: g.colour, vertexColors: true, transparent: glass, opacity: g.opacity, depthWrite: !glass, ...(glass ? { side: DoubleSide } : {}) }); // `side: undefined` makes three warn
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = glass ? 1 : 0;
      scene.add(mesh);
      out.push(mesh);
      if (g.tile) texMeshes.push({ mesh, mat, tile: g.tile });
    }
    return out;
  };
  /** Lays the texture on every textured mesh whose raster is ready (white under it: the map is the colour); the others keep the texture's flat colour until their raster arrives. */
  function applyTextures() {
    for (const t of texMeshes) {
      if (t.mat.map) continue;
      const map = rasters.texture(t.tile, renderer);
      if (!map) continue;
      t.mat.map = map;
      t.mat.color.set(dimGrey()); // white, or the dark theme's brightness: the map is the colour (saturate is not applied to a raster)
      t.mat.needsUpdate = true;
    }
  }
  const isPiece = (s: Solid) => s.kind === "furniture" && !!s.ref.entity;
  const isWall = (s: Solid) => s.kind === "wall" || s.kind === "opening";
  /** A door's leaf, a window's pane and an open doorway's alert band are parts of their own (they swing, vanish or appear with the state); a sealed panel stays in the wall. */
  const isPart = (s: Solid) => s.kind === "opening" && (s.tag === "door-leaf" || s.tag === "glass" || s.tag === "band");
  const drop = (m: Mesh) => { scene.remove(m); m.geometry.dispose(); dropMat(m.material as MeshLambertMaterial); };
  /**
   * S28.8: one mesh of a floor's contact shadows, or null when the floor casts none. The shade MULTIPLIES what lies under it by
   * 1 - strength * vertexAlpha * (1 - shade colour), so it darkens on every theme, a dark one included (a plain alpha blend of
   * `--fp-shade`, a near-black, lightens a floor darker than it). The mix is done in sRGB, the space the multiply happens in.
   * `strength` is `--fp-shade-alpha` (times the ghost factor of a ghosted floor). Never picked, no depth write, unlit.
   */
  const shadeOf = (solids: Plan3D["solids"], factor: number): Mesh | null => {
    const sh = contactShadows(solids);
    if (!sh.alpha.length) return null;
    const raw = Number.parseFloat(getComputedStyle(probe).getPropertyValue("--fp-shade-alpha")), strength = (Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.2) * factor;
    const c = paintOf("shade", undefined).colour.clone().convertLinearToSRGB(), n = sh.alpha.length, rgb = new Float32Array(n * 3);
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < n; i++) {
      const k = strength * sh.alpha[i]!;
      rgb[i * 3] = lin(1 - k * (1 - c.r)); rgb[i * 3 + 1] = lin(1 - k * (1 - c.g)); rgb[i * 3 + 2] = lin(1 - k * (1 - c.b));
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(sh.position, 3));
    g.setAttribute("color", new BufferAttribute(rgb, 3));
    const mat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: MultiplyBlending, premultipliedAlpha: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.forceSinglePass = true; // a double-sided transparent material is drawn twice otherwise; the shade is one flat sheet
    const m = new Mesh(g, mat);
    m.name = "shade"; m.renderOrder = 1; m.raycast = () => undefined; m.visible = shadeOn; m.userData.strength = strength;
    scene.add(m);
    return m;
  };
  /** S28.8: the ground under the house: 1.5 times the box of everything drawn, at the lowest slab bottom (the floors below's included), in the `ground` role. Never picked. */
  const buildGround = () => {
    dispose(ground ? [ground] : []); ground = null;
    if (!plan) return;
    let low = belowLow;
    for (const s of plan.solids) if (s.kind === "floor" && s.shape.type === "prism") low = Math.min(low, s.shape.z0);
    const b = plan.bounds, box = groundBox({ min: [Math.min(b.min[0], belowBox?.min[0] ?? Infinity), Math.min(b.min[1], belowBox?.min[1] ?? Infinity)], max: [Math.max(b.max[0], belowBox?.max[0] ?? -Infinity), Math.max(b.max[1], belowBox?.max[1] ?? -Infinity)] });
    if (!box || !Number.isFinite(low)) return;
    const g = new PlaneGeometry(box.x1 - box.x0, box.y1 - box.y0);
    g.rotateX(-Math.PI / 2); // flat, facing up; plan y runs towards three's +z
    g.translate((box.x0 + box.x1) / 2, low, (box.y0 + box.y1) / 2);
    const m = new Mesh(g, new MeshLambertMaterial({ color: paintOf("ground", undefined).colour }));
    m.name = "ground"; m.raycast = () => undefined; m.visible = shadeOn;
    scene.add(m);
    ground = m;
  };
  const clear = () => {
    dispose(meshes); dispose(wallMeshes); dispose(crowns); dispose(shades); dispose(ground ? [ground] : []); meshes = []; wallMeshes = []; crowns = []; shades = []; ground = null; texMeshes = [];
    wallSides = []; glowSpecs = []; deviceZ = new Map();
    for (const x of parts) drop(x.mesh);
    for (const b of devBodies) { drop(b.mesh); b.lit.forEach(drop); }
    for (const b of pieceBodies) drop(b.mesh);
    parts = []; devBodies = []; pieceBodies = []; ballIdx = []; ballRest = [];
    rings.dispose(retire);
    roomShapes = []; roomSolid.clear();
    if (ring) { scene.remove(ring); ring.geometry.dispose(); retire(ring.material as LineDashedMaterial); ring = null; }
    if (markers) { scene.remove(markers); markers.geometry.dispose(); retire(markers.material as MeshLambertMaterial); markers.dispose(); markers = null; }
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
    wallSides = [];
    for (const x of plan?.solids ?? []) {
      if (x.kind !== "wall" || x.shape.type !== "prism") continue;
      const z = wallZ(x, lowered, CUT_WALL_HEIGHT), b = x.shape.base;
      if (!z) continue;
      const w = outwardSign(b);
      b.forEach((a, i) => wallSides.push({ a, b: b[(i + 1) % b.length], s: w, z0: z[0], z1: z[1] }));
    }
    sidesVersion++;
    glow.set(glowSpecs, wallSides, sidesVersion, roomShapes);
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
      parts.push({ index: s.ref.index, tag: s.tag, mesh, mat, rest: p.colour, shut: s.paint.role === "glass-glass" });
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
  function buildPieces() {
    for (const s of plan?.solids ?? []) {
      if (!isPiece(s) || s.shape.type !== "prism" || typeof s.ref.index !== "number") continue;
      const tris: Triangles = { position: [], normal: [] };
      prismTriangles(s.shape.base, s.shape.z0, s.shape.z1, tris);
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(new Float32Array(tris.position), 3));
      geo.setAttribute("normal", new BufferAttribute(new Float32Array(tris.normal), 3));
      const p = paintOf(s.paint.role, s.paint.color), mat = new MeshLambertMaterial({ color: p.colour }), mesh = new Mesh(geo, mat);
      scene.add(mesh);
      pieceBodies.push({ index: s.ref.index, mesh, mat, rest: p.colour, on: false });
    }
  }
  function applyPieces() {
    const L = liveNow ?? EMPTY, on = paintOf("piece-on", undefined).colour;
    for (const b of pieceBodies) {
      b.on = !!L.pieces[b.index]?.on;
      b.mat.color.copy(b.on ? on : b.rest);
    }
  }
  function applyDoors() {
    const L = liveNow ?? EMPTY, open = paintOf("open-door", undefined).colour, cover = paintOf("door-cover", undefined).colour;
    for (const x of parts) {
      const d = L.doors[x.index] ?? null, swing = !!d && (d.open || d.cover), alert = !!d && (d.open || d.alarm || d.cover);
      if (x.tag === "door-leaf") x.mesh.rotation.y = swing ? -SWING : 0;
      // S25.D1: a door and a glass door (not a window) are there only while a sensor says closed; an alert (open, alarmed, cover open) keeps a door's leaf, in red.
      x.mesh.visible = x.tag === "door-leaf" ? !!d && (d.closed || alert) : x.tag === "band" ? alert : x.shut ? !!d && d.closed : !(d && d.open);
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
    const lit = L.lights.map((l) => ({ room: l.room, at: l.at, rgb: rgbOf(l.rgb), level: l.level, device: l.device, scale: l.scale ?? 1 }));
    lifts = roomLifts(lit, mode.boost);
    const key = JSON.stringify([...lifts]);
    if (key !== liftKey) { liftKey = key; for (const m of meshes) paintLifts(m); for (const m of wallMeshes) paintLifts(m); }
    const b = plan?.bounds, centre: [number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0];
    const here = lit.filter((l) => roomSolid.has(l.room));
    pools.set(pickLights(here, centre, MAX_POOLS).map((l) => { const r = roomSolid.get(l.room)!; return { at: l.at, z: r.z, base: r.base, rgb: l.rgb, level: l.level, room: l.room, boost: mode.boost, scale: l.scale }; }));
    container.dataset.pools = `${pools.visible()}/${here.length}`;
    // The same lamps light the walls of their rooms: a lamp's own height is its icon's (held under the walls), else a standing lamp's.
    // S23.8: the theme kind is the one the 2D glow blends by (`--fp-glow-blend`, ink.ts themeExtras): multiply means a light theme.
    const light = getComputedStyle(probe).getPropertyValue("--fp-glow-blend").trim() === "multiply";
    glowSpecs = pickLights(here, centre, MAX_POOLS).map((l) => { const r = roomSolid.get(l.room)!; return { at: l.at, lampZ: deviceZ.get(l.device) ?? r.z + 200, base: r.base, rgb: l.rgb, level: l.level, room: l.room, boost: mode.boost, scale: l.scale, light }; });
    glow.set(glowSpecs, wallSides, sidesVersion, roomShapes);
    overlay.set(L, anchors);
    applyBalls();
    applyBodies();
    applyPieces();
    applyDoors();
    pulsing = applyRings();
    want();
  }
  /** The top of the highest wall of the floor drawn (plan z, the floor's lift included); 0 when it has none. */
  const wallTop = () => (plan?.solids ?? []).reduce((m, s) => (s.kind === "wall" && s.shape.type === "prism" ? Math.max(m, s.shape.z1) : m), 0);
  const anchorsOf = (): Anchors => {
    const devices = new Map<number, [number, number, number]>(), roomsA = new Map<number, [number, number, number]>();
    // A point is held under the walls by the scene itself; a body's icon (its top plus 6) is held here, by the same margin.
    const top = wallTop(), cap = top > 0 ? Math.max(0, top - ICON_MARGIN) : Infinity;
    for (const s of plan?.solids ?? []) {
      if (s.kind === "device" && !s.ref.hidden && typeof s.ref.index === "number") {
        if (s.shape.type === "point") devices.set(s.ref.index, [s.shape.at[0], s.shape.z, s.shape.at[1]]);
        else { const b = s.shape.base; devices.set(s.ref.index, [b.reduce((a, q) => a + q[0], 0) / b.length, Math.min(s.shape.z1 + 6, Math.max(cap, s.shape.z0)), b.reduce((a, q) => a + q[1], 0) / b.length]); }
      }
    }
    for (const [r, rs] of roomSolid) roomsA.set(r, [0, rs.z + 2, 0]);
    return { devices, rooms: roomsA };
  };

  // ---- the floors below (S27.7): meshes of their own, outside `clear` and `build`, so the current floor's rebuilds do not touch them.
  const BELOW_MAX = 32;
  let belowMeshes: Mesh[] = [], belowCrowns: Mesh[] = [], belowArgs: { floors: unknown[]; mode: "ghost" | "solid" } | null = null;
  /** The scene of a floor below, kept while the floor object, its elevation and its shift stay: a theme change or a repeat call does not build it again. */
  const belowPlans = new WeakMap<object, Map<string, Plan3D>>();
  const belowPlan = (floor: object, elevation: number, shift: unknown): Plan3D => {
    const key = `${elevation}|${JSON.stringify(shift)}`;
    let byKey = belowPlans.get(floor);
    if (!byKey) belowPlans.set(floor, (byKey = new Map()));
    let p = byKey.get(key);
    if (!p) byKey.set(key, (p = buildScene(floor as never, { elevation, shift: shift as never })));
    return p;
  };
  const buildBelow = () => {
    dispose(belowMeshes); dispose(belowCrowns); dispose(belowShades); belowMeshes = []; belowCrowns = []; belowShades = []; belowLow = Infinity; belowBox = null;
    if (!belowArgs) { buildGround(); return; }
    const ghost = belowArgs.mode === "ghost";
    for (const e of belowArgs.floors) {
      const f = (e as { floor?: unknown } | null)?.floor, elevation = (e as { elevation?: unknown } | null)?.elevation;
      if (typeof f !== "object" || f === null || typeof elevation !== "number" || !Number.isFinite(elevation)) continue;
      try {
        const sc = belowPlan(f, elevation, (e as { shift?: unknown }).shift);
        const made = meshesOf((x) => x.kind !== "device", (x) => (x.shape.type === "prism" ? [x.shape.z0, x.shape.z1] : null), sc.solids, false);
        for (const m of made) {
          const mat = m.material as MeshLambertMaterial;
          if (ghost) { mat.transparent = true; mat.opacity = Math.min(mat.opacity, GHOST_OPACITY); mat.depthWrite = false; mat.side = DoubleSide; m.renderOrder = 1; }
          m.raycast = () => undefined; // never picked
        }
        belowMeshes.push(...made);
        for (const x of sc.solids) if (x.kind === "floor" && x.shape.type === "prism") belowLow = Math.min(belowLow, x.shape.z0);
        const had = belowBox as { min: number[]; max: number[] } | null;
        belowBox = { min: [Math.min(had?.min[0] ?? Infinity, sc.bounds.min[0]), Math.min(had?.min[1] ?? Infinity, sc.bounds.min[1])], max: [Math.max(had?.max[0] ?? -Infinity, sc.bounds.max[0]), Math.max(had?.max[1] ?? -Infinity, sc.bounds.max[1])] };
        const dark = shadeOf(sc.solids, ghost ? GHOST_OPACITY : 1);
        if (dark) belowShades.push(dark);
        const tops = crownsOf(sc.solids); // the trees of a floor below keep their crowns, as the floor keeps its walls
        if (tops) {
          if (ghost) { const mat = tops.material as MeshLambertMaterial; mat.transparent = true; mat.opacity = GHOST_OPACITY; mat.depthWrite = false; mat.side = DoubleSide; tops.renderOrder = 1; }
          belowCrowns.push(tops);
        }
      } catch (err) { debugOnce("3D view: a floor below could not be built; the others stay", err); }
    }
    buildGround();
  };

  const build = () => {
    clear();
    builds++;
    if (!plan) { anchors = { devices: new Map(), rooms: new Map() }; applyLive(); return; }
    meshes = meshesOf((s) => !isWall(s) && s.kind !== "device" && !isPiece(s), (s) => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : null));
    applyTextures();
    const own = crownsOf(plan.solids);
    if (own) crowns = [own];
    const dark = shadeOf(plan.solids, 1);
    if (dark) shades = [dark];
    buildGround();
    // Rooms by index: where lamps and edges go, and which room a vertex belongs to.
    for (const s of plan.solids) {
      if (s.kind === "room" && s.tag !== "fill" && s.shape.type === "prism" && typeof s.ref.room === "number") {
        const base = s.shape.base, area = Math.abs(base.reduce((a, q, i) => { const n = base[(i + 1) % base.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
        roomSolid.set(s.ref.room, { base, z: s.shape.z1 });
        roomShapes.push({ index: s.ref.room, base, top: s.shape.z1, area });
      }
    }
    for (const s of plan.solids) if (s.kind === "device" && s.shape.type === "point" && typeof s.ref.index === "number") deviceZ.set(s.ref.index, s.shape.z);
    lifts = new Map(); liftKey = "";
    bodies = wallBodies(plan.solids);
    lowered = new Set();
    buildMarkers();
    buildBodies();
    buildPieces();
    anchors = anchorsOf();
    picker = new Picker(plan.solids);
    buildWalls();
    buildRing();
    applyLive();
  };

  resize();
  const api: View3D = {
    setFloor(floor, around) {
      try { plan = buildScene(floor as never, { around: around as never }); } catch (e) { debugOnce("3D view: the floor could not be built", e); plan = null; }
      clear(); // the old floor's meshes go now, before the new ones are made
      const bounds = plan?.bounds ?? { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] };
      if (framed) orbit.reframe(bounds); // the same way of looking, at the new floor
      else {
        const { w, h } = size();
        orbit = new Orbit(bounds, w / h, FOV, opts.turnDeg);
        orbit.setInset(inset[0], inset[1]); // a new floor keeps the room the list takes
        framed = true;
      }
      if (!orbit.finite) { fail("it could not start"); return; } // numbers no camera can frame: say so, do not draw a blank
      build();
      want();
    },
    setBelow(floors, mode) {
      if (disposed) return;
      const m = mode === "ghost" || mode === "solid" ? mode : null;
      belowArgs = m && Array.isArray(floors) ? { floors: floors.slice(0, BELOW_MAX), mode: m } : null;
      buildBelow();
      want();
    },
    setTheme(key) {
      if (key === themeKey) return;
      themeKey = key;
      palette.clear();
      paintDim = undefined;
      build();
      buildBelow();
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
      try { l = liveOf(floor as never, o, now); } catch (e) { debugOnce("3D view: the live state could not be worked out", e); l = null; } // liveOf never throws; a layout is untrusted all the same
      // A steady edge (reduced motion) has no use for the age of a pulse, which changes with every render and would redraw for nothing.
      const sig = l ? JSON.stringify(reduced() ? { ...l, rooms: l.rooms.map((r) => (r && r.motion ? { ...r, motion: { ...r.motion, pulseAge: null } } : r)) } : l) : "";
      if (sig === liveSig) return; // nothing changed: no work and no frame
      liveSig = sig;
      liveNow = l ?? null;
      pulseStart = performance.now();
      try { applyLive(); } catch (e) { debugOnce("3D view: the live state could not be drawn; the last one stays on screen", e); }
    },
    reset() { orbit.reset(); want(); },
    camera: () => orbit.state(),
    setCamera(c) { orbit.restore(c); want(); },
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
      canvas.removeEventListener("auxclick", noMiddle);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", onBlur);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      clear(); // the ring too
      dispose(belowMeshes); dispose(belowCrowns); dispose(belowShades); belowMeshes = []; belowCrowns = []; belowShades = []; belowArgs = null;
      freeKeepers();
      pools.dispose();
      glow.dispose();
      rasters.dispose();
      overlay.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      probe.remove();
      for (const k of ["az", "polar", "dist", "target", "drawn", "dragged", "lowered", "inset", "ring", "pools"]) delete container.dataset[k];
      if (__FP3D_TEST__ && testHook) { const at = hooks.indexOf(testHook); if (at >= 0) hooks.splice(at, 1); publishHook(); }
      live--;
    },
  };
  // A hook for the tests, compiled in only when the build sets `__FP3D_TEST__` (the Playwright test build): where a point of the plan lies
  // on the screen, so a test can drive a real mouse at it, and what a point of the screen would pick.
  let testHook: object | null = null;
  if (__FP3D_TEST__) {
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
      setBelow: (floors: unknown, mode: string) => api.setBelow(floors, mode),
      /** The floors below as drawn: one entry per mesh, its material and its box in plan terms [x0, y0, z0, x1, y1, z1]. */
      below() {
        return {
          count: belowMeshes.length,
          meshes: belowMeshes.map((m) => {
            const mat = m.material as MeshLambertMaterial, g = m.geometry;
            if (!g.boundingBox) g.computeBoundingBox();
            const b = g.boundingBox!;
            return { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite, box: [b.min.x, b.min.z, b.min.y, b.max.x, b.max.z, b.max.y] };
          }),
        };
      },
      /** S28.7: the crown meshes as drawn (this floor's and the floors below's), each with its instance count, its box in plan terms [x0, y0, z0, x1, y1, z1] over all its instances, and its material. `inScene` counts the ones the scene holds: a floor switch must not leave one behind. */
      crowns() {
        const one = (m: Mesh) => {
          const im = m as InstancedMesh, g = m.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const b = g.boundingBox!, at = new Matrix4(), v = new Vector3(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, at);
            for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
              v.set(x, y, z).applyMatrix4(at);
              lo[0] = Math.min(lo[0], v.x); hi[0] = Math.max(hi[0], v.x); lo[1] = Math.min(lo[1], v.z); hi[1] = Math.max(hi[1], v.z); lo[2] = Math.min(lo[2], v.y); hi[2] = Math.max(hi[2], v.y);
            }
          }
          const mat = m.material as MeshLambertMaterial;
          return { count: im.count, box: [...lo, ...hi], transparent: mat.transparent, opacity: mat.opacity, faces: g.getAttribute("position").count / 3 };
        };
        return { own: crowns.map(one), below: belowCrowns.map(one), inScene: scene.children.filter((c) => c.name === "crowns").length };
      },
      /** S28.8: the ground and the shadows as drawn, and the draw calls of one frame (`shadeVisible(false)` hides both, to compare). The numbers are plan terms. */
      shade() {
        const one = (m: Mesh) => { const g = m.geometry, mat = m.material as MeshLambertMaterial; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox!; return { verts: g.getAttribute("position").count, opacity: (m.userData.strength as number | undefined) ?? mat.opacity, depthWrite: mat.depthWrite, transparent: mat.transparent, box: [b.min.x, b.min.z, b.min.y, b.max.x, b.max.z, b.max.y], colour: hexOf(mat.color) }; };
        return { ground: ground ? one(ground) : null, own: shades.map(one), below: belowShades.map(one), inScene: scene.children.filter((c) => c.name === "shade").length, grounds: scene.children.filter((c) => c.name === "ground").length };
      },
      shadeVisible(on: boolean) { shadeOn = !!on; for (const m of [...shades, ...belowShades, ...(ground ? [ground] : [])]) m.visible = shadeOn; want(); },
      /** Draws one frame now and returns how many draw calls it took. */
      calls() { prepare(); renderer.render(scene, camera); return renderer.info.render.calls; },
      /** Gives the view a floor directly, as `setFloor` does: what the card's own check (validate) would have refused reaches the view this way. */
      setFloor: (floor: unknown) => api.setFloor(floor),
      muteGlow: (on: boolean) => { glow.mute(on); want(); },
      /** Where each device's icon is anchored, as its height above the floor's slab top (cm). */
      anchors: () => [...anchors.devices].map(([index, a]) => ({ index, type: plan?.solids.find((x) => x.kind === "device" && x.ref.index === index)?.tag ?? "", z: a[1] })),
      /** Points the camera (az: 0 is south of the house, positive turns east; polar: 0 straight down). */
      look(az: number, polar: number) { orbit.azimuth = az; orbit.polar = Math.max(0.1, Math.min(1.45, polar)); want(); },
      /** The height range of everything drawn (cm, plan z): what the one-floor test reads. */
      floors() {
        let y0 = Infinity, y1 = -Infinity;
        for (const m of [...meshes, ...wallMeshes, ...belowMeshes, ...parts.map((x) => x.mesh), ...devBodies.map((x) => x.mesh), ...pieceBodies.map((x) => x.mesh)]) { const b = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox!); y0 = Math.min(y0, b.min.y + m.position.y); y1 = Math.max(y1, b.max.y + m.position.y); }
        return { extent: { y0, y1 } };
      },
      /** three's own count of what the graphics card holds: 21 floor switches must leave it where 2 did. */
      memory: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      /** The ids of the shader programs alive now. three numbers each program it compiles, so a switch that compiled again shows new ids (S22.F1). */
      programs: () => (renderer.info.programs ?? []).map((p) => p.id).sort((a, b) => a - b),
      /** The meshes that wear a floor texture: what the tile is, whether its map has arrived, and the UVs of the first three vertices (with the plan position they belong to). */
      textured() {
        return texMeshes.map(({ mesh, mat, tile }) => {
          const pos = mesh.geometry.getAttribute("position"), uv = mesh.geometry.getAttribute("uv"), m = mat.map;
          return {
            id: tile.id, rot: tile.rot, scale: tile.scale, tileCm: [tile.w * tile.scale, tile.h * tile.scale], hasMap: !!m, wrap: [m?.wrapS ?? 0, m?.wrapT ?? 0], srgb: m?.colorSpace === "srgb", anisotropy: m?.anisotropy ?? 0, verts: pos.count,
            first: [0, 1, 2].map((i) => ({ x: pos.getX(i), y: pos.getZ(i), u: uv.getX(i), v: uv.getY(i) })),
          };
        });
      },
      /** What the live state did to the scene: for the tests, which read the pixels too. */
      live() {
        const body = (b: (typeof devBodies)[number]) => ({ index: b.index, type: b.type, colour: hexOf(b.mat.color), emissive: b.on && b.lit[0] ? hexOf((b.lit[0].material as MeshBasicMaterial).color) : "#000000" });
        const c = new Color();
        return {
          builds, children: scene.children.length, pulsing,
          doors: parts.map((x) => ({ index: x.index, tag: x.tag, visible: x.mesh.visible, rot: x.mesh.rotation.y || 0, colour: hexOf(x.mat.color) })),
          bodies: devBodies.map(body),
          pieces: pieceBodies.map((b) => ({ index: b.index, on: b.on, colour: hexOf(b.mat.color) })),
          balls: ballIdx.map((di, k) => { markers?.getColorAt(k, c); return { index: di, colour: hexOf(c), shown: true }; }),
          pools: pools.info(),
          glow: glow.info(),
          lifted: [...lifts.keys()].sort((a, b) => a - b),
          rings: rings.info([...roomSolid.keys()]),
        };
      },
    };
    hooks.push(testHook);
    publishHook();
  }
  return api;
}


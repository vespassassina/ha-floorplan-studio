/** The card's view memory and rotation, as pure maths and parsing. No DOM, no storage handle: the card reads and
 * writes `localStorage` itself and hands the raw string here. */
import { DETAIL_MODES, WALLS_MODES, clampTilt, parseLayers, type DetailMode, type LayerId } from "../core";
import { MAX_ZOOM, MIN_ZOOM, type Pt, type View } from "./viewport";

/** A user turn is a multiple of this many degrees. */
export const ROTATION_STEP = 45;

/** A rotation from config or storage, untrusted: a finite number rounded to the nearest step and wrapped to
 * 0..315. Anything else (a string, NaN, null) is 0, the unturned plan. */
export function normaliseRotation(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const deg = Math.round(v / ROTATION_STEP) * ROTATION_STEP;
  return ((deg % 360) + 360) % 360;
}

/** The signed turn from `from` to `to` that is no longer than half a circle: 315 to 0 is +45, not -315. */
export function shortestDelta(from: number, to: number): number {
  const d = (((to - from) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Slow at both ends, quick in the middle (cubic ease-in-out). `t` outside 0..1 is held at the end. */
export function easeInOut(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The box of zoom `zoom` (1 is `fit`) centred on `centre`, in fit's own aspect ratio. */
export function viewAround(centre: Pt, zoom: number, fit: View): View {
  const w = fit.w / zoom, h = fit.h / zoom;
  return { x: centre[0] - w / 2, y: centre[1] - h / 2, w, h };
}

/** The 3D camera of one floor. `zoom` is the distance as a multiple of the one that frames the floor (so it still
 * means something when the view gets another size or a panel opens); `dx` and `dz` are how far the look-at point sits
 * from the floor's centre, in cm. Orbit.restore clamps every number against the real camera, this only bounds them. */
export interface StoredCam {
  az: number;
  polar: number;
  zoom: number;
  dx: number;
  dz: number;
}

/** What a viewer left a floor looking like: the 2D zoom and the spot, the turn, the 3D camera. Every field is
 * optional; a floor with nothing to say has no entry. `focus` is in plan cm (the layout's own coordinates, before any
 * rotation), so a stored view means the same spot at any angle. */
export interface FloorView {
  zoom?: number;
  focus?: Pt;
  rotation?: number;
  cam?: StoredCam;
}

/** What a card remembers. Every field is optional: a field that is there overrides the card's config, one that is
 * missing leaves the config in charge. `floors` is per floor (S14.4): a list of [floor key, view], not an object, so a
 * floor named `__proto__` is just a string. `view` is a plain string so a view added later needs no new storage format. */
export interface StoredView {
  floors?: [string, FloorView][];
  view?: string;
  tilt?: number;
  /** One of `WALLS_MODES`, kept as a string like `view`. */
  walls?: string;
  theme?: string;
  labels?: boolean;
  /** Every device's name on the plan, the studio's Names toggle. */
  names?: boolean;
  /** The floor the person switched to (a key of the layout's `floors`); the card ignores one it does not have. */
  floor?: string;
  /** The families this viewer hid with the layer chips (S24.8); missing or empty draws everything. */
  layers?: LayerId[];
  /** The detail mode this viewer picked (S25.8); it wins over the card's YAML `detail`. */
  detail?: DetailMode;
}

/** Further than this from the origin is not a plan in cm; the bound keeps later arithmetic finite. */
const FOCUS_LIMIT = 1e6;
/** More floors than this is not a house. */
const MAX_FLOORS = 50;
/** The 3D camera's distance range as a multiple of the framing distance (orbit.ts has the same two numbers). */
export const CAM_ZOOM_MIN = 0.15, CAM_ZOOM_MAX = 4;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const bound = (n: number) => Math.min(FOCUS_LIMIT, Math.max(-FOCUS_LIMIT, n));
const validKey = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= 200;

/** One floor's entry, untrusted: each field stands or falls alone, zoom and focus as a pair. `null` when nothing is left. */
function parseFloorView(raw: unknown): FloorView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: FloorView = {};
  const f = r.focus;
  if (isNum(r.zoom) && Array.isArray(f) && f.length === 2 && isNum(f[0]) && isNum(f[1])) {
    out.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, r.zoom));
    out.focus = [bound(f[0]), bound(f[1])];
  }
  if (isNum(r.rotation)) out.rotation = normaliseRotation(r.rotation);
  const c = r.cam as Record<string, unknown> | null | undefined;
  if (c && typeof c === "object" && isNum(c.az) && isNum(c.polar) && isNum(c.zoom) && isNum(c.dx) && isNum(c.dz)) {
    out.cam = { az: Math.min(1e4, Math.max(-1e4, c.az)), polar: c.polar, zoom: Math.min(CAM_ZOOM_MAX, Math.max(CAM_ZOOM_MIN, c.zoom)), dx: bound(c.dx), dz: bound(c.dz) };
  }
  return Object.keys(out).length ? out : null;
}

/** Reads a stored entry (the JSON string, or an object already parsed) into a `StoredView`. Storage is untrusted:
 * a field that fails its check is dropped on its own, the good ones stay, and nothing here throws. `isView` and
 * `themes` come from the card, which owns what it can show. The focus is only bounded here; the card clamps the box
 * built from it against the plan. An entry from before S14.4 kept one zoom, focus and turn for the whole card: they
 * move to the floor the entry names (and are dropped when it names none, since the card then could not say whose they were). */
export function parseStoredView(raw: unknown, isView: (v: unknown) => boolean, themes: readonly string[]): StoredView {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return {}; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  const out: StoredView = {};
  if (Array.isArray(r.floors)) {
    const floors: [string, FloorView][] = [];
    for (const e of r.floors) {
      if (floors.length >= MAX_FLOORS) break;
      if (!Array.isArray(e) || !validKey(e[0])) continue;
      const fv = parseFloorView(e[1]);
      if (fv) floors.push([e[0], fv]);
    }
    if (floors.length) out.floors = floors;
  } else if (validKey(r.floor)) {
    const legacy = parseFloorView({ zoom: r.zoom, focus: r.focus, rotation: r.rotation });
    if (legacy) out.floors = [[r.floor, legacy]];
  }
  if (typeof r.view === "string" && isView(r.view)) out.view = r.view;
  if (isNum(r.tilt)) out.tilt = clampTilt(r.tilt);
  if (typeof r.walls === "string" && (WALLS_MODES as readonly string[]).includes(r.walls)) out.walls = r.walls;
  if (typeof r.theme === "string" && themes.includes(r.theme)) out.theme = r.theme;
  if (typeof r.labels === "boolean") out.labels = r.labels;
  if (typeof r.names === "boolean") out.names = r.names;
  if (validKey(r.floor)) out.floor = r.floor;
  const layers = parseLayers(r.layers);
  if (layers.length) out.layers = layers;
  if (typeof r.detail === "string" && (DETAIL_MODES as readonly string[]).includes(r.detail)) out.detail = r.detail as DetailMode;
  return out;
}

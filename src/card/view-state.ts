/** The card's view memory and rotation, as pure maths and parsing. No DOM, no storage handle: the card reads and
 * writes `localStorage` itself and hands the raw string here. */
import { WALLS_MODES, clampTilt } from "../core";
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

/** What a card remembers. Every field is optional: a field that is there overrides the card's config, one that is
 * missing leaves the config in charge. `focus` is in plan cm (the layout's own coordinates, before any rotation),
 * so a stored view means the same spot at any angle. `view` is a plain string so a view added later ("3d") needs
 * no new storage format. */
export interface StoredView {
  zoom?: number;
  focus?: Pt;
  rotation?: number;
  view?: string;
  tilt?: number;
  /** One of `WALLS_MODES`, kept as a string like `view`. */
  walls?: string;
  theme?: string;
  labels?: boolean;
  /** The floor the person switched to (a key of the layout's `floors`); the card ignores one it does not have. */
  floor?: string;
}

/** Further than this from the origin is not a plan in cm; the bound keeps later arithmetic finite. */
const FOCUS_LIMIT = 1e6;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads a stored entry (the JSON string, or an object already parsed) into a `StoredView`. Storage is untrusted:
 * a field that fails its check is dropped on its own, the good ones stay, and nothing here throws. `isView` and
 * `themes` come from the card, which owns what it can show. Zoom and focus are one fact, so one without the other
 * is dropped. The focus is only bounded here; the card clamps the box built from it against the plan. */
export function parseStoredView(raw: unknown, isView: (v: unknown) => boolean, themes: readonly string[]): StoredView {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return {}; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  const out: StoredView = {};
  const f = r.focus;
  if (isNum(r.zoom) && Array.isArray(f) && f.length === 2 && isNum(f[0]) && isNum(f[1])) {
    out.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, r.zoom));
    out.focus = [Math.min(FOCUS_LIMIT, Math.max(-FOCUS_LIMIT, f[0])), Math.min(FOCUS_LIMIT, Math.max(-FOCUS_LIMIT, f[1]))];
  }
  if (isNum(r.rotation)) out.rotation = normaliseRotation(r.rotation);
  if (typeof r.view === "string" && isView(r.view)) out.view = r.view;
  if (isNum(r.tilt)) out.tilt = clampTilt(r.tilt);
  if (typeof r.walls === "string" && (WALLS_MODES as readonly string[]).includes(r.walls)) out.walls = r.walls;
  if (typeof r.theme === "string" && themes.includes(r.theme)) out.theme = r.theme;
  if (typeof r.labels === "boolean") out.labels = r.labels;
  if (typeof r.floor === "string" && r.floor.length > 0 && r.floor.length <= 200) out.floor = r.floor;
  return out;
}

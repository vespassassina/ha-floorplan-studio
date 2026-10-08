/** What the editor remembers of how the plan is looked at, between reloads: the names toggle, the turn, the floor on show, the hidden Layers, and the zoom and centre of each floor that is not shown whole.
 * One entry per page (origin), not per document: it says nothing about the plan itself, and a plan that is replaced
 * or edited keeps its view. The theme, the grid and night preview have keys of their own (state.ts) and are not
 * repeated here. The editor draws flat only (S12.1), so an older entry's `mode`, `tilt` and `walls` are ignored. Storage is untrusted, so every field is checked on its own and nothing here throws. */
import { normaliseRotation } from "../card/view-state";
import { MAX_ZOOM, MIN_ZOOM, type Pt } from "../card/viewport";
import { parseLayers, type LayerId } from "../core/layers";

export const VIEW_MEMORY_KEY = "floorplan-studio:view";

export interface FloorZoom { zoom: number; focus: Pt }
export interface ViewMemory {
  floor?: string;
  labels?: boolean;
  /** The user's turn in degrees, a multiple of 45 in 0..315, on top of the layout's own `rotate`. */
  rotation?: number;
  /** [floor key, zoom against the floor's fit, centre in plan cm]. A list, not an object: a floor may be named `__proto__`. */
  zooms?: [string, FloorZoom][];
  /** S24.6: the Layers the viewer hid. Left out when none is. */
  hidden?: LayerId[];
}

const MAX_ZOOMS = 50;
const FOCUS_LIMIT = 1e6;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clampFocus = (n: number) => Math.min(FOCUS_LIMIT, Math.max(-FOCUS_LIMIT, n));

export function parseViewMemory(raw: unknown): ViewMemory {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch { return {}; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  const out: ViewMemory = {};
  if (typeof r.floor === "string" && r.floor.length > 0 && r.floor.length <= 200) out.floor = r.floor;
  if (typeof r.labels === "boolean") out.labels = r.labels;
  if (isNum(r.rotation)) out.rotation = normaliseRotation(r.rotation);
  const hidden = parseLayers(r.hidden);
  if (hidden.length) out.hidden = hidden;
  if (Array.isArray(r.zooms)) {
    const zooms: [string, FloorZoom][] = [];
    for (const e of r.zooms) {
      if (zooms.length >= MAX_ZOOMS) break;
      if (!Array.isArray(e) || typeof e[0] !== "string" || !e[0] || e[0].length > 200) continue;
      const z = e[1] as { zoom?: unknown; focus?: unknown } | null;
      const f = z?.focus;
      if (!z || !isNum(z.zoom) || !Array.isArray(f) || f.length !== 2 || !isNum(f[0]) || !isNum(f[1])) continue;
      const out: FloorZoom = { zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z.zoom)), focus: [clampFocus(f[0]), clampFocus(f[1])] };
      zooms.push([e[0], out]);
    }
    if (zooms.length) out.zooms = zooms;
  }
  return out;
}

export function readViewMemory(): ViewMemory {
  try { return parseViewMemory(localStorage.getItem(VIEW_MEMORY_KEY)); } catch { return {}; }
}

/** Writes the memory, or removes the entry when there is nothing to say. False when storage refused (private mode). */
export function writeViewMemory(m: ViewMemory): boolean {
  try {
    if (Object.keys(m).length) localStorage.setItem(VIEW_MEMORY_KEY, JSON.stringify({ v: 1, ...m }));
    else localStorage.removeItem(VIEW_MEMORY_KEY);
    return true;
  } catch {
    return false;
  }
}

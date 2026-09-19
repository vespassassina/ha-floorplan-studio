import { migrate, placedEntities, unplacedCatalog, validate, viewBoxFor } from "../core";
import type { CatalogEntry, DeviceType, Floor, Layout, Pt } from "../core";

/** localStorage key for the autosaved edit. */
export const STORAGE_KEY = "floorplan-studio:layout";

export interface View { x: number; y: number; w: number; h: number }
/** A point that is not a polygon corner: the end of a wall, an opening or an extra. */
export type LooseRef = { k: "walls" | "openings" | "extras"; i: number; end: "a" | "b" };
export type PtRef = { poly: string; j: number } | LooseRef;
export type Sel =
  | null
  | { t: "v"; ref: PtRef }
  | { t: "edge"; poly: string; i: number }
  | { t: "wall" | "door" | "dev" | "room" | "furn" | "stairs"; i: number };

export function emptyLayout(): Layout {
  const floor: Floor = { title: "Ground", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [] };
  return { version: 2, unit: "cm", north: 0, floors: { ground: floor }, catalog: [] };
}

/** Migrates, then validates. Never throws: a bad file gives the list of what is wrong. */
export function loadLayout(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] } {
  try {
    const v = validate(migrate(x));
    if (!v.ok) return v;
    if (!Object.keys(v.layout.floors).length) return { ok: false, errors: ["layout has no floors"] };
    return v;
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/** The autosaved layout of this browser, or null when there is none or it is unusable. */
export function restoreLayout(): Layout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = loadLayout(JSON.parse(raw));
    return r.ok ? r.layout : null;
  } catch {
    return null;
  }
}

export function polyPts(f: Floor, poly: string): Pt[] | undefined {
  if (poly === "o") return f.outline;
  const i = +poly.slice(1);
  return poly[0] === "r" ? f.rooms[i]?.pts : f.stairs[i]?.pts;
}

export function ptOf(f: Floor, ref: PtRef): Pt | null {
  if ("poly" in ref) return polyPts(f, ref.poly)?.[ref.j] ?? null;
  return f[ref.k][ref.i]?.[ref.end] ?? null;
}

const MAX_HISTORY = 100;

/** Everything the editor remembers: layout, undo history, selection, view. No DOM. */
export class EditorState {
  layout: Layout;
  floor: string;
  sel: Sel = null;
  views: Record<string, View> = {};
  filter: DeviceType | "" = "";
  showNames = false;
  snapGrid = true;
  showLen = true;
  /** id of the door drawn open in the preview */
  openDoor: string | null = null;
  private hist: string[] = [];
  private fut: string[] = [];

  constructor(layout: Layout = emptyLayout(), floor?: string) {
    this.layout = layout;
    this.floor = floor && layout.floors[floor] ? floor : Object.keys(layout.floors)[0];
  }

  get f(): Floor { return this.layout.floors[this.floor]; }
  get canUndo() { return this.hist.length > 0; }
  get canRedo() { return this.fut.length > 0; }

  /** Replace the whole layout. A host that sets it starts fresh; Open and Reset keep the history so Undo works. */
  setLayout(layout: Layout, floor?: string, keepHistory = false) {
    if (keepHistory) this.snapshot();
    this.layout = layout;
    this.floor = floor && layout.floors[floor] ? floor : layout.floors[this.floor] ? this.floor : Object.keys(layout.floors)[0];
    this.sel = null; this.views = {}; this.openDoor = null;
    if (!keepHistory) { this.hist = []; this.fut = []; }
  }

  setFloor(name: string) {
    if (!this.layout.floors[name]) return;
    this.floor = name; this.sel = null;
  }

  snapshot() {
    this.hist.push(JSON.stringify(this.layout));
    if (this.hist.length > MAX_HISTORY) this.hist.shift();
    this.fut = [];
  }

  /** One undoable change to the current floor. `fn` gets a copy and may return a new floor. Returns false, and records nothing, when the floor did not change. */
  edit(fn: (f: Floor) => Floor | void): boolean {
    const g = structuredClone(this.f);
    const next = fn(g) ?? g;
    if (JSON.stringify(next) === JSON.stringify(this.f)) return false;
    this.snapshot();
    this.layout.floors[this.floor] = next;
    return true;
  }

  /** Swap the current floor without touching history (used while dragging). */
  replaceFloor(f: Floor) { this.layout.floors[this.floor] = f; }

  undo() { return this.step(this.hist, this.fut); }
  redo() { return this.step(this.fut, this.hist); }
  private step(from: string[], to: string[]): boolean {
    const s = from.pop();
    if (s === undefined) return false;
    to.push(JSON.stringify(this.layout));
    this.layout = JSON.parse(s) as Layout;
    if (!this.layout.floors[this.floor]) this.floor = Object.keys(this.layout.floors)[0];
    this.sel = null;
    return true;
  }

  fit() { this.views[this.floor] = viewBoxFor(this.f, 80); }
  get view(): View {
    if (!this.views[this.floor]) this.fit();
    return this.views[this.floor];
  }

  /** Catalog entries not on the plan. A bound pair leaves the list together. */
  unplaced(): CatalogEntry[] { return unplacedCatalog(this.layout); }

  /** Switches and plugs the light at `devIndex` of the current floor may be controlled by: not placed, not another device's `bound`, not its own entity. Its current one always stays. */
  bindChoices(devIndex: number): CatalogEntry[] {
    const d = this.f.devices[devIndex];
    if (!d || d.type !== "light") return [];
    const taken = placedEntities(this.layout);
    if (d.bound) taken.delete(d.bound);
    return this.layout.catalog.filter((c) => (c.type === "switch" || c.type === "plug") && c.entity !== d.entity && !taken.has(c.entity));
  }

  /** Contact sensors from the catalog that no other door uses. */
  sensorChoices(doorId: string): CatalogEntry[] {
    const used = new Set<string>();
    for (const f of Object.values(this.layout.floors)) for (const d of f.doors) if (d.id !== doorId && d.sensor) used.add(d.sensor);
    return this.layout.catalog.filter((c) => c.type === "contact" && !used.has(c.entity));
  }

  /** Writes the autosave. Storage may be blocked or full; the edit then simply is not remembered. */
  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout)); } catch { /* private mode, quota */ }
  }
}

/** An id that no object of the floor uses yet: `<prefix>-<floor>-<n>`. */
export function newId(f: Floor, floor: string, prefix: string): string {
  const used = new Set<string>();
  for (const list of [f.rooms, f.walls, f.stairs, f.doors, f.openings, f.extras, f.devices, f.furniture]) for (const o of list) used.add(o.id);
  let n = 1;
  while (used.has(`${prefix}-${floor}-${n}`)) n++;
  return `${prefix}-${floor}-${n}`;
}

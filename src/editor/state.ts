import { DEVICE_TYPES, FLOOR_COLOURS, inside, MAX_PALETTE, TEXTURE_IDS, THEMES, contentPoints, migrate, planPivot, rotateAbout, stairSteps, typeForEntity, unplacedCatalog, unplacedHaEntities, validate, viewBoxFor } from "../core";
import type { CatalogEntry, DeviceType, Floor, HaData, Layout, Pt, Stairs, Theme } from "../core";

/** localStorage key for the autosaved edit. */
export const STORAGE_KEY = "floorplan-studio:layout";

/** localStorage key for the snap grid. A viewer preference, not part of the layout. */
export const GRID_KEY = "floorplan-studio:grid";
export const GRID_VALUES = [0, 5, 10, 50] as const;
export type Grid = (typeof GRID_VALUES)[number];
export const DEFAULT_GRID: Grid = 10;
/** The stored grid, or 10 when there is none, it is not one of the four, or storage is blocked. */
function readGrid(): Grid {
  try {
    const raw = localStorage.getItem(GRID_KEY);
    const n = raw === null || raw === "" ? NaN : Number(raw);
    return (GRID_VALUES as readonly number[]).includes(n) ? (n as Grid) : DEFAULT_GRID;
  } catch { return DEFAULT_GRID; }
}

/** localStorage key for the measure grid toggle. A viewer preference, not part of the layout, never an undo step. */
export const MEASURE_KEY = "floorplan-studio:measure";
/** The stored choice, or true when there is none, it is not "false", or storage is blocked. */
function readMeasure(): boolean {
  try { return localStorage.getItem(MEASURE_KEY) !== "false"; } catch { return true; }
}

/** localStorage key for the theme choice (S1.53). A viewer preference, not part of the layout, never an undo step. */
export const THEME_KEY = "floorplan-studio:theme";
export const THEME_VALUES = THEMES;
export type ThemeChoice = Theme;
export const DEFAULT_THEME: ThemeChoice = "blueprint";
/** The stored choice, or blueprint when there is none, it is not one of the three (an old "auto" or "dark" lands here), or storage is blocked. */
function readTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return (THEME_VALUES as readonly string[]).includes(raw ?? "") ? (raw as ThemeChoice) : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

export interface View { x: number; y: number; w: number; h: number }
/** A point that is not a polygon corner: the end of a wall, an opening or an extra. */
export type LooseRef = { k: "walls" | "openings" | "extras"; i: number; end: "a" | "b" };
export type PtRef = { poly: string; j: number } | LooseRef;
export type Sel =
  | null
  | { t: "v"; ref: PtRef }
  | { t: "edge"; poly: string; i: number }
  | { t: "wall" | "door" | "opening" | "dev" | "room" | "furn" | "stairs" | "extra" | "unl"; i: number }
  /** S4.5: several lights, or several motion sensors, Shift+clicked together, for "Create group". */
  | { t: "devs"; is: number[] };

export function emptyLayout(): Layout {
  const floor: Floor = { title: "Ground", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] };
  return { version: 2, unit: "cm", north: 0, rotate: 0, floors: { ground: floor }, catalog: [] };
}

/** True when nothing is drawn on any floor: nothing a demo could overwrite. Floor titles and the catalog do not count. */
export function isBlank(l: Layout): boolean {
  return Object.values(l.floors).every((f) => Object.values(f).every((v) => !Array.isArray(v) || v.length === 0));
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

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A floors object with no prototype, so a floor called `__proto__` or `constructor` is just a key. */
function floorsOf(entries: [string, Floor][]): Record<string, Floor> {
  const o: Record<string, Floor> = Object.create(null);
  for (const [k, v] of entries) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  return o;
}

/** Everything the editor remembers: layout, undo history, selection, view. No DOM. */
export class EditorState {
  layout: Layout;
  /** What Home Assistant has, when the host gives it. Undefined standalone: every name is then free text. */
  ha: HaData | undefined = undefined;
  floor: string;
  sel: Sel = null;
  views: Record<string, View> = {};
  filter: DeviceType | "" = "";
  showNames = false;
  /** S4.5: the Group menu's chosen HA group entity, dimming every device not among its members. Kept for the session, never the layout. */
  activeGroup: string | null = null;
  /** S4.5: the "Create group" panel's draft name field. Kept for the session, never the layout. */
  groupDraft = "";
  /** Snap grid in cm; 0 is none. Kept in localStorage, not in the layout. */
  snapGrid: Grid = readGrid();
  showLen = true;
  /** Whether the measure grid is drawn. Kept in localStorage, not in the layout, never an undo step. */
  measure: boolean = readMeasure();
  /** Blueprint (default), light, or ha (Home Assistant's own theme). Kept in localStorage, not in the layout, never an undo step. */
  theme: ThemeChoice = readTheme();
  /** id of the door drawn open in the preview */
  openDoor: string | null = null;
  /** The floor panel is asking "Delete floor ...?". Any change of floor, undo or press on the plan cancels it. */
  /** The direction the rotation buttons turn: 1 clockwise, -1 counter-clockwise. Kept for the session. */
  turnDir: 1 | -1 = 1;
  /** The edge ("poly:i") whose Delete is waiting for a yes because a door or window is on it. */
  confirmEdge: string | null = null;
  confirmDelete = false;
  private hist: string[] = [];
  private fut: string[] = [];

  constructor(layout: Layout = emptyLayout(), floor?: string) {
    this.layout = layout;
    this.floor = floor && hasOwn(layout.floors, floor) ? floor : Object.keys(layout.floors)[0];
  }

  get f(): Floor { return this.layout.floors[this.floor]; }
  get canUndo() { return this.hist.length > 0; }
  get canRedo() { return this.fut.length > 0; }

  /** Replace the whole layout. A host that sets it starts fresh; Open and Reset keep the history so Undo works. */
  setLayout(layout: Layout, floor?: string, keepHistory = false) {
    if (keepHistory) this.snapshot();
    this.layout = layout;
    this.floor = floor && hasOwn(layout.floors, floor) ? floor : hasOwn(layout.floors, this.floor) ? this.floor : Object.keys(layout.floors)[0];
    this.sel = null; this.views = {}; this.openDoor = null; this.confirmDelete = false;
    if (!keepHistory) { this.hist = []; this.fut = []; }
  }

  setFloor(name: string) {
    if (!hasOwn(this.layout.floors, name)) return;
    this.floor = name; this.sel = null; this.confirmDelete = false;
  }

  // ---- floors: whole-layout snapshots, one undo step each, nothing recorded when refused ----

  /** Adds a floor last and selects it, with the outline (and its wall kinds), and the stairs, of the first floor (the lowest) and nothing else, so a house is not traced twice. Deep copies; the stairs get ids of the new floor. The key is the slug of the title, with -2, -3 on a clash. Returns the key, or "" for an empty title. */
  addFloor(title: string): string {
    const t = title.trim();
    if (!t) return "";
    const base = slug(t) || "floor";
    let key = base;
    for (let n = 2; hasOwn(this.layout.floors, key); n++) key = `${base}-${n}`;
    this.snapshot();
    const first = Object.values(this.layout.floors)[0];
    const nf: Floor = { title: t, outline: structuredClone(first?.outline ?? []), rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] };
    if (first?.owk) nf.owk = structuredClone(first.owk); // Opus review: the outline's kinds must follow its points, or a new floor's perimeter drops back to the wk-less default
    for (const s of first?.stairs ?? []) nf.stairs.push({ ...structuredClone(s), id: newId(nf, key, "stairs") });
    Object.defineProperty(this.layout.floors, key, { value: nf, enumerable: true, writable: true, configurable: true });
    this.floor = key; this.sel = null; this.openDoor = null; this.confirmDelete = false;
    return key;
  }

  /** Adds the same stairs to every floor, each with an id of its own, as one undo step; selects the one on the current floor. A floor that has stairs gets another: two flights are legitimate. */
  addStairsEverywhere(t: Omit<Stairs, "id">): void {
    this.snapshot();
    for (const [key, fl] of Object.entries(this.layout.floors)) fl.stairs.push({ ...structuredClone(t), id: newId(fl, key, "stairs") });
    this.sel = { t: "stairs", i: this.f.stairs.length - 1 };
    this.confirmDelete = false;
  }

  /** Changes the title only; the key stays. False for an empty title, the same title or an unknown key. */
  renameFloor(key: string, title: string): boolean {
    const t = title.trim();
    if (!t || !hasOwn(this.layout.floors, key) || this.layout.floors[key].title === t) return false;
    this.snapshot();
    this.layout.floors[key].title = t;
    return true;
  }

  /** Removes a floor and its content. False for the last floor or an unknown key. The catalog is left alone. The selection moves to the next floor, else the previous. */
  deleteFloor(key: string): boolean {
    const ks = Object.keys(this.layout.floors), i = ks.indexOf(key);
    if (i < 0 || ks.length < 2) return false;
    this.snapshot();
    this.layout.floors = floorsOf(ks.filter((k) => k !== key).map((k) => [k, this.layout.floors[k]]));
    delete this.views[key];
    this.confirmDelete = false;
    if (this.floor === key) { this.floor = ks[i + 1] ?? ks[i - 1]; this.sel = null; this.openDoor = null; }
    return true;
  }

  /** Moves a floor `delta` places in the key order (-1 earlier, +1 later). False when that would leave the list or nothing moves. */
  moveFloor(key: string, delta: number): boolean {
    const ks = Object.keys(this.layout.floors), i = ks.indexOf(key), j = i + delta;
    if (i < 0 || !Number.isInteger(delta) || delta === 0 || j < 0 || j >= ks.length) return false;
    this.snapshot();
    ks.splice(i, 1);
    ks.splice(j, 0, key);
    this.layout.floors = floorsOf(ks.map((k) => [k, this.layout.floors[k]]));
    return true;
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
    for (const t of next.stairs) t.steps = stairSteps(t); // steps follow the run (S1.44)
    // Deep compare by serialising: cheap at this size, and it makes a no-op edit leave no undo step.
    if (JSON.stringify(next) === JSON.stringify(this.f)) return false;
    this.snapshot();
    this.layout.floors[this.floor] = next;
    return true;
  }

  /** Swap the current floor without touching history (used while dragging). */
  replaceFloor(f: Floor) { for (const t of f.stairs) t.steps = stairSteps(t); this.layout.floors[this.floor] = f; }

  /** Commits a gesture already shown live via `replaceFloor` (a value dragged with an `<input type="range">`, for
   * instance): one undo step from `before` (the layout exactly as it stood when the gesture started) to the current
   * layout, none if the gesture ended back where it started. Returns whether a step was recorded. */
  commitLiveEdit(before: Layout): boolean {
    if (JSON.stringify(before) === JSON.stringify(this.layout)) return false;
    this.hist.push(JSON.stringify(before));
    if (this.hist.length > MAX_HISTORY) this.hist.shift();
    this.fut = [];
    return true;
  }

  undo() { return this.step(this.hist, this.fut); }
  redo() { return this.step(this.fut, this.hist); }
  private step(from: string[], to: string[]): boolean {
    const s = from.pop();
    if (s === undefined) return false;
    to.push(JSON.stringify(this.layout));
    this.layout = JSON.parse(s) as Layout;
    if (!hasOwn(this.layout.floors, this.floor)) this.floor = Object.keys(this.layout.floors)[0];
    this.sel = null; this.confirmDelete = false;
    return true;
  }

  /** The plan's rotation as renderFloor takes it: none at 0. */
  get rotation(): { deg: number; pivot: Pt } | undefined {
    const deg = this.layout.rotate ?? 0;
    return deg % 360 ? { deg, pivot: planPivot(this.layout) } : undefined;
  }

  /** A view is stored in plan coordinates: its centre is the plan point in the middle of the screen, w and h are what the screen shows. Rotating the plan therefore needs no change to it. */
  fit() {
    const b = viewBoxFor(this.f, 80, this.rotation), r = this.rotation;
    const c = r ? rotateAbout([b.x + b.w / 2, b.y + b.h / 2], -r.deg, r.pivot) : ([b.x + b.w / 2, b.y + b.h / 2] as Pt);
    this.views[this.floor] = { x: c[0] - b.w / 2, y: c[1] - b.h / 2, w: b.w, h: b.h };
  }

  /** Zoom and pan back to the whole floor: everything on it (`contentPoints`), not only the outline, with an 80 cm margin. Writes nothing to the layout; no undo step. */
  recenter() {
    const r = this.rotation, pts = contentPoints(this.f);
    if (!pts.length) { this.fit(); return; }
    const shown = r ? pts.map((p) => rotateAbout(p, r.deg, r.pivot)) : pts;
    const xs = shown.map((p) => p[0]), ys = shown.map((p) => p[1]), M = 80;
    const b = { x: Math.min(...xs) - M, y: Math.min(...ys) - M, w: Math.max(...xs) - Math.min(...xs) + 2 * M, h: Math.max(...ys) - Math.min(...ys) + 2 * M };
    const c = r ? rotateAbout([b.x + b.w / 2, b.y + b.h / 2], -r.deg, r.pivot) : ([b.x + b.w / 2, b.y + b.h / 2] as Pt);
    this.views[this.floor] = { x: c[0] - b.w / 2, y: c[1] - b.h / 2, w: b.w, h: b.h };
  }

  /** Turns the whole plan to `deg` (a multiple of 45, taken modulo 360): one undo step, no step when it is already there. The views are dropped so each floor is fitted again. */
  setRotate(deg: number): boolean {
    const n = ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
    if (n === (this.layout.rotate ?? 0)) return false;
    this.snapshot();
    this.layout.rotate = n;
    this.views = {};
    return true;
  }
  /**
   * Paints a room, zone or staircase of the current floor, one undo step. `{ color }` sets a flat colour (and drops any texture); a
   * colour that is not a built-in swatch joins `layout.palette`, newest last, so the swatches keep every custom colour used.
   * `{ texture, rot, scale }` sets a texture (and drops the colour) and, optionally, the texture's own rotation in
   * whole degrees (S4.22; 0 or omitted is never stored) and scale (S4.19; 1 or omitted is never stored). `null`
   * returns to the theme's default fill. Returns false, recording nothing, when the shape is missing, the value is
   * bad or nothing changes.
   */
  paint(on: "rooms" | "stairs", i: number, paint: { color: string } | { texture: string; rot?: number; scale?: number } | null): boolean {
    const next: Layout = structuredClone(this.layout);
    const shape = next.floors[this.floor][on][i];
    if (!shape) return false;
    delete shape.color; delete shape.texture; delete shape.textureRot; delete shape.textureScale;
    if (paint && "color" in paint) {
      const hex = paint.color.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex)) return false;
      shape.color = hex;
      if (!FLOOR_COLOURS.some((k) => k.hex === hex) && !(next.palette ?? []).includes(hex)) next.palette = [...(next.palette ?? []), hex].slice(-MAX_PALETTE);
    } else if (paint) {
      if (!TEXTURE_IDS.includes(paint.texture)) return false;
      shape.texture = paint.texture;
      const rot = ((Math.trunc(paint.rot ?? 0) % 360) + 360) % 360;
      if (rot !== 0) shape.textureRot = rot;
      const scale = Math.min(2, Math.max(0.25, paint.scale ?? 1));
      if (scale !== 1) shape.textureScale = scale;
    }
    if (JSON.stringify(next) === JSON.stringify(this.layout)) return false;
    this.snapshot();
    this.layout.floors[this.floor] = next.floors[this.floor];
    if (next.palette) this.layout.palette = next.palette;
    return true;
  }
  /** A switch or plug that no light is bound to: the ones "Create a light from this switch" is offered on. */
  canMakeLight(devIndex: number): boolean {
    const d = this.f.devices[devIndex];
    if (!d || (d.type !== "switch" && d.type !== "plug")) return false;
    return !Object.values(this.layout.floors).some((f) => f.devices.some((x) => x.bound === d.entity));
  }

  /**
   * After Home Assistant made `entity` (a light wrapping the switch at `devIndex`): the switch leaves the plan, the light takes its place
   * 30 cm to the right, bound to the switch, and joins the catalog. One undo step. False, and nothing recorded, for a device that is not a
   * switch or plug, or an entity that is already on the plan or in the catalog.
   */
  lightFromSwitch(devIndex: number, entity: string, name: string): boolean {
    const sw = this.f.devices[devIndex];
    if (!sw || !this.canMakeLight(devIndex) || "a" in sw) return false;
    if (Object.values(this.layout.floors).some((f) => f.devices.some((d) => d.entity === entity)) || this.layout.catalog.some((c) => c.entity === entity)) return false;
    const next = structuredClone(this.layout);
    const f = next.floors[this.floor];
    const id = newId(f, this.floor, "light");
    const room = f.rooms.find((r) => (r.kind === "room" || r.kind === "structure") && inside([sw.x, sw.y], r.pts));
    f.devices.splice(devIndex, 1, { id, name, type: "light", entity, x: sw.x + 30, y: sw.y, bound: sw.entity });
    next.catalog.push({ id, floor: this.floor, room: room?.name ?? "", type: "light", name, entity });
    this.snapshot();
    this.layout = next;
    this.sel = { t: "dev", i: devIndex };
    return true;
  }

  /**
   * Places `e` as a new device at `ctr` — both a new `layout.catalog` entry (`room`, when known, for its labels in the
   * Device menu) and a new device on the current floor, one undo step. `typeForEntity` guesses the device type; the
   * device panel's own type field corrects it afterward. False, and nothing recorded, for an entity already placed
   * or already in the catalog. Shared by `addFromArea` (S4.18, one room's area) and `addEntity` (S4.14, the general palette).
   */
  private addHaEntity(e: HaData["entities"][number], ctr: Pt, room?: string): boolean {
    if (Object.values(this.layout.floors).some((f) => f.devices.some((d) => d.entity === e.id)) || this.layout.catalog.some((c) => c.entity === e.id)) return false;
    const next = structuredClone(this.layout);
    const f = next.floors[this.floor];
    const id = newId(f, this.floor, "device");
    const type = typeForEntity(e);
    f.devices.push({ id, name: e.name, type, entity: e.id, x: ctr[0], y: ctr[1] });
    next.catalog.push({ id, floor: this.floor, room: room ?? "", type, name: e.name, entity: e.id });
    this.snapshot();
    this.layout = next;
    this.sel = { t: "dev", i: f.devices.length - 1 };
    return true;
  }

  /** S4.18: places `e`, an entity from the current floor's `roomIndex` room's linked HA area, at that room's centre. False for an unknown room. */
  addFromArea(roomIndex: number, e: HaData["entities"][number]): boolean {
    const room = this.f.rooms[roomIndex];
    if (!room) return false;
    const ctr: Pt = [Math.round(room.pts.reduce((s, p) => s + p[0], 0) / room.pts.length), Math.round(room.pts.reduce((s, p) => s + p[1], 0) / room.pts.length)];
    return this.addHaEntity(e, ctr, room.name);
  }

  /** S4.15: entities of room `roomIndex`'s HA area that are neither drawn nor catalogued. Empty with no HA, no area or no such room. */
  areaToPlace(roomIndex: number): HaData["entities"] {
    const room = this.f.rooms[roomIndex];
    if (!room?.area || !this.ha || room.pts.length < 3) return [];
    return unplacedHaEntities(this.layout, this.ha).filter((e) => e.area === room.area);
  }

  /**
   * S4.15: places every entity `areaToPlace` returns, one undo step, and returns how many. They take the free cells
   * of a 60 cm grid about the room's centre, nearest first: inside the room, not the centre itself (the room's label
   * is there), not next to a device already on the floor. A room too small for that shrinks the grid; one too small
   * even then stacks the rest on the centre. None to place records no step.
   */
  placeArea(roomIndex: number): number {
    const todo = this.areaToPlace(roomIndex);
    if (!todo.length) return 0;
    const room = this.f.rooms[roomIndex];
    const xs = room.pts.map((p) => p[0]), ys = room.pts.map((p) => p[1]);
    const ctr: Pt = [xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length];
    const reach = Math.max(...xs.map((x) => Math.abs(x - ctr[0])), ...ys.map((y) => Math.abs(y - ctr[1])));
    const taken = this.f.devices.flatMap((d) => ("x" in d ? [[d.x, d.y] as Pt] : []));
    const cells = (step: number): Pt[] => {
      const r = Math.ceil(reach / step), out: [number, Pt][] = [];
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const p: Pt = [Math.round(ctr[0] + i * step), Math.round(ctr[1] + j * step)];
        if ((i || j) && inside(p, room.pts) && taken.every((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) >= step * 0.7)) out.push([Math.hypot(i, j), p]);
      }
      return out.sort((a, b) => a[0] - b[0]).map((c) => c[1]); // stable: equal distances keep row order
    };
    let spots = cells(60);
    for (let step = 48; spots.length < todo.length && step >= 10; step *= 0.8) spots = cells(step);
    const next = structuredClone(this.layout);
    const f = next.floors[this.floor];
    todo.forEach((e, k) => {
      const at = spots[k] ?? (ctr.map(Math.round) as Pt);
      const id = newId(f, this.floor, "device"), type = typeForEntity(e);
      f.devices.push({ id, name: e.name, type, entity: e.id, x: at[0], y: at[1] });
      next.catalog.push({ id, floor: this.floor, room: room.name, type, name: e.name, entity: e.id });
    });
    this.snapshot();
    this.layout = next;
    this.sel = { t: "room", i: roomIndex };
    return todo.length;
  }

  /**
   * S4.14: places `e` from the general "Add > Entities" palette. When `e`'s HA area matches a room on the current
   * floor, it lands at that room's centre and the catalog records the room, exactly like `addFromArea` — a room the
   * user already drew is a better guess than the caller's `fallback` spawn point. Otherwise it lands at `fallback`.
   */
  addEntity(e: HaData["entities"][number], fallback: Pt): boolean {
    const room = e.area ? this.f.rooms.find((r) => r.area === e.area) : undefined;
    if (!room) return this.addHaEntity(e, fallback);
    const ctr: Pt = [Math.round(room.pts.reduce((s, p) => s + p[0], 0) / room.pts.length), Math.round(room.pts.reduce((s, p) => s + p[1], 0) / room.pts.length)];
    return this.addHaEntity(e, ctr, room.name);
  }

  /** Sets (`hex`) or removes (null) the colour of one device type in `layout.colors`: one undo step, none when nothing changes. `colors` is removed when it empties, so an untouched layout stays as it was. */
  setColour(type: DeviceType, hex: string | null): boolean {
    const cur = this.layout.colors ?? {};
    if (hex === null ? !(type in cur) : !((DEVICE_TYPES as readonly string[]).includes(type) && /^#[0-9a-fA-F]{6}$/.test(hex) && cur[type] !== hex)) return false;
    this.snapshot();
    const next = { ...cur };
    if (hex === null) delete next[type]; else next[type] = hex;
    if (Object.keys(next).length) this.layout.colors = next; else delete this.layout.colors;
    return true;
  }
  /** Removes every device colour: one undo step, none when there are none. */
  resetColours(): boolean {
    if (!this.layout.colors) return false;
    this.snapshot();
    delete this.layout.colors;
    return true;
  }
  get view(): View {
    if (!this.views[this.floor]) this.fit();
    return this.views[this.floor];
  }

  /** Catalog entries not on the plan. A switch that only a light names (`bound`) is still on the list. */
  unplaced(): CatalogEntry[] { return unplacedCatalog(this.layout); }

  /** Switches and plugs the light at `devIndex` of the current floor may be controlled by: every one in the catalog except the light's own entity, placed or bound elsewhere. Several lights may share one. */
  bindChoices(devIndex: number): CatalogEntry[] {
    const d = this.f.devices[devIndex];
    if (!d || d.type !== "light") return [];
    return this.layout.catalog.filter((c) => (c.type === "switch" || c.type === "plug") && c.entity !== d.entity);
  }

  /**
   * S4.24: catalog entries of `type` not already on this door's own `field` list (those stay offered, so a
   * current pick still shows) and not on any *other* door's `field` list — several sensors per door, but one
   * door per sensor, matching the single-sensor behaviour this replaces.
   */
  doorAttachChoices(doorId: string, field: "sensors" | "vibration" | "locks"): CatalogEntry[] {
    const type: DeviceType = field === "sensors" ? "contact" : field === "vibration" ? "vibration" : "lock";
    const used = new Set<string>();
    for (const f of Object.values(this.layout.floors)) for (const d of f.doors) if (d.id !== doorId) for (const e of d[field] ?? []) used.add(e);
    return this.layout.catalog.filter((c) => c.type === type && !used.has(c.entity));
  }

  /**
   * Curtain/blind entities from the catalog not already on another door's `cover`. Offered on every door kind —
   * a plain door's garage opener is a cover entity too — the panel just labels it "electric curtain" on a
   * glass door or window.
   */
  coverChoices(doorId: string): CatalogEntry[] {
    const used = new Set<string>();
    for (const f of Object.values(this.layout.floors)) for (const d of f.doors) if (d.id !== doorId && d.cover) used.add(d.cover);
    return this.layout.catalog.filter((c) => c.type === "cover" && !used.has(c.entity));
  }

  /**
   * S4.24: catalog entries a heater's `trvs`/`tempSensors` or an ac's `linked` list may attach, minus the
   * device's own entity. Unlike a door's sensors, these are not excluded elsewhere on the plan — the same
   * temperature sensor, say, may reasonably feed more than one heater, the same way a switch can power several
   * lights (`bindChoices` above).
   */
  deviceAttachChoices(devIndex: number, field: "trvs" | "tempSensors" | "linked"): CatalogEntry[] {
    const d = this.f.devices[devIndex];
    if (!d) return [];
    if (field === "tempSensors") return this.layout.catalog.filter((c) => c.type === "temp" && c.entity !== d.entity);
    return this.layout.catalog.filter((c) => (c.type === "climate" || c.type === "ac") && c.entity !== d.entity);
  }

  /**
   * S4.25: catalog entries an unlinked item's `attached` list may offer. Unlike a heater's trvs or an ac's
   * linked climates, an unlinked item has no fixed HA domain (a "car" or "server" type has no natural one), so
   * every placed entity is a candidate; `multiAttachField` already excludes what is attached to this item.
   */
  unlinkedAttachChoices(): CatalogEntry[] {
    return this.layout.catalog;
  }

  /** Writes the autosave. Storage may be blocked or full; the edit then simply is not remembered. */
  setGrid(g: Grid) {
    if (!(GRID_VALUES as readonly number[]).includes(g)) return;
    this.snapGrid = g;
    try { localStorage.setItem(GRID_KEY, String(g)); } catch { /* private mode: the choice lasts until reload */ }
  }
  /** Toggles the measure grid. A viewer preference: no undo step, never written to the layout. */
  setMeasure(v: boolean) {
    this.measure = v;
    try { localStorage.setItem(MEASURE_KEY, String(v)); } catch { /* private mode: the choice lasts until reload */ }
  }
  /** Sets the theme choice (S1.53). A viewer preference: no undo step, never written to the layout. */
  setTheme(t: ThemeChoice) {
    if (!(THEME_VALUES as readonly string[]).includes(t)) return;
    this.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: the choice lasts until reload */ }
  }
  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout)); } catch { /* private mode, quota */ }
  }
}

/** An id that no object of the floor uses yet: `<prefix>-<floor>-<n>`. */
export function newId(f: Floor, floor: string, prefix: string): string {
  const used = new Set<string>();
  for (const list of [f.rooms, f.walls, f.stairs, f.doors, f.openings, f.extras, f.devices, f.furniture, f.unlinked]) for (const o of list) used.add(o.id);
  let n = 1;
  while (used.has(`${prefix}-${floor}-${n}`)) n++;
  return `${prefix}-${floor}-${n}`;
}

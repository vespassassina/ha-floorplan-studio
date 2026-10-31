import { stairSteps } from "./geometry";
import { isEntityId, isViewPath, CAR_MODELS, COORD_LIMIT, FX_MIN, FX_MAX, MAX_CAR_ATTACHED, MAX_VIEWS, viewProblems, tempRangeProblems, type CatalogEntry, type Device, type DeviceType, type Layout, type Pt } from "./schema";

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const KINDS: [string, string][] = [["rooms", "room"], ["walls", "wall"], ["stairs", "stairs"], ["doors", "door"], ["openings", "opening"], ["extras", "extra"], ["furniture", "furniture"], ["unlinked", "unlinked"]];
const RENAME: Record<string, DeviceType> = { sensor: "temp", window: "contact" };

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Room edges: `w` booleans become `wk` kinds (true wall, false boundary); a missing or short list is padded with wall. */
function edgeKinds(r: any) {
  const n = Array.isArray(r.pts) ? r.pts.length : 0;
  if (!Array.isArray(r.wk)) r.wk = Array.isArray(r.w) ? r.w.map((v: unknown) => (v === false ? "boundary" : "wall")) : [];
  while (r.wk.length < n) r.wk.push("wall");
  delete r.w;
}

/** The house perimeter: a missing or short `owk` is padded with external, at v1 and at v2 (S1.52). */
function outlineKinds(f: any) {
  const n = Array.isArray(f.outline) ? f.outline.length : 0;
  if (!Array.isArray(f.owk)) f.owk = [];
  while (f.owk.length < n) f.owk.push("external");
  if (f.owk.length > n) f.owk.length = n;
}

/** A height, sill or mount height must be a finite number from 0 to 1000. Anything else is dropped, so the default applies
 *  and the file opens (heights are optional; `validate` still judges a value that reaches it by another road). */
const HEIGHT_KEYS: [string, string[]][] = [["rooms", ["height"]], ["walls", ["height"]], ["doors", ["height", "sill"]], ["openings", ["height", "sill"]], ["furniture", ["height"]], ["unlinked", ["height"]], ["devices", ["z"]]];
function dropBadHeights(f: any) {
  const bad = (v: unknown) => !(typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000);
  for (const k of ["height", "slab"]) if (k in f && bad(f[k])) delete f[k];
  for (const [list, keys] of HEIGHT_KEYS) for (const o of f[list]) for (const k of keys) if (k in o && bad(o[k])) delete o[k];
}

/** S27.2: a floor `offset` that is not two finite numbers within COORD_LIMIT is dropped, so the floor sits at [0, 0] and the file opens. A good one is kept as written. */
function dropBadOffset(f: any) {
  const o = f.offset;
  if ("offset" in f && !(Array.isArray(o) && o.length === 2 && o.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT))) delete f.offset;
}

/** S29.1: a floor `rotation` that is not a finite number from -180 to 180 is dropped, so the floor is not turned and the file opens. A good one is kept as written. */
function dropBadRotation(f: any) {
  const r = f.rotation;
  if ("rotation" in f && !(typeof r === "number" && Number.isFinite(r) && r >= -180 && r <= 180)) delete f.rotation;
}

/** S35.1: the car keys `validate` would accept stay; the rest go, so a model from a newer file loads as a sedan. */
function dropBadCar(f: any) {
  for (const m of f.furniture) {
    if (m.symbol !== "car") { delete m.model; delete m.color; delete m.attached; continue; }
    if ("entity" in m && !isEntityId(m.entity)) delete m.entity; // 0.32.1 took any string with a dot
    if ("model" in m && !CAR_MODELS.includes(m.model)) delete m.model;
    if ("color" in m && !(typeof m.color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.color))) delete m.color;
    if ("attached" in m) {
      const kept: string[] = Array.isArray(m.attached) ? [...new Set<string>(m.attached.filter((e: unknown): e is string => isEntityId(e)))].slice(0, MAX_CAR_ATTACHED) : [];
      if (kept.length) m.attached = kept; else delete m.attached;
    }
  }
}

/** S14.3: an effect size outside 25-300 (or not a number) is dropped, so the device draws at 100 and the file opens. */
function dropBadFx(f: any) {
  for (const d of f.devices) if ("fx" in d && !(typeof d.fx === "number" && Number.isFinite(d.fx) && d.fx >= FX_MIN && d.fx <= FX_MAX)) delete d.fx;
}

/** S40.3: a device's `view` that `validate` would refuse is dropped, so the file opens and the icon taps as before. */
function dropBadView(f: any) {
  for (const d of f.devices) if (d.view !== undefined && !isViewPath(d.view)) delete d.view;
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);

/** S33.6: the saved views that `validate` would accept, in order, first of a duplicate id, at most MAX_VIEWS. */
function keepViews(views: unknown[], floors: unknown): unknown[] {
  const ids = new Set<string>(), kept: unknown[] = [];
  for (const v of views) {
    if (kept.length >= MAX_VIEWS) break;
    if (viewProblems(v, floors).length || ids.has((v as any).id)) continue;
    ids.add((v as any).id); kept.push(v);
  }
  return kept;
}

/** Accepts a v1 or v2 layout and returns a new v2 layout. The input is never changed. Missing arrays and ids are filled in. */
export function migrate(x: unknown): Layout {
  if (!isObj(x)) throw new Error("Not a layout: expected a JSON object");
  const src = structuredClone(x) as any;
  // No version is v1. Otherwise a number, or digits in a string: Number(true) is 1 and must not pass.
  const raw = src.version, isNum = typeof raw === "number" || (typeof raw === "string" && /^\s*\d+\s*$/.test(raw));
  if (raw !== undefined && !isNum) throw new Error(`Layout version must be a number, got ${JSON.stringify(raw) ?? String(raw)}`);
  const v = raw === undefined ? 1 : Number(raw);
  if (v !== 1 && v !== 2) throw new Error(`Unknown layout version ${String(src.version)}`);

  const floors: Record<string, any> = Object.create(null);
  for (const [fname, f] of Object.entries<any>(isObj(src.floors) ? src.floors : {})) {
    if (!isObj(f)) throw new Error(`Floor "${fname}" must be an object`);
    for (const [key, kind] of KINDS) {
      if (f[key] !== undefined && !Array.isArray(f[key])) throw new Error(`Floor "${fname}": ${key} must be an array`);
      f[key] = (f[key] ?? []).filter(isObj);
      f[key].forEach((o: any, i: number) => { o.id = o.id ?? `${kind}-${fname}-${i + 1}`; });
      if (key === "walls") for (const o of f.walls) o.kind = o.kind ?? "wall";
    }
    // Opus review: every other out-of-range value in this file is normalised, not just rejected later by
    // `validate`. A piece of furniture outside 5-2000 cm (an old file with a 25 m patio, say) gets the same
    // treatment, so it opens instead of failing with no repair path. `validate`'s own check is unchanged.
    for (const m of f.furniture) for (const k of ["w", "h"] as const) if (typeof m[k] === "number" && Number.isFinite(m[k])) m[k] = Math.max(5, Math.min(2000, m[k]));
    // S5.1: the editor's own rotate buttons always wrap into [0, 360), but a hand-edited file can carry a 450 or a
    // -30; wrapped here so it opens as the angle it actually means, not rejected by `validate`'s finite-number check alone.
    for (const m of f.furniture) if (typeof m.rot === "number" && Number.isFinite(m.rot)) m.rot = ((m.rot % 360) + 360) % 360;
    for (const o of [...f.stairs, ...f.extras]) o.name = o.name ?? ""; // validate wants text; an older file has none
    for (const t of f.stairs) { t.shape = t.shape ?? "straight"; t.rot = t.rot ?? 0; if (t.shape === "round") t.inner = t.inner ?? 0; t.steps = stairSteps(t); } // steps are derived: a stored value that disagrees is dropped
    for (const u of f.unlinked) { u.rot = u.rot ?? 0; u.scale = u.scale ?? 1; } // S4.25: a hand-authored entry with no rot/scale still opens
    if (f.devices !== undefined && !Array.isArray(f.devices)) throw new Error(`Floor "${fname}": devices must be an array`);
    if (f.outline !== undefined && !Array.isArray(f.outline)) throw new Error(`Floor "${fname}": outline must be an array`);
    outlineKinds(f);
    // `label` (S4.29): dropped from the schema, an old file's stray value with it — the editor never had a way to set it.
    for (const r of f.rooms) { if (r.kind === "outdoor") r.kind = "garden"; r.area = r.area ?? (r.kind === "water" ? "" : slug(String(r.name ?? ""))); r.name = r.name ?? ""; delete r.label; edgeKinds(r); if (r.tempRange !== undefined && tempRangeProblems(r.tempRange, false).length) delete r.tempRange; }
    // S4.24: a door's single `sensor` becomes `sensors`, a list. Always drop the old key, whether or not a new
    // list is already present, so a half-migrated file never keeps both.
    for (const d of f.doors) { if (typeof d.sensor === "string" && d.sensor && !Array.isArray(d.sensors)) d.sensors = [d.sensor]; delete d.sensor; }
    f.devices = (f.devices ?? []).filter(isObj).map((d: any, i: number) => {
      if (v === 1) d.type = RENAME[d.type] ?? d.type;
      d.id = d.id ?? `${d.type}-${fname}-${i + 1}`;
      return d;
    });
    dropBadHeights(f); dropBadFx(f); dropBadView(f); dropBadOffset(f); dropBadRotation(f); dropBadCar(f);
    Object.defineProperty(floors, fname, { value: f, enumerable: true, writable: true, configurable: true });
  }
  const out: any = { version: 2, unit: "cm", north: src.north ?? 0, rotate: src.rotate ?? 0, floors, catalog: src.catalog };
  if (src.palette !== undefined) out.palette = src.palette;
  if (src.colors !== undefined) out.colors = src.colors; // passed through; validate judges it. Never invented.
  if (src.tempRange !== undefined && !tempRangeProblems(src.tempRange, true).length) out.tempRange = src.tempRange; // S42.1: a range is a convenience; a bad one is dropped, never the plan
  if (Array.isArray(src.views)) out.views = keepViews(src.views, floors); // S33.6: a view is a convenience; a bad one is dropped, never the plan
  if (Array.isArray(out.catalog) && v === 1) for (const c of out.catalog) c.type = RENAME[c.type] ?? c.type;
  if (!Array.isArray(out.catalog)) out.catalog = buildCatalog(out);
  return out as Layout;
}

function buildCatalog(l: Layout): CatalogEntry[] {
  const list: CatalogEntry[] = [];
  for (const [fname, f] of Object.entries(l.floors))
    for (const d of f.devices as Device[]) {
      const hasPos = ("x" in d && Number.isFinite(d.x) && Number.isFinite(d.y)) || ("a" in d && Array.isArray(d.a) && Array.isArray(d.b));
      if (!hasPos) continue;
      const at: Pt = "x" in d ? [d.x, d.y] : [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      const room = f.rooms.find((r) => inside(at, r.pts));
      list.push({ id: d.id, floor: fname, room: room?.name ?? "", type: d.type, name: d.name ?? d.id, entity: d.entity });
    }
  return list;
}

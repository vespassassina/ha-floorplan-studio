import { stairSteps } from "./geometry";
import type { CatalogEntry, Device, DeviceType, Layout, Pt } from "./schema";

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const KINDS: [string, string][] = [["rooms", "room"], ["walls", "wall"], ["stairs", "stairs"], ["doors", "door"], ["openings", "opening"], ["extras", "extra"], ["furniture", "furniture"]];
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

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);

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
    for (const o of [...f.stairs, ...f.extras]) o.name = o.name ?? ""; // validate wants text; an older file has none
    for (const t of f.stairs) { t.shape = t.shape ?? "straight"; t.rot = t.rot ?? 0; if (t.shape === "round") t.inner = t.inner ?? 0; t.steps = stairSteps(t); } // steps are derived: a stored value that disagrees is dropped
    if (f.devices !== undefined && !Array.isArray(f.devices)) throw new Error(`Floor "${fname}": devices must be an array`);
    if (f.outline !== undefined && !Array.isArray(f.outline)) throw new Error(`Floor "${fname}": outline must be an array`);
    outlineKinds(f);
    for (const r of f.rooms) { if (r.kind === "outdoor") r.kind = "garden"; r.area = r.area ?? (r.kind === "water" ? "" : slug(String(r.name ?? ""))); r.name = r.name ?? ""; r.label = r.label ?? ""; edgeKinds(r); }
    // S4.24: a door's single `sensor` becomes `sensors`, a list. Always drop the old key, whether or not a new
    // list is already present, so a half-migrated file never keeps both.
    for (const d of f.doors) { if (typeof d.sensor === "string" && d.sensor && !Array.isArray(d.sensors)) d.sensors = [d.sensor]; delete d.sensor; }
    f.devices = (f.devices ?? []).filter(isObj).map((d: any, i: number) => {
      if (v === 1) d.type = RENAME[d.type] ?? d.type;
      d.id = d.id ?? `${d.type}-${fname}-${i + 1}`;
      return d;
    });
    Object.defineProperty(floors, fname, { value: f, enumerable: true, writable: true, configurable: true });
  }
  const out: any = { version: 2, unit: "cm", north: src.north ?? 0, rotate: src.rotate ?? 0, floors, catalog: src.catalog };
  if (src.palette !== undefined) out.palette = src.palette;
  if (src.colors !== undefined) out.colors = src.colors; // passed through; validate judges it. Never invented.
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

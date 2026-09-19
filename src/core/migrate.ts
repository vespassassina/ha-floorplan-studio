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

/** Accepts a v1 or v2 layout and returns a new v2 layout. The input is never changed. */
export function migrate(x: unknown): Layout {
  if (typeof x !== "object" || x === null || Array.isArray(x)) throw new Error("Not a layout: expected a JSON object");
  const src = structuredClone(x) as any;
  const v = src.version ?? 1;
  if (v === 2) return src as Layout;
  if (v !== 1) throw new Error(`Unknown layout version ${v}`);

  const out: any = { version: 2, unit: "cm", north: src.north ?? 0, floors: {}, catalog: src.catalog };
  for (const [fname, f] of Object.entries<any>(src.floors ?? {})) {
    for (const [key, kind] of KINDS) {
      f[key] = f[key] ?? [];
      f[key].forEach((o: any, i: number) => { o.id = o.id ?? `${kind}-${fname}-${i + 1}`; });
    }
    for (const r of f.rooms) r.area = r.area ?? slug(r.name);
    f.devices = (f.devices ?? []).map((d: any, i: number) => {
      d.type = RENAME[d.type] ?? d.type;
      d.id = d.id ?? `${d.type}-${fname}-${i + 1}`;
      return d;
    });
    out.floors[fname] = f;
  }
  for (const c of out.catalog ?? []) c.type = RENAME[c.type] ?? c.type;
  out.catalog = out.catalog ?? buildCatalog(out);
  return out as Layout;
}

function buildCatalog(l: Layout): CatalogEntry[] {
  const list: CatalogEntry[] = [];
  for (const [fname, f] of Object.entries(l.floors))
    for (const d of f.devices as Device[]) {
      const at: Pt = "x" in d ? [d.x, d.y] : [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      const room = f.rooms.find((r) => inside(at, r.pts));
      list.push({ id: d.id, floor: fname, room: room?.name ?? "", type: d.type, name: d.name ?? d.id, entity: d.entity });
    }
  return list;
}

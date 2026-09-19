export type Pt = [number, number];
export type RoomKind = "room" | "outdoor" | "fill" | "terrace" | "structure";
export type DoorKind = "door" | "glass" | "window" | "sealed";
export type DeviceType =
  | "heater" | "light" | "switch" | "plug" | "temp" | "humidity" | "motion"
  | "contact" | "camera" | "climate" | "media" | "cover" | "other";
export type FurnitureSymbol =
  | "table" | "sofa" | "bed" | "cabinet" | "chair" | "sink" | "toilet" | "shower"
  | "bathtub" | "tv" | "computer" | "tree" | "patio-wood" | "patio-concrete" | "car";

export interface Room { id: string; name: string; area: string; label: string; kind: RoomKind; pts: Pt[]; w: boolean[] }
export interface Wall { id: string; a: Pt; b: Pt; kind: "wall" | "boundary" }
export interface Stairs { id: string; name: string; pts: Pt[] }
export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensor?: string; cover?: string }
export interface Opening { id: string; a: Pt; b: Pt }
export interface Extra { id: string; name: string; a: Pt; b: Pt }
export type Device = { id: string; type: DeviceType; entity: string; name?: string } & ({ x: number; y: number } | { a: Pt; b: Pt });
export interface Furniture { id: string; symbol: FurnitureSymbol; x: number; y: number; rot: number; w: number; h: number }
export interface Floor {
  title: string; outline: Pt[]; rooms: Room[]; walls: Wall[]; stairs: Stairs[]; doors: Door[];
  openings: Opening[]; extras: Extra[]; devices: Device[]; furniture: Furniture[];
}
export interface CatalogEntry { id: string; floor: string; room: string; type: DeviceType; name: string; entity: string }
export interface Layout { version: 2; unit: "cm"; north: number; floors: Record<string, Floor>; catalog: CatalogEntry[] }

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const isEntity = (x: unknown) => typeof x === "string" && x.includes(".");

/** Checks a v2 layout. Never throws; returns every problem it finds. */
export function validate(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["layout must be an object"] };
  if (x.version !== 2) errors.push(`version must be 2, got ${String(x.version)}`);
  if (typeof x.north !== "number" || x.north < 0 || x.north >= 360) errors.push("north must be a number in [0, 360)");
  if (!isObj(x.floors)) errors.push("floors must be an object");
  const deviceIds = new Set<string>();
  for (const [fname, f] of Object.entries<any>(isObj(x.floors) ? x.floors : {})) {
    if (!isObj(f)) { errors.push(`floor ${fname} must be an object`); continue; }
    const ids = new Set<string>();
    const seen = (o: any) => {
      if (typeof o?.id !== "string" || !o.id) { errors.push(`floor ${fname}: an object has no id`); return; }
      if (ids.has(o.id)) errors.push(`floor ${fname}: duplicate id ${o.id}`);
      ids.add(o.id);
    };
    const poly = (label: string, pts: unknown) => {
      if (!Array.isArray(pts) || pts.length < 3) errors.push(`floor ${fname}: ${label} needs at least 3 points`);
    };
    poly("outline", f.outline);
    for (const k of ["rooms", "walls", "stairs", "doors", "openings", "extras", "devices", "furniture"])
      if (!Array.isArray(f[k])) errors.push(`floor ${fname}: ${k} must be an array`);
    for (const r of f.rooms ?? []) {
      seen(r);
      poly(`${r.id} pts`, r.pts);
      if (Array.isArray(r.pts) && r.pts.length >= 3 && (!Array.isArray(r.w) || r.w.length !== r.pts.length))
        errors.push(`floor ${fname}: ${r.id} w must have ${r.pts.length} entries`);
    }
    for (const s of f.stairs ?? []) { seen(s); poly(`${s.id} pts`, s.pts); }
    for (const k of ["walls", "openings", "extras", "furniture"]) for (const o of f[k] ?? []) seen(o);
    for (const d of f.doors ?? []) {
      seen(d);
      if (d.sensor !== undefined && !isEntity(d.sensor)) errors.push(`floor ${fname}: ${d.id} sensor must be an entity id like binary_sensor.name`);
      if (d.cover !== undefined && !isEntity(d.cover)) errors.push(`floor ${fname}: ${d.id} cover must be an entity id like cover.name`);
    }
    for (const d of f.devices ?? []) {
      seen(d);
      if (deviceIds.has(d.id)) errors.push(`duplicate device id ${d.id}`);
      deviceIds.add(d.id);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, layout: x as unknown as Layout };
}

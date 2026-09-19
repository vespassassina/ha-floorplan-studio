export type Pt = [number, number];
export type RoomKind = "room" | "outdoor" | "fill" | "terrace" | "structure" | "zone" | "water";
export type DoorKind = "door" | "glass" | "window" | "sealed";
export type DeviceType =
  | "heater" | "light" | "switch" | "plug" | "temp" | "humidity" | "motion"
  | "contact" | "camera" | "climate" | "media" | "cover" | "other";
export type FurnitureSymbol =
  | "table" | "sofa" | "bed" | "cabinet" | "chair" | "sink" | "toilet" | "shower"
  | "bathtub" | "tv" | "computer" | "tree" | "patio-wood" | "patio-concrete" | "car";

export interface Room { id: string; name: string; area: string; label: string; kind: RoomKind; pts: Pt[]; w: boolean[] }
export type WallKind = "wall" | "boundary" | "external" | "fence" | "edge";
export interface Wall { id: string; a: Pt; b: Pt; kind: WallKind }
export interface Stairs { id: string; name: string; pts: Pt[] }
export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensor?: string; cover?: string }
export interface Opening { id: string; a: Pt; b: Pt }
export interface Extra { id: string; name: string; a: Pt; b: Pt }
/** `bound` (lights only): the switch or plug that powers the same lamp. One icon on the plan, two entities in HA. */
export type Device = { id: string; type: DeviceType; entity: string; name?: string; bound?: string } & ({ x: number; y: number } | { a: Pt; b: Pt });
export interface Furniture { id: string; symbol: FurnitureSymbol; x: number; y: number; rot: number; w: number; h: number }
export interface Floor {
  title: string; outline: Pt[]; rooms: Room[]; walls: Wall[]; stairs: Stairs[]; doors: Door[];
  openings: Opening[]; extras: Extra[]; devices: Device[]; furniture: Furniture[];
}
export interface CatalogEntry { id: string; floor: string; room: string; type: DeviceType; name: string; entity: string }
export interface Layout { version: 2; unit: "cm"; north: number; floors: Record<string, Floor>; catalog: CatalogEntry[] }

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const isEntity = (x: unknown) => typeof x === "string" && x.includes(".");
const isPt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

export const ROOM_KINDS: readonly RoomKind[] = ["room", "outdoor", "fill", "terrace", "structure", "zone", "water"];
export const WALL_KINDS: readonly WallKind[] = ["wall", "boundary", "external", "fence", "edge"];
export const DOOR_KINDS: readonly DoorKind[] = ["door", "glass", "window", "sealed"];
export const DEVICE_TYPES: readonly DeviceType[] = ["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "media", "cover", "other"];
export const FURNITURE_SYMBOLS: readonly FurnitureSymbol[] = ["table", "sofa", "bed", "cabinet", "chair", "sink", "toilet", "shower", "bathtub", "tv", "computer", "tree", "patio-wood", "patio-concrete", "car"];

/** Checks a v2 layout. Never throws; returns every problem it finds. */
export function validate(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["layout must be an object"] };
  if (x.version !== 2) errors.push(`version must be 2, got ${String(x.version)}`);
  if (typeof x.north !== "number" || !Number.isFinite(x.north) || x.north < 0 || x.north >= 360) errors.push("north must be a number in [0, 360)");
  if (!isObj(x.floors)) errors.push("floors must be an object");
  const deviceIds = new Set<string>();
  const boundBy = new Map<string, string>(); // bound entity -> first device id that uses it
  const entityOf = new Map<string, string>(); // entity -> device id, across floors
  const bounds: { id: string; bound: string }[] = [];
  for (const [fname, f] of Object.entries<any>(isObj(x.floors) ? x.floors : {})) {
    if (!isObj(f)) { errors.push(`floor ${fname} must be an object`); continue; }
    const at = `floor ${fname}:`;
    const ids = new Set<string>();
    const seen = (o: any) => {
      if (typeof o.id !== "string" || !o.id) { errors.push(`${at} an object has no id`); return; }
      if (ids.has(o.id)) errors.push(`${at} duplicate id ${o.id}`);
      ids.add(o.id);
    };
    const poly = (label: string, pts: unknown) => {
      if (!Array.isArray(pts) || pts.length < 3) errors.push(`${at} ${label} needs at least 3 points`);
      else if (!pts.every(isPt)) errors.push(`${at} ${label} has a point that is not [x, y] numbers`);
    };
    const oneOf = (label: string, v: unknown, allowed: readonly string[]) => {
      if (typeof v !== "string" || !allowed.includes(v)) errors.push(`${at} ${label} must be one of ${allowed.join(", ")}`);
    };
    const name = (o: any) => { if (typeof o.name !== "string") errors.push(`${at} ${o.id} needs a name (text)`); };
    const optText = (o: any, k: string) => { if (o[k] !== undefined && typeof o[k] !== "string") errors.push(`${at} ${o.id} ${k} must be text`); };
    const each = (k: string, fn: (o: any) => void) => {
      if (!Array.isArray(f[k])) { errors.push(`${at} ${k} must be an array`); return; }
      for (const o of f[k]) {
        if (!isObj(o)) { errors.push(`${at} ${k} has an entry that is not an object`); continue; }
        seen(o);
        fn(o);
      }
    };
    poly("outline", f.outline);
    each("rooms", (r) => {
      poly(`${r.id} pts`, r.pts);
      name(r); // migrate turns a missing name into "", so a name that is still not text is a bad file
      if (typeof r.label !== "string") errors.push(`${at} ${r.id} label must be text`);
      oneOf(`${r.id} kind`, r.kind, ROOM_KINDS);
      if (Array.isArray(r.pts) && r.pts.length >= 3 && (!Array.isArray(r.w) || r.w.length !== r.pts.length))
        errors.push(`${at} ${r.id} w must have ${r.pts.length} entries`);
      else if (r.kind === "zone" && Array.isArray(r.w) && r.w.some((v: unknown) => v !== false))
        errors.push(`${at} ${r.id} is a zone and cannot have a wall edge: every w entry must be false`);
    });
    each("walls", (w) => {
      oneOf(`${w.id} kind`, w.kind, WALL_KINDS);
      if (!isPt(w.a) || !isPt(w.b)) errors.push(`${at} ${w.id} needs points a and b`);
    });
    each("stairs", (s) => { name(s); poly(`${s.id} pts`, s.pts); });
    each("doors", (d) => {
      name(d);
      oneOf(`${d.id} kind`, d.kind, DOOR_KINDS);
      if (!isPt(d.a) || !isPt(d.b)) errors.push(`${at} ${d.id} needs points a and b`);
      if (d.sensor !== undefined && !isEntity(d.sensor)) errors.push(`${at} ${d.id} sensor must be an entity id like binary_sensor.name`);
      if (d.cover !== undefined && !isEntity(d.cover)) errors.push(`${at} ${d.id} cover must be an entity id like cover.name`);
    });
    each("openings", (o) => { if (!isPt(o.a) || !isPt(o.b)) errors.push(`${at} ${o.id} needs points a and b`); });
    each("extras", (o) => { name(o); if (!isPt(o.a) || !isPt(o.b)) errors.push(`${at} ${o.id} needs points a and b`); });
    each("devices", (d) => {
      oneOf(`${d.id} type`, d.type, DEVICE_TYPES);
      optText(d, "name");
      if (!(typeof d.x === "number" && Number.isFinite(d.x) && typeof d.y === "number" && Number.isFinite(d.y)) && !(isPt(d.a) && isPt(d.b)))
        errors.push(`${at} ${d.id} needs x and y, or a and b`);
      if (typeof d.id === "string") {
        if (deviceIds.has(d.id)) errors.push(`duplicate device id ${d.id}`);
        deviceIds.add(d.id);
      }
      if (typeof d.entity === "string") entityOf.set(d.entity, String(d.id));
      if (d.bound !== undefined) {
        if (!isEntity(d.bound)) errors.push(`${at} ${d.id} bound must be an entity id like switch.name`);
        else {
          if (d.type !== "light") errors.push(`${at} ${d.id} bound is only allowed on a light`);
          if (d.bound === d.entity) errors.push(`${at} ${d.id} bound must differ from entity`);
          if (boundBy.has(d.bound)) errors.push(`bound ${d.bound} is used by more than one device (${boundBy.get(d.bound)}, ${d.id})`);
          else boundBy.set(d.bound, String(d.id));
          bounds.push({ id: String(d.id), bound: d.bound });
        }
      }
    });
    each("furniture", (m) => {
      oneOf(`${m.id} symbol`, m.symbol, FURNITURE_SYMBOLS);
      for (const k of ["x", "y", "rot", "w", "h"]) if (typeof m[k] !== "number" || !Number.isFinite(m[k])) errors.push(`${at} ${m.id} ${k} must be a number`);
    });
  }
  for (const b of bounds) {
    const other = entityOf.get(b.bound);
    if (other !== undefined && other !== b.id) errors.push(`${b.id} bound ${b.bound} is also the entity of another device (${other})`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, layout: x as unknown as Layout };
}

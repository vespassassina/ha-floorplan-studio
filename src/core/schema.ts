export type Pt = [number, number];
export type RoomKind = "room" | "garden" | "pavement" | "fill" | "terrace" | "structure" | "zone" | "water";
export type DoorKind = "door" | "glass" | "window" | "sealed";
export type DeviceType =
  | "heater" | "light" | "switch" | "plug" | "temp" | "humidity" | "motion"
  | "contact" | "camera" | "climate" | "ac" | "tv" | "computer" | "media" | "cover" | "other";
export type FurnitureSymbol =
  | "table" | "sofa" | "bed" | "cabinet" | "chair" | "sink" | "toilet" | "shower"
  | "bathtub" | "tv" | "computer" | "tree" | "patio-wood" | "patio-concrete" | "car";

export interface Room { id: string; name: string; area: string; label: string; kind: RoomKind; pts: Pt[]; wk: WallKind[]; color?: string; free?: boolean }
export type WallKind = "wall" | "boundary" | "external" | "fence" | "edge";
export interface Wall { id: string; a: Pt; b: Pt; kind: WallKind }
export type StairShape = "straight" | "round";
/** `dia` (outer) and `inner` (the empty well) exist on a round stair only; `pts` is its outer circle as a polygon. `rot` turns it about the centre of its box. */
export interface Stairs { id: string; name: string; pts: Pt[]; shape: StairShape; steps: number; rot: number; dia?: number; inner?: number }
export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensor?: string; cover?: string }
export interface Opening { id: string; a: Pt; b: Pt }
export interface Extra { id: string; name: string; a: Pt; b: Pt }
/** `bound` (lights only): the switch or plug that powers the same lamp. One icon on the plan, two entities in HA. Several lights may share one switch, and the switch may be an icon too. */
export type Device = { id: string; type: DeviceType; entity: string; name?: string; bound?: string; rot?: number } & ({ x: number; y: number } | { a: Pt; b: Pt });
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

export const ROOM_KINDS: readonly RoomKind[] = ["room", "garden", "pavement", "fill", "terrace", "structure", "zone", "water"];
export const WALL_KINDS: readonly WallKind[] = ["wall", "boundary", "external", "fence", "edge"];
export const STAIR_SHAPES: readonly StairShape[] = ["straight", "round"];
export const DOOR_KINDS: readonly DoorKind[] = ["door", "glass", "window", "sealed"];
export const DEVICE_TYPES: readonly DeviceType[] = ["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "ac", "tv", "computer", "media", "cover", "other"];
export const FURNITURE_SYMBOLS: readonly FurnitureSymbol[] = ["table", "sofa", "bed", "cabinet", "chair", "sink", "toilet", "shower", "bathtub", "tv", "computer", "tree", "patio-wood", "patio-concrete", "car"];

/** Checks a v2 layout. Never throws; returns every problem it finds. */
export function validate(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["layout must be an object"] };
  if (x.version !== 2) errors.push(`version must be 2, got ${String(x.version)}`);
  if (typeof x.north !== "number" || !Number.isFinite(x.north) || x.north < 0 || x.north >= 360) errors.push("north must be a number in [0, 360)");
  if (!isObj(x.floors)) errors.push("floors must be an object");
  const deviceIds = new Set<string>();
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
      if (r.color !== undefined && !(typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color)))
        errors.push(`${at} ${r.id} color must be a colour like #aabbcc`);
      if (r.free !== undefined && typeof r.free !== "boolean") errors.push(`${at} ${r.id} free must be true or false`);
      if (Array.isArray(r.pts) && r.pts.length >= 3 && (!Array.isArray(r.wk) || r.wk.length !== r.pts.length))
        errors.push(`${at} ${r.id} wk must have ${r.pts.length} entries`);
      else if (Array.isArray(r.wk)) {
        if (r.wk.some((k: unknown) => typeof k !== "string" || !WALL_KINDS.includes(k as WallKind)))
          errors.push(`${at} ${r.id} wk entries must be one of ${WALL_KINDS.join(", ")}`);
        else if (r.kind === "zone" && r.wk.some((k: unknown) => k !== "boundary"))
          errors.push(`${at} ${r.id} is a zone and cannot have a wall edge: every wk entry must be boundary`);
      }
    });
    each("walls", (w) => {
      oneOf(`${w.id} kind`, w.kind, WALL_KINDS);
      if (!isPt(w.a) || !isPt(w.b)) errors.push(`${at} ${w.id} needs points a and b`);
    });
    each("stairs", (s) => {
      name(s); poly(`${s.id} pts`, s.pts);
      oneOf(`${s.id} shape`, s.shape, STAIR_SHAPES);
      if (!Number.isInteger(s.steps) || s.steps < 2 || s.steps > 40) errors.push(`${at} ${s.id} steps must be a whole number from 2 to 40`);
      if (!(typeof s.rot === "number" && Number.isFinite(s.rot) && s.rot >= 0 && s.rot < 360)) errors.push(`${at} ${s.id} rot must be a number in [0, 360)`);
      const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
      if (s.shape === "round") {
        if (!fin(s.dia) || s.dia < 40) errors.push(`${at} ${s.id} dia must be a number of at least 40`);
        else if (!fin(s.inner) || s.inner < 0 || s.inner > s.dia - 40) errors.push(`${at} ${s.id} inner must be a number from 0 to dia - 40`);
      } else if (s.shape === "straight") {
        if (s.dia !== undefined) errors.push(`${at} ${s.id} dia is only for a round stair`);
        if (s.inner !== undefined) errors.push(`${at} ${s.id} inner is only for a round stair`);
      }
    });
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
      if (d.rot !== undefined && !(typeof d.rot === "number" && Number.isFinite(d.rot) && d.rot >= 0 && d.rot < 360))
        errors.push(`${at} ${d.id} rot must be a number in [0, 360)`);
      if (typeof d.id === "string") {
        if (deviceIds.has(d.id)) errors.push(`duplicate device id ${d.id}`);
        deviceIds.add(d.id);
      }
      if (d.bound !== undefined) {
        if (!isEntity(d.bound)) errors.push(`${at} ${d.id} bound must be an entity id like switch.name`);
        else {
          if (d.type !== "light") errors.push(`${at} ${d.id} bound is only allowed on a light`);
          if (d.bound === d.entity) errors.push(`${at} ${d.id} bound must differ from entity`);
        }
      }
    });
    each("furniture", (m) => {
      oneOf(`${m.id} symbol`, m.symbol, FURNITURE_SYMBOLS);
      for (const k of ["x", "y", "rot", "w", "h"]) if (typeof m[k] !== "number" || !Number.isFinite(m[k])) errors.push(`${at} ${m.id} ${k} must be a number`);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, layout: x as unknown as Layout };
}

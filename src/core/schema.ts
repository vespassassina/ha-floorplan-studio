import { TEXTURE_IDS } from "./textures";
export type Pt = [number, number];
export type RoomKind = "room" | "garden" | "pavement" | "fill" | "terrace" | "structure" | "zone" | "water";
export type DoorKind = "door" | "glass" | "window" | "sealed";
export type DeviceType =
  | "heater" | "light" | "switch" | "plug" | "temp" | "humidity" | "motion"
  | "contact" | "camera" | "climate" | "ac" | "tv" | "computer" | "media" | "cover"
  | "battery" | "inverter" | "server" | "access_point" | "lock" | "vibration" | "other";
export type FurnitureSymbol =
  | "table" | "sofa" | "bed" | "cabinet" | "chair" | "sink" | "toilet" | "shower"
  | "bathtub" | "tv" | "computer" | "tree" | "patio-wood" | "patio-concrete" | "car";

/** The twelve floor materials offered as swatches in the room panel (S1.35). Any #rrggbb is still valid on a room. */
export const FLOOR_COLOURS: { name: string; hex: string }[] = [
  { name: "White ceramic", hex: "#f4f4f0" }, { name: "Marble", hex: "#e2dfda" }, { name: "Sand", hex: "#e6d5b8" },
  { name: "Terracotta", hex: "#c98a63" }, { name: "Light oak", hex: "#d8bd94" }, { name: "Warm wood", hex: "#b98b5c" },
  { name: "Dark oak", hex: "#86643f" }, { name: "Walnut", hex: "#5b4130" }, { name: "Light grey", hex: "#b4b6b8" },
  { name: "Grey floor", hex: "#8b8e91" }, { name: "Belgian stone", hex: "#4d4e50" }, { name: "Lava", hex: "#38393b" },
];

/** Most extra colours a layout keeps in `palette`. */
export const MAX_PALETTE = 24;

/** `area` is the HA area id, or empty for a custom shape. `entity` (custom shapes only) is the HA entity whose state the shape shows. */
export interface Room { id: string; name: string; area: string; label: string; kind: RoomKind; pts: Pt[]; wk: EdgeKind[]; color?: string; texture?: string; textureRot?: number; free?: boolean; entity?: string }
export type WallKind = "wall" | "boundary" | "external" | "fence" | "edge";
/** A room edge is a wall kind, or "none": not drawn. The room stays closed for area and snapping. */
export type EdgeKind = WallKind | "none";
/** `locked` (S4.9): the segment's length is fixed. Dragging an endpoint then only pivots it, on an arc around the other endpoint. */
export interface Wall { id: string; a: Pt; b: Pt; kind: WallKind; locked?: boolean }
export type StairShape = "straight" | "round";
/** `dia` (outer) and `inner` (the empty well) exist on a round stair only; `pts` is its outer circle as a polygon. `rot` turns it about the centre of its box. */
export interface Stairs { id: string; name: string; pts: Pt[]; shape: StairShape; steps: number; rot: number; dia?: number; inner?: number; color?: string; texture?: string; textureRot?: number }
/**
 * `sensors`/`vibration`/`locks` (S4.24): every contact sensor, vibration sensor and smart lock attached to
 * this door or window — several of each allowed. `cover` (a curtain/blind entity) is not restricted by
 * kind — a plain door's garage opener is a cover too — it just doubles as the electric-curtain field on a
 * glass door or window.
 */
export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensors?: string[]; vibration?: string[]; locks?: string[]; cover?: string; locked?: boolean }
export interface Opening { id: string; a: Pt; b: Pt; locked?: boolean }
export interface Extra { id: string; name: string; a: Pt; b: Pt }
/**
 * `bound` (lights only): the switch or plug that powers the same lamp. One icon on the plan, two entities in
 * HA. Several lights may share one switch, and the switch may be an icon too.
 * `trvs`/`tempSensors` (heater only) and `linked` (ac only), S4.24: every climate/TRV or temperature-sensor
 * entity attached to this device — several allowed, unlike `bound`.
 */
export type Device = { id: string; type: DeviceType; entity: string; name?: string; bound?: string; trvs?: string[]; tempSensors?: string[]; linked?: string[]; rot?: number } & ({ x: number; y: number } | { a: Pt; b: Pt });
/** `name` is a plan name; `entity` is an HA entity whose state the piece shows. Both optional. */
export interface Furniture { id: string; symbol: FurnitureSymbol; x: number; y: number; rot: number; w: number; h: number; name?: string; entity?: string }
/** `ha` is the HA floor id this floor is; when set, `title` is the name HA gave it. */
export interface Floor {
  ha?: string; title: string; outline: Pt[]; owk?: EdgeKind[]; rooms: Room[]; walls: Wall[]; stairs: Stairs[]; doors: Door[];
  openings: Opening[]; extras: Extra[]; devices: Device[]; furniture: Furniture[];
}
export interface CatalogEntry { id: string; floor: string; room: string; type: DeviceType; name: string; entity: string }
/** `rotate`: the whole plan turned on screen, clockwise, in steps of 45 degrees. The stored coordinates are never turned. */
export interface Layout { version: 2; unit: "cm"; north: number; rotate?: number; colors?: Partial<Record<DeviceType, string>>; palette?: string[]; floors: Record<string, Floor>; catalog: CatalogEntry[] }

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const isEntity = (x: unknown) => typeof x === "string" && x.includes(".");
const isPt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

export const ROOM_KINDS: readonly RoomKind[] = ["room", "garden", "pavement", "fill", "terrace", "structure", "zone", "water"];
export const WALL_KINDS: readonly WallKind[] = ["wall", "boundary", "external", "fence", "edge"];
export const EDGE_KINDS: readonly EdgeKind[] = [...WALL_KINDS, "none"];
export const STAIR_SHAPES: readonly StairShape[] = ["straight", "round"];
export const DOOR_KINDS: readonly DoorKind[] = ["door", "glass", "window", "sealed"];
export const DEVICE_TYPES: readonly DeviceType[] = ["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "ac", "tv", "computer", "media", "cover", "battery", "inverter", "server", "access_point", "lock", "vibration", "other"];
export const FURNITURE_SYMBOLS: readonly FurnitureSymbol[] = ["table", "sofa", "bed", "cabinet", "chair", "sink", "toilet", "shower", "bathtub", "tv", "computer", "tree", "patio-wood", "patio-concrete", "car"];

/** Checks a v2 layout. Never throws; returns every problem it finds. */
export function validate(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["layout must be an object"] };
  if (x.version !== 2) errors.push(`version must be 2, got ${String(x.version)}`);
  if (typeof x.north !== "number" || !Number.isFinite(x.north) || x.north < 0 || x.north >= 360) errors.push("north must be a number in [0, 360)");
  if (x.rotate !== undefined && !(typeof x.rotate === "number" && Number.isInteger(x.rotate) && x.rotate >= 0 && x.rotate < 360 && x.rotate % 45 === 0))
    errors.push("rotate must be a multiple of 45 in [0, 360)");
  if (x.palette !== undefined) {
    if (!Array.isArray(x.palette)) errors.push("palette must be a list of colours");
    else if (x.palette.length > MAX_PALETTE) errors.push(`palette holds at most ${MAX_PALETTE} colours`);
    else x.palette.forEach((v: unknown, i: number) => { if (!(typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v))) errors.push(`palette[${i}] must be a colour like #aabbcc`); });
  }
  if (x.colors !== undefined) {
    if (!isObj(x.colors)) errors.push("colors must be an object");
    else for (const [t, v] of Object.entries(x.colors)) {
      if (!(DEVICE_TYPES as readonly string[]).includes(t)) errors.push(`colors.${t}: not a device type`);
      else if (!(typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v))) errors.push(`colors.${t} must be a colour like #aabbcc`);
    }
  }
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
    if (f.ha !== undefined && !(typeof f.ha === "string" && f.ha)) errors.push(`${at} ha must be a non-empty text (the HA floor id)`);
    poly("outline", f.outline);
    // S1.52: owk is optional (migrate fills it), but once present it must match the outline point by point.
    if (f.owk !== undefined) {
      if (!Array.isArray(f.outline) || !Array.isArray(f.owk) || f.owk.length !== f.outline.length) errors.push(`${at} owk must have ${Array.isArray(f.outline) ? f.outline.length : 0} entries`);
      else if (f.owk.some((k: unknown) => typeof k !== "string" || !EDGE_KINDS.includes(k as EdgeKind))) errors.push(`${at} owk entries must be one of ${EDGE_KINDS.join(", ")}`);
    }
    each("rooms", (r) => {
      poly(`${r.id} pts`, r.pts);
      name(r); // migrate turns a missing name into "", so a name that is still not text is a bad file
      if (typeof r.label !== "string") errors.push(`${at} ${r.id} label must be text`);
      oneOf(`${r.id} kind`, r.kind, ROOM_KINDS);
      if (r.color !== undefined && !(typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color)))
        errors.push(`${at} ${r.id} color must be a colour like #aabbcc`);
      if (r.texture !== undefined && !TEXTURE_IDS.includes(r.texture as string)) errors.push(`${at} ${r.id} texture must be one of ${TEXTURE_IDS.join(", ")}`);
      if (r.textureRot !== undefined && !(typeof r.textureRot === "number" && Number.isFinite(r.textureRot) && r.textureRot >= 0 && r.textureRot < 360))
        errors.push(`${at} ${r.id} textureRot must be a number in [0, 360)`);
      if (typeof r.area !== "string") errors.push(`${at} ${r.id} area must be text (empty for a custom shape)`);
      if (r.entity !== undefined && !isEntity(r.entity)) errors.push(`${at} ${r.id} entity must be an entity id like sensor.name`);
      if (r.free !== undefined && typeof r.free !== "boolean") errors.push(`${at} ${r.id} free must be true or false`);
      if (Array.isArray(r.pts) && r.pts.length >= 3 && (!Array.isArray(r.wk) || r.wk.length !== r.pts.length))
        errors.push(`${at} ${r.id} wk must have ${r.pts.length} entries`);
      else if (Array.isArray(r.wk)) {
        if (r.wk.some((k: unknown) => typeof k !== "string" || !EDGE_KINDS.includes(k as EdgeKind)))
          errors.push(`${at} ${r.id} wk entries must be one of ${EDGE_KINDS.join(", ")}`);
        else if (r.kind === "zone" && r.wk.some((k: unknown) => k !== "boundary"))
          errors.push(`${at} ${r.id} is a zone and cannot have a wall edge: every wk entry must be boundary`);
      }
    });
    each("walls", (w) => {
      oneOf(`${w.id} kind`, w.kind, WALL_KINDS);
      if (!isPt(w.a) || !isPt(w.b)) errors.push(`${at} ${w.id} needs points a and b`);
      if (w.locked !== undefined && typeof w.locked !== "boolean") errors.push(`${at} ${w.id} locked must be true or false`);
    });
    each("stairs", (s) => {
      name(s); poly(`${s.id} pts`, s.pts);
      if (s.color !== undefined && !(typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color))) errors.push(`${at} ${s.id} color must be a colour like #aabbcc`);
      if (s.texture !== undefined && !TEXTURE_IDS.includes(s.texture as string)) errors.push(`${at} ${s.id} texture must be one of ${TEXTURE_IDS.join(", ")}`);
      if (s.textureRot !== undefined && !(typeof s.textureRot === "number" && Number.isFinite(s.textureRot) && s.textureRot >= 0 && s.textureRot < 360))
        errors.push(`${at} ${s.id} textureRot must be a number in [0, 360)`);
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
    const entityList = (o: any, k: string, label: string) => {
      if (o[k] === undefined) return;
      if (!Array.isArray(o[k])) { errors.push(`${at} ${o.id} ${k} must be a list of entity ids`); return; }
      o[k].forEach((v: unknown, i: number) => { if (!isEntity(v)) errors.push(`${at} ${o.id} ${k}[${i}] must be an entity id like ${label}`); });
    };
    each("doors", (d) => {
      name(d);
      oneOf(`${d.id} kind`, d.kind, DOOR_KINDS);
      if (!isPt(d.a) || !isPt(d.b)) errors.push(`${at} ${d.id} needs points a and b`);
      entityList(d, "sensors", "binary_sensor.name");
      entityList(d, "vibration", "binary_sensor.name");
      entityList(d, "locks", "lock.name");
      // `cover` is not restricted to a glass door or a window: a plain door's roller shutter or garage opener is
      // a cover entity too (the demo's "Garage door" is `kind: "door"` with a `cover`). S4.24's electric curtain
      // dropdown reuses this same field, just offered on every door kind, same as before.
      if (d.cover !== undefined && !isEntity(d.cover)) errors.push(`${at} ${d.id} cover must be an entity id like cover.name`);
      if (d.locked !== undefined && typeof d.locked !== "boolean") errors.push(`${at} ${d.id} locked must be true or false`);
    });
    each("openings", (o) => {
      if (!isPt(o.a) || !isPt(o.b)) errors.push(`${at} ${o.id} needs points a and b`);
      if (o.locked !== undefined && typeof o.locked !== "boolean") errors.push(`${at} ${o.id} locked must be true or false`);
    });
    each("extras", (o) => { name(o); if (!isPt(o.a) || !isPt(o.b)) errors.push(`${at} ${o.id} needs points a and b`); });
    each("devices", (d) => {
      oneOf(`${d.id} type`, d.type, DEVICE_TYPES);
      optText(d, "name");
      if (d.entity !== "" && !isEntity(d.entity)) errors.push(`${at} ${d.id} entity must be an entity id like light.name`);
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
      if (d.trvs !== undefined || d.tempSensors !== undefined) {
        entityList(d, "trvs", "climate.name");
        entityList(d, "tempSensors", "sensor.name");
        if (d.type !== "heater") errors.push(`${at} ${d.id} trvs/tempSensors are only allowed on a heater`);
      }
      if (d.linked !== undefined) {
        entityList(d, "linked", "climate.name");
        if (d.type !== "ac") errors.push(`${at} ${d.id} linked is only allowed on an ac`);
      }
    });
    each("furniture", (m) => {
      oneOf(`${m.id} symbol`, m.symbol, FURNITURE_SYMBOLS);
      optText(m, "name");
      if (m.entity !== undefined && !isEntity(m.entity)) errors.push(`${at} ${m.id} entity must be an entity id like sensor.name`);
      for (const k of ["x", "y", "rot", "w", "h"]) if (typeof m[k] !== "number" || !Number.isFinite(m[k])) errors.push(`${at} ${m.id} ${k} must be a number`);
      // S1.51: a piece of furniture is never smaller than 5 cm or bigger than 2000 cm on a side.
      for (const k of ["w", "h"] as const) if (typeof m[k] === "number" && Number.isFinite(m[k]) && (m[k] < 5 || m[k] > 2000)) errors.push(`${at} ${m.id} ${k} must be between 5 and 2000`);
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, layout: x as unknown as Layout };
}

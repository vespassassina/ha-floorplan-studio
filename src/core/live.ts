// What the live state says about one floor, as plain JSON for the card's 3D view (S12.5). Every decision here is the 2D
// plan's own: this file only calls the helpers renderFloor calls (classOf, deviceMarkup, doorStateOf, motionRooms, roomAt,
// roomReadout), so the two views cannot disagree about which room is lit, which door is open or what an icon wears.
// The 3D chunk imports nothing from core, so it gets this object and draws it. A layout is untrusted (CLAUDE.md finding 1):
// nothing here throws, and a piece that cannot be read is null.
import { doorStateOf, type DoorState } from "./door-state";
import { acMode, attachedTest, deviceColourVars, deviceMarkup, lightFill, lightOpacity, MOTION_PULSE_S, MOTION_PULSES, motionRooms, personRoom, polyCentre, roomAt, roomReadout, ROOM_OWNS, type RenderOpts } from "./render";
import type { Device, Floor, Pt } from "./schema";

export interface LiveLight { device: number; room: number; at: Pt; /** The lamp's own CSS colour, or null for the theme's light colour. */ rgb: string | null; /** 0..1 */ level: number }
export interface LiveDevice {
  type: string;
  /** The classes of the icon group (`dev dev-light on`), the same string the plan writes. */
  klass: string;
  /** Custom properties of the icon group (`--fp-dev-fill:...;--fp-fade:...`). */
  style: string;
  /** The inner markup of the icon: rings, halo, glyph. Built from the inlined icon table, never from the layout. */
  icon: string;
  name: string;
  /** A sensor's reading as the plan prints it ("21.5 °C", "–"), or "". */
  value: string;
  /** `on`, `off`, `unavailable` or `danger`. */
  state: string;
  /** A speaker or media device that is playing. */
  playing: boolean;
  /** A person's room sensor names a room: the centre of that room, else absent (the device's own point). */
  at?: Pt;
}
export interface LiveRoom { name: string; at: Pt; readout: string; motion: { radar: boolean; on: boolean; v: number; pulseAge: number | null } | null }
export interface Live3D {
  night: boolean; labels: boolean; names: boolean;
  /** How many times a tripped room's edge pulses, and how long one pulse is in seconds: the plan's own figures. */
  pulse: [number, number];
  /** `--fp-dev-<type>:#rrggbb;...`, the layout's own device colours, for the overlay's root. */
  colours: string;
  lights: LiveLight[];
  doors: (DoorState | null)[];
  /** Per device index; null for a room's own sensor (it draws no icon of its own, DECISIONS S11.1). */
  devices: (LiveDevice | null)[];
  rooms: (LiveRoom | null)[];
}

const isPt = (p: unknown): p is Pt => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const ringOf = (r: { pts?: unknown } | null | undefined): Pt[] | null => (r && Array.isArray(r.pts) && r.pts.length >= 3 && r.pts.every(isPt) ? (r.pts as Pt[]) : null);
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

export function liveOf(floor: Floor, o: RenderOpts, now: number): Live3D {
  const f = (typeof floor === "object" && floor !== null ? floor : {}) as Floor;
  const devices = list<Device>(f.devices), rooms = list<Floor["rooms"][number]>(f.rooms);
  // The helpers read `r.temps` and `d.type` without a guard, so a slot that is not an object becomes an inert one of the same index.
  const solid = <T>(x: T, dummy: unknown): T => (typeof x === "object" && x !== null ? x : (dummy as T));
  const safe = { ...f, devices: devices.map((d) => solid(d, { type: "other", entity: "" })), rooms: rooms.map((r) => solid(r, { kind: "structure", pts: null })), doors: list(f.doors).map((d) => solid(d, { kind: "door" })) } as Floor;
  const isAttached = attachedTest(safe);
  const lights: LiveLight[] = [], out: (LiveDevice | null)[] = [];
  devices.forEach((d, i) => {
    out.push(null);
    try {
      if (typeof d !== "object" || d === null || isAttached(d)) return;
      const p = d as { x?: number; y?: number; a?: Pt; b?: Pt };
      const at: Pt | null = isPt([p.x, p.y]) ? [p.x as number, p.y as number] : isPt(p.a) && isPt(p.b) ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2] : null;
      if (!at) return;
      const { cls, base, style, icon, s } = deviceMarkup(safe, d, o, now, at);
      const bound = d.type === "light" && d.bound ? " bound" : "";
      const ac = d.type === "ac" ? ` ${acMode(d, o) ?? ""}`.trimEnd() : "";
      let value = "";
      if ((d.type === "temp" || d.type === "humidity") && s) {
        const bad = !/^-?\d+(\.\d+)?$/.test(s.state.trim()) || !Number.isFinite(Number(s.state));
        value = bad ? "–" : s.state + (typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "");
      }
      const where = d.type === "person" ? personRoom(d, rooms, o) : -1, ring = where >= 0 ? ringOf(rooms[where]) : null;
      out[i] = { type: String(d.type), klass: `dev dev-${d.type}${ac}${bound} ${cls}`, style: style.join(";"), icon, name: String(d.name ?? d.id ?? ""), value, state: base, playing: (d.type === "speaker" || d.type === "media") && s?.state === "playing", ...(ring ? { at: polyCentre(ring) } : {}) };
      if (d.type === "light" && base === "on") {
        const st = o.state?.[d.entity];
        lights.push({ device: i, room: roomAt(safe, at), at, rgb: lightFill(st), level: lightOpacity(st) ?? 1 });
      }
    } catch { /* a device that cannot be read draws nothing */ }
  });
  const doors = list<Floor["doors"][number]>(f.doors).map((d) => { try { return typeof d === "object" && d !== null ? doorStateOf(d, o.state) : null; } catch { return null; } });
  let motion: ReturnType<typeof motionRooms> = { triggered: new Map(), pulsing: new Map() };
  try { motion = motionRooms(safe, o, now); } catch { /* no rings */ }
  const liveRooms = rooms.map((r, i): LiveRoom | null => {
    try {
      const p = ringOf(r);
      if (!p || typeof r !== "object") return null;
      const m = motion.triggered.get(i), owns = ROOM_OWNS[r.kind];
      return { name: typeof r.name === "string" && r.kind !== "structure" ? r.name : "", at: polyCentre(p), readout: owns ? roomReadout(r, o.state) : "", motion: m ? { radar: m.radar, on: m.on, v: m.v, pulseAge: motion.pulsing.get(i) ?? null } : null };
    } catch { return null; }
  });
  return { pulse: [MOTION_PULSES, MOTION_PULSE_S], night: !!o.night, labels: o.labels !== false, names: !!o.showNames, colours: deviceColourVars(o.colors).join(";"), lights, doors, devices: out, rooms: liveRooms };
}

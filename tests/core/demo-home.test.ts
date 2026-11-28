import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import home from "../../demo/home.json";
import { migrate } from "../../src/core/migrate";
import { validate, DEVICE_TYPES, FURNITURE_SYMBOLS, type Layout, type Pt } from "../../src/core/schema";
import { roomAt } from "../../src/core/render";

// S36.2: the demo home, `demo/home.json`. It is what File > Load demo puts in and what the README shows; `demo/layout.json`
// stays the test fixture. Everything here reads the shipped file, never a copy, so an edit to the home that breaks one of
// these promises fails here first.

const L = home as unknown as Layout;
const states = JSON.parse(readFileSync("demo/home-states.json", "utf8")) as Record<string, { state?: unknown; attributes?: unknown; last_changed?: unknown }>;
const floors = Object.entries(L.floors);
const ENTITY = /^[a-z_]+\.demo_[a-z0-9_]+$/;

/** Every entity id the plan names, wherever it keeps one: devices and what hangs on them, doors, rooms, furniture, appliances. */
function entitiesOf(l: Layout): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v) out.add(v); };
  const list = (v: unknown) => { if (Array.isArray(v)) v.forEach(add); };
  for (const f of Object.values(l.floors)) {
    for (const d of f.devices) {
      add(d.entity); add(d.bound); add(d.motion); add(d.power); add(d.room);
      list(d.trvs); list(d.tempSensors); list(d.linked); list(d.airSensors);
      for (const t of d.targets ?? []) { add(t.x); add(t.y); }
    }
    for (const d of f.doors) { list(d.sensors); list(d.vibration); list(d.locks); add(d.cover); }
    for (const r of f.rooms) { add(r.entity); list(r.temps); list(r.humidity); list(r.motion); list(r.airQuality); list(r.smoke); list(r.power); list(r.water); list(r.haScenes); for (const s of r.scenes ?? []) for (const it of s.items) add(it.entity); }
    for (const m of f.furniture) { add(m.entity); list(m.attached); }
    for (const u of f.unlinked) list(u.attached);
  }
  return out;
}

const near = (a: Pt[], b: Pt[]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 1 && Math.abs(p[1] - b[i][1]) <= 1);
const centroid = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

describe("demo/home.json (S36.2)", () => {
  it("passes migrate and validate, and migrate changes nothing in it", () => {
    const m = migrate(structuredClone(L));
    const v = validate(m);
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(m).toEqual(L);
  });

  it("is a house of three levels, lowest first: basement, ground, first", () => {
    expect(floors.map(([k]) => k)).toEqual(["basement", "ground", "first"]);
    expect(floors.map(([, f]) => f.title)).toEqual(["Basement", "Ground", "First"]);
  });

  it("has one outline on all three levels, so they stack in 3D, and none is moved or turned", () => {
    const [, base] = floors[0];
    for (const [k, f] of floors) {
      expect(f.outline, k).toEqual(base.outline);
      expect(f.owk, k).toEqual(base.owk);
      expect(f.offset ?? [0, 0], k).toEqual([0, 0]);
      expect(f.rotation ?? 0, k).toBe(0);
    }
    const xs = base.outline.map((p) => p[0]), ys = base.outline.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(900);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(700);
  });

  it("shows every device type, one by one (finding 17: the union is a list of decisions)", () => {
    const placed = new Set(floors.flatMap(([, f]) => f.devices.map((d) => d.type)));
    const missing = DEVICE_TYPES.filter((t) => !placed.has(t));
    expect(missing).toEqual([]);
  });

  it("names every entity demo_<thing> and gives every one a state", () => {
    const ids = [...entitiesOf(L)];
    expect(ids.length).toBeGreaterThan(100);
    expect(ids.filter((e) => !ENTITY.test(e))).toEqual([]);
    expect(ids.filter((e) => !states[e])).toEqual([]);
    for (const e of ids) {
      const s = states[e];
      expect(typeof s.state, e).toBe("string");
      expect(typeof s.attributes, e).toBe("object");
      expect(Number.isNaN(Date.parse(String(s.last_changed))), e).toBe(false);
      expect(String(s.last_changed), e).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    }
  });

  it("keeps a state only for an entity the plan uses (sun.sun apart)", () => {
    const used = entitiesOf(L);
    expect(Object.keys(states).filter((e) => !used.has(e) && e !== "sun.sun")).toEqual([]);
  });

  it("lines every stair up with the one on the floor next to it, within 1 cm", () => {
    for (let i = 1; i < floors.length; i++) {
      const [lowK, low] = floors[i - 1], [upK, up] = floors[i];
      expect(low.stairs.length, lowK).toBeGreaterThan(0);
      expect(up.stairs.length, upK).toBe(low.stairs.length);
      low.stairs.forEach((s, j) => {
        const t = up.stairs[j];
        expect(near(s.pts, t.pts), `${upK} stair ${j} against ${lowK}`).toBe(true);
        expect(t.shape).toBe(s.shape);
        expect(t.rot).toBe(s.rot);
        expect(t.steps).toBe(s.steps);
      });
    }
  });

  it("puts a stair inside a room on every level it reaches", () => {
    for (const [k, f] of floors) for (const s of f.stairs) {
      const r = f.rooms[roomAt(f, centroid(s.pts))];
      expect(r?.kind, `${k}: the stair stands in a room`).toBe("room");
    }
  });

  it("has a light, a way to know the temperature and a piece of furniture in every room", () => {
    for (const [k, f] of floors) f.rooms.forEach((r, i) => {
      if (r.kind !== "room") return;
      const at = (p: Pt) => roomAt(f, p) === i;
      const dev = (types: string[]) => f.devices.filter((d) => types.includes(d.type) && "x" in d && at([d.x, d.y]));
      expect(dev(["light"]).length, `${k}/${r.name} has a light`).toBeGreaterThan(0);
      expect((r.temps?.length ?? 0) + dev(["temp"]).length, `${k}/${r.name} has a temperature sensor`).toBeGreaterThan(0);
      expect(f.furniture.filter((m) => at([m.x, m.y])).length + f.unlinked.filter((u) => at([u.x, u.y])).length, `${k}/${r.name} is furnished`).toBeGreaterThan(0);
    });
  });

  it("is a house, not a fixture: rooms the plan names, short names, the pieces the brief lists", () => {
    const names = (k: string) => L.floors[k].rooms.map((r) => r.name);
    for (const [k, f] of floors) for (const r of f.rooms) {
      expect(r.name.length, `${k}/${r.name}`).toBeGreaterThan(0);
      expect(r.name.length, `${k}/${r.name} is short`).toBeLessThanOrEqual(16);
    }
    for (const n of ["Laundry", "Storage", "Gym", "Technical"]) expect(names("basement"), n).toContain(n);
    for (const n of ["Hall", "Living", "Kitchen", "WC", "Office", "Garden", "Terrace"]) expect(names("ground"), n).toContain(n);
    for (const n of ["Landing", "Master", "Bathroom"]) expect(names("first"), n).toContain(n);
    const ground = L.floors.ground;
    expect(ground.rooms.some((r) => r.kind === "pavement")).toBe(true);
    expect(ground.furniture.some((m) => m.symbol === "car")).toBe(true);
    expect(ground.rooms.some((r) => r.kind === "water")).toBe(true);
    expect(ground.devices.some((d) => d.type === "vacuum")).toBe(true);
    expect(floors.every(([, f]) => f.rooms.filter((r) => r.kind === "room").length >= 4)).toBe(true);
  });

  it("has doors and windows on every level, each on a wall", () => {
    for (const [k, f] of floors) {
      expect(f.doors.length, k).toBeGreaterThan(2);
      expect(f.doors.some((d) => d.kind === "window" || d.kind === "fullwindow" || d.kind === "glass" || d.kind === "slit"), k).toBe(true);
    }
    expect(L.floors.ground.doors.some((d) => (d.locks ?? []).length > 0 && (d.sensors ?? []).length > 0)).toBe(true);
  });

  it("uses furniture symbols from the schema only, and a catalog that names real devices", () => {
    for (const [k, f] of floors) for (const m of f.furniture) expect(FURNITURE_SYMBOLS, `${k}/${m.id}`).toContain(m.symbol);
    const ids = new Set(floors.flatMap(([, f]) => f.devices.map((d) => d.id)));
    for (const c of L.catalog) expect(ids.has(c.id), `catalog ${c.id}`).toBe(true);
  });

  it("is plain data: no private URL, no token, no address", () => {
    const text = readFileSync("demo/home.json", "utf8") + readFileSync("demo/home-states.json", "utf8");
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/eyJ|token|password/i);
  });
});

describe("demo/home-states.json", () => {
  it("is a pleasant evening: lights on with brightness, one motion, one window open, the car home and charging, the vacuum docked", () => {
    const on = (e: string) => states[e]?.state === "on";
    const lights = Object.keys(states).filter((e) => e.startsWith("light.") && on(e));
    expect(lights.length).toBeGreaterThanOrEqual(4);
    expect(lights.filter((e) => typeof (states[e].attributes as Record<string, unknown>).brightness === "number").length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(states).filter((e) => e.startsWith("binary_sensor.") && (states[e].attributes as Record<string, unknown>).device_class === "motion" && on(e)).length).toBe(1);
    expect(Object.keys(states).filter((e) => e.startsWith("binary_sensor.") && (states[e].attributes as Record<string, unknown>).device_class === "window" && on(e)).length).toBe(1);
    expect(states["device_tracker.demo_car"]?.state).toBe("home");
    expect(Object.values(states).some((s) => (s.attributes as Record<string, unknown>).device_class === "battery_charging" && s.state === "on")).toBe(true);
    expect(states["vacuum.demo_robot"]?.state).toBe("docked");
  });

  it("gives every temperature and humidity sensor a number and a unit, in a believable range", () => {
    for (const [e, s] of Object.entries(states)) {
      const a = s.attributes as Record<string, unknown>;
      if (a.device_class === "temperature") { expect(a.unit_of_measurement, e).toBe("°C"); expect(Number(s.state), e).toBeGreaterThan(8); expect(Number(s.state), e).toBeLessThan(28); }
      if (a.device_class === "humidity") { expect(a.unit_of_measurement, e).toBe("%"); expect(Number(s.state), e).toBeGreaterThan(25); expect(Number(s.state), e).toBeLessThan(80); }
    }
  });
});

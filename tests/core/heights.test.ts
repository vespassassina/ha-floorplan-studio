import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLOOR_HEIGHT, DEFAULT_SLAB, DEVICE_Z, DOOR_DEFAULTS, FURNITURE_HEIGHTS, UNLINKED_HEIGHTS, WALL_KIND_HEIGHT,
  deviceZ, doorSpan, edgeHeight, floorElevation, floorHeight, furnitureHeight, openingSpan, roomHeight, unlinkedHeight, wallHeight,
} from "../../src/core/heights";
import { DEVICE_TYPES, DOOR_KINDS, EDGE_KINDS, FURNITURE_SYMBOLS, WALL_KINDS } from "../../src/core/schema";

const JUNK: unknown[] = [NaN, Infinity, -Infinity, "tall", "250", -5, 1001, null, {}, [], true];
const floor = (o: any = {}) => ({ title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o }) as any;

describe("the default tables decide every member of every union (finding 17)", () => {
  it("DEVICE_Z and UNLINKED_HEIGHTS cover each DEVICE_TYPES member with a number from 0 to 1000", () => {
    for (const t of DEVICE_TYPES) for (const table of [DEVICE_Z, UNLINKED_HEIGHTS]) {
      expect(Number.isFinite(table[t]), t).toBe(true);
      expect(table[t], t).toBeGreaterThanOrEqual(0);
      expect(table[t], t).toBeLessThanOrEqual(1000);
    }
    expect(Object.keys(DEVICE_Z).sort()).toEqual([...DEVICE_TYPES].sort());
    expect(Object.keys(UNLINKED_HEIGHTS).sort()).toEqual([...DEVICE_TYPES].sort());
  });
  it("FURNITURE_HEIGHTS covers each symbol", () => {
    expect(Object.keys(FURNITURE_HEIGHTS).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
    expect(FURNITURE_HEIGHTS.tree).toBe(400);
    expect(FURNITURE_HEIGHTS.sofa).toBe(85);
  });
  it("DOOR_DEFAULTS covers each kind; a window has a sill", () => {
    expect(Object.keys(DOOR_DEFAULTS).sort()).toEqual([...DOOR_KINDS].sort());
    expect(DOOR_DEFAULTS.window).toEqual({ height: 120, sill: 90 });
    expect(DOOR_DEFAULTS.door).toEqual({ height: 210, sill: 0 });
  });
  it("WALL_KIND_HEIGHT decides each wall kind: a number, or the storey", () => {
    expect(Object.keys(WALL_KIND_HEIGHT).sort()).toEqual([...WALL_KINDS].sort());
    expect(WALL_KIND_HEIGHT).toMatchObject({ fence: 110, edge: 0, boundary: 0, wall: "storey", external: "storey" });
  });
});

describe("floorHeight and floorElevation", () => {
  it("reads the floor, else 250", () => {
    expect(floorHeight(floor())).toBe(DEFAULT_FLOOR_HEIGHT);
    expect(floorHeight(floor({ height: 270 }))).toBe(270);
    expect(floorHeight(floor({ height: 0 }))).toBe(0);
    for (const j of JUNK) expect(floorHeight(floor({ height: j })), String(j)).toBe(250);
    expect(floorHeight(undefined as any)).toBe(250);
  });
  it("sums the lower floors' height + slab in key order", () => {
    const layout: any = { floors: { a: floor({ height: 270, slab: 30 }), b: floor(), c: floor({ height: 300 }) } };
    expect(floorElevation(layout, "a")).toBe(0);
    expect(floorElevation(layout, "b")).toBe(300);
    expect(floorElevation(layout, "c")).toBe(300 + 250 + DEFAULT_SLAB);
  });
  it("junk slab falls back to 25; an unknown key is 0", () => {
    const layout: any = { floors: { a: floor({ slab: "x" }), b: floor() } };
    expect(floorElevation(layout, "b")).toBe(250 + 25);
    expect(floorElevation(layout, "nope")).toBe(0);
    expect(floorElevation({ floors: 5 } as any, "a")).toBe(0);
  });
});

describe("roomHeight, wallHeight, edgeHeight", () => {
  const f = floor({ height: 270 });
  it("a room takes its own height or the floor's", () => {
    expect(roomHeight(f, { height: 240 } as any)).toBe(240);
    expect(roomHeight(f, {} as any)).toBe(270);
    for (const j of JUNK) expect(roomHeight(f, { height: j } as any), String(j)).toBe(270);
  });
  it("a wall takes its own height, else its kind, else the storey", () => {
    expect(wallHeight(f, { kind: "wall" } as any)).toBe(270);
    expect(wallHeight(f, { kind: "external" } as any)).toBe(270);
    expect(wallHeight(f, { kind: "fence" } as any)).toBe(110);
    expect(wallHeight(f, { kind: "edge" } as any)).toBe(0);
    expect(wallHeight(f, { kind: "boundary" } as any)).toBe(0);
    expect(wallHeight(f, { kind: "fence", height: 150 } as any)).toBe(150);
    expect(wallHeight(f, { kind: "wall", height: 0 } as any)).toBe(0);
    expect(wallHeight(f, { kind: "bogus" } as any)).toBe(270);
    for (const j of JUNK) expect(wallHeight(f, { kind: "fence", height: j } as any), String(j)).toBe(110);
  });
  it("a room edge follows its EdgeKind; wall and external take the room's height", () => {
    const room: any = { height: 240, wk: ["wall", "external", "fence", "edge", "boundary", "none"] };
    expect([0, 1, 2, 3, 4, 5].map((i) => edgeHeight(f, room, i))).toEqual([240, 240, 110, 0, 0, 0]);
    expect(edgeHeight(f, { wk: ["wall"] } as any, 0)).toBe(270);
    expect(edgeHeight(f, { wk: [] } as any, 7)).toBe(270); // no kind: treat as a wall
  });
  it("every EDGE_KINDS member is decided", () => {
    for (const k of EDGE_KINDS) {
      const h = edgeHeight(f, { height: 233, wk: [k] } as any, 0);
      const expected = k === "wall" || k === "external" ? 233 : k === "fence" ? 110 : k === "parapet" ? 120 : 0;
      expect(h, k).toBe(expected);
    }
  });
  it("the outline (room null) reads owk", () => {
    const o = floor({ height: 270, owk: ["external", "fence", "none"] });
    expect([0, 1, 2].map((i) => edgeHeight(o, null, i))).toEqual([270, 110, 0]);
    expect(edgeHeight(floor(), null, 0)).toBe(250);
  });
});

describe("doorSpan and openingSpan", () => {
  it("each kind gives its default sill and head", () => {
    for (const k of DOOR_KINDS) {
      const d = DOOR_DEFAULTS[k];
      expect(doorSpan({ kind: k } as any), k).toEqual({ sill: d.sill, head: d.sill + d.height });
    }
    expect(doorSpan({ kind: "window" } as any)).toEqual({ sill: 90, head: 210 });
  });
  it("own values win; junk falls back per field", () => {
    expect(doorSpan({ kind: "window", sill: 100, height: 130 } as any)).toEqual({ sill: 100, head: 230 });
    expect(doorSpan({ kind: "window", sill: 100 } as any)).toEqual({ sill: 100, head: 220 });
    expect(doorSpan({ kind: "door", height: 0, sill: 0 } as any)).toEqual({ sill: 0, head: 0 });
    for (const j of JUNK) expect(doorSpan({ kind: "window", sill: j, height: j } as any), String(j)).toEqual({ sill: 90, head: 210 });
    expect(doorSpan({ kind: "bogus" } as any)).toEqual({ sill: 0, head: 210 });
  });
  it("an opening is 210 from 0", () => {
    expect(openingSpan({} as any)).toEqual({ sill: 0, head: 210 });
    expect(openingSpan({ sill: 20, height: 100 } as any)).toEqual({ sill: 20, head: 120 });
    for (const j of JUNK) expect(openingSpan({ sill: j, height: j } as any), String(j)).toEqual({ sill: 0, head: 210 });
  });
});

describe("furnitureHeight, unlinkedHeight, deviceZ", () => {
  it("default by symbol / type; own value wins; junk falls back", () => {
    for (const s of FURNITURE_SYMBOLS) {
      expect(furnitureHeight({ symbol: s } as any), s).toBe(FURNITURE_HEIGHTS[s]);
      expect(furnitureHeight({ symbol: s, height: 12 } as any), s).toBe(12);
      for (const j of JUNK) expect(furnitureHeight({ symbol: s, height: j } as any), `${s} ${String(j)}`).toBe(FURNITURE_HEIGHTS[s]);
    }
    for (const t of DEVICE_TYPES) {
      expect(unlinkedHeight({ type: t } as any), t).toBe(UNLINKED_HEIGHTS[t]);
      expect(unlinkedHeight({ type: t, height: 33 } as any), t).toBe(33);
      expect(deviceZ({ type: t } as any), t).toBe(DEVICE_Z[t]);
      expect(deviceZ({ type: t, z: 44 } as any), t).toBe(44);
      for (const j of JUNK) {
        expect(unlinkedHeight({ type: t, height: j } as any)).toBe(UNLINKED_HEIGHTS[t]);
        expect(deviceZ({ type: t, z: j } as any)).toBe(DEVICE_Z[t]);
      }
    }
  });
  it("an unknown symbol or type still returns a finite number", () => {
    expect(Number.isFinite(furnitureHeight({ symbol: "bogus" } as any))).toBe(true);
    expect(Number.isFinite(unlinkedHeight({ type: "bogus" } as any))).toBe(true);
    expect(Number.isFinite(deviceZ({ type: "bogus" } as any))).toBe(true);
    expect(Number.isFinite(deviceZ(null as any))).toBe(true);
  });
  it("a few table values are the ones the spec names", () => {
    expect(DEVICE_Z.light).toBe(215);
    expect(DEVICE_Z.switch).toBe(120);
    expect(DEVICE_Z.plug).toBe(30);
    expect(DEVICE_Z.speaker).toBe(30); // the top of the 30 cm cabinet 2.5D draws, not a hook on the wall
    expect(DEVICE_Z.media).toBe(30);
  });
});

describe("DEVICE_Z: every type's mount height is pinned (S14.5, Diego: lights and high icons float too high)", () => {
  // One line per DEVICE_TYPES member: a new type fails here until someone writes down where it hangs (finding 17).
  const PRESET: Record<string, number> = {
    light: 215, camera: 205, motion: 205, radar: 205, access_point: 205, // ceiling: 35-45 cm under a 250 ceiling, not 20
    ac: 195, cover: 175, // high on the wall, 25 cm lower
    switch: 120, plug: 30, contact: 120, vibration: 120, lock: 100, temp: 135, humidity: 135, climate: 135,
    boiler: 120, battery: 120, inverter: 100, tv: 100, other: 100, speaker: 30, media: 30,
    heater: 60, computer: 75, server: 60, ups: 30, printer: 90, car: 150, person: 170, vacuum: 10,
  };
  it("the table is the one written here, type by type", () => {
    expect(Object.keys(PRESET).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) expect(DEVICE_Z[t], t).toBe(PRESET[t]);
  });
  it("the ceiling types clear a 250 ceiling by 35 cm or more; the high wall types are 25 cm lower than before", () => {
    for (const t of ["light", "camera", "motion", "radar", "access_point"] as const) expect(250 - DEVICE_Z[t], t).toBeGreaterThanOrEqual(35);
    expect(DEVICE_Z.ac).toBe(220 - 25);
    expect(DEVICE_Z.cover).toBe(200 - 25);
  });
});

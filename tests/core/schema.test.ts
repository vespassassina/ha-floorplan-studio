import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { validate } from "../../src/core/schema";

const clone = () => structuredClone(demo) as any;
const errorsOf = (l: unknown) => {
  const r = validate(l);
  return r.ok ? [] : r.errors;
};

describe("validate", () => {
  it("accepts the demo layout", () => {
    const r = validate(demo);
    expect(r.ok).toBe(true);
  });

  it("rejects a polygon with fewer than 3 points", () => {
    const l = clone();
    l.floors.ground.rooms[0].pts = [[0, 0], [1, 1]];
    l.floors.ground.rooms[0].w = [true, true];
    expect(errorsOf(l).join("\n")).toMatch(/room-ground-1.*at least 3 points/);
  });

  it("rejects w whose length differs from pts", () => {
    const l = clone();
    l.floors.ground.rooms[0].w = [true];
    expect(errorsOf(l).join("\n")).toMatch(/room-ground-1.*w must have 4 entries/);
  });

  it("rejects duplicate ids on one floor", () => {
    const l = clone();
    l.floors.ground.doors[1].id = l.floors.ground.doors[0].id;
    expect(errorsOf(l).join("\n")).toMatch(/duplicate id door-ground-1/);
  });

  it("rejects a device id used on two floors", () => {
    const l = clone();
    l.floors.first.devices[0].id = l.floors.ground.devices[0].id;
    expect(errorsOf(l).join("\n")).toMatch(/duplicate device id light-living/);
  });

  it("rejects a door sensor that is not an entity id", () => {
    const l = clone();
    l.floors.ground.doors[0].sensor = "nodot";
    expect(errorsOf(l).join("\n")).toMatch(/door-ground-1.*sensor/);
  });

  it("rejects a door cover that is not an entity id", () => {
    const l = clone();
    l.floors.ground.doors[2].cover = 5;
    expect(errorsOf(l).join("\n")).toMatch(/door-ground-3.*cover/);
  });

  it("rejects north outside [0, 360)", () => {
    for (const n of [-1, 360]) {
      const l = clone();
      l.north = n;
      expect(errorsOf(l).join("\n")).toMatch(/north/);
    }
  });

  it("rejects a wrong version and a non-object", () => {
    expect(errorsOf({ ...clone(), version: 1 }).join("\n")).toMatch(/version/);
    expect(validate(null).ok).toBe(false);
  });

  it("never throws on hostile shapes and reports them", () => {
    for (const k of ["rooms", "walls", "stairs", "doors", "openings", "extras", "devices", "furniture"]) {
      const l = clone();
      l.floors.ground[k] = 5;
      expect(() => validate(l)).not.toThrow();
      expect(errorsOf(l).join("\n")).toMatch(new RegExp(k));
    }
    expect(validate({ version: 2, north: 0, floors: { g: { rooms: [null] } } }).ok).toBe(false);
  });

  it("rejects values outside the enums", () => {
    const l = clone();
    l.floors.ground.rooms[0].kind = "bogus";
    l.floors.ground.doors[0].kind = "bogus";
    l.floors.ground.devices[0].type = "bogus";
    l.floors.ground.furniture[0].symbol = "bogus";
    const e = errorsOf(l).join("\n");
    for (const w of ["room", "door", "type", "symbol"]) expect(e).toMatch(new RegExp(w));
    expect(e.match(/must be one of/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects NaN north and devices without finite coordinates", () => {
    const l = clone();
    l.north = NaN;
    l.floors.ground.devices[0].x = NaN;
    const e = errorsOf(l).join("\n");
    expect(e).toMatch(/north/);
    expect(e).toMatch(/needs x and y/);
  });

  it("rejects a door without a name", () => {
    const l = clone();
    delete l.floors.ground.doors[0].name;
    expect(errorsOf(l).join("\n")).toMatch(/needs a name/);
  });
});

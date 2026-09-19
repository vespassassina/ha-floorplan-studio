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

describe("validate bound", () => {
  const light = (l: any) => l.floors.ground.devices.find((d: any) => d.id === "light-living");
  const has = (l: any, re: RegExp) => errorsOf(l).some((e) => re.test(e));

  it("accepts the demo with its bound light", () => {
    expect(light(clone()).bound).toBe("switch.demo_living_relay");
    expect(errorsOf(clone())).toEqual([]);
  });
  it("rejects bound that is not an entity id", () => {
    const l = clone(); light(l).bound = "nodot";
    expect(has(l, /bound must be an entity id/)).toBe(true);
    light(l).bound = 5;
    expect(has(l, /bound must be an entity id/)).toBe(true);
  });
  it("rejects bound on a device that is not a light", () => {
    const l = clone();
    const sw = l.floors.ground.devices.find((d: any) => d.type === "switch");
    sw.bound = "switch.other";
    expect(has(l, /bound is only allowed on a light/)).toBe(true);
  });
  it("rejects bound equal to entity", () => {
    const l = clone(); light(l).bound = light(l).entity;
    expect(has(l, /bound must differ from entity/)).toBe(true);
  });
  it("rejects two devices sharing a bound", () => {
    const l = clone();
    const k = l.floors.ground.devices.find((d: any) => d.id === "light-kitchen");
    k.bound = light(l).bound;
    expect(has(l, /bound .* is used by more than one device/)).toBe(true);
  });
  it("rejects bound that is another device's entity", () => {
    const l = clone(); light(l).bound = "switch.demo_hall";
    expect(has(l, /bound switch.demo_hall is also the entity of another device/)).toBe(true);
  });
  it("rejects a shared bound across floors and never throws", () => {
    const l = clone();
    l.floors.first.devices.push({ id: "light-x", type: "light", entity: "light.x", bound: light(l).bound, x: 1, y: 1 });
    expect(has(l, /more than one device/)).toBe(true);
  });
});

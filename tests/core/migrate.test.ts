import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import v1 from "../../demo/layout.v1.json";
import { migrate } from "../../src/core/migrate";
import { validate } from "../../src/core/schema";

const stripIds = (l: any) => {
  const c = structuredClone(l);
  for (const f of Object.values<any>(c.floors))
    for (const k of ["rooms", "walls", "stairs", "doors", "openings", "extras", "furniture"])
      for (const o of f[k]) delete o.id;
  return c;
};

describe("migrate", () => {
  it("turns the v1 demo into a valid v2 layout", () => {
    const m = migrate(v1);
    expect(m.version).toBe(2);
    expect(validate(m).ok).toBe(true);
  });

  it("equals the v2 demo once object ids are stripped", () => {
    expect(stripIds(migrate(v1))).toEqual(stripIds(demo));
  });

  it("assigns ids as <kind>-<floor>-<n>", () => {
    const m = migrate(v1);
    expect(m.floors.ground.rooms.map((r) => r.id)).toEqual(["room-ground-1", "room-ground-2", "room-ground-3"]);
    expect(m.floors.first.doors[0].id).toBe("door-first-1");
  });

  it("renames device types sensor to temp and window to contact", () => {
    const l: any = structuredClone(v1);
    l.floors.ground.devices.push({ id: "w1", type: "window", entity: "", name: "W", x: 1, y: 1 });
    const m = migrate(l);
    expect(m.floors.ground.devices.find((d) => d.id === "temp-living")!.type).toBe("temp");
    expect(m.floors.ground.devices.find((d) => d.id === "w1")!.type).toBe("contact");
  });

  it("fills missing arrays and builds a catalog from placed devices", () => {
    const m = migrate({ unit: "cm", north: 0, floors: { g: { title: "G", outline: [[0, 0], [10, 0], [10, 10]], rooms: [{ name: "Hall Way", label: "", kind: "room", pts: [[0, 0], [10, 0], [10, 10]], w: [true, true, true] }], devices: [{ id: "l1", type: "light", entity: "light.a", name: "A", x: 6, y: 2 }] } } });
    expect(m.floors.g.furniture).toEqual([]);
    expect(m.floors.g.rooms[0].area).toBe("hall-way");
    expect(m.catalog).toEqual([{ id: "l1", floor: "g", room: "Hall Way", type: "light", name: "A", entity: "light.a" }]);
  });

  it("is idempotent on v2", () => {
    expect(migrate(demo)).toEqual(demo);
    expect(migrate(migrate(v1))).toEqual(migrate(v1));
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(v1);
    migrate(v1);
    expect(JSON.stringify(v1)).toBe(before);
  });

  it("throws on unknown versions and on non-layouts", () => {
    expect(() => migrate({ version: 3 })).toThrow("Unknown layout version 3");
    expect(() => migrate(null)).toThrow();
    expect(() => migrate("x")).toThrow();
  });

  it("fills missing arrays and ids in a v2 layout, and accepts version \"2\"", () => {
    const m = migrate({ version: "2", north: 0, floors: { g: { title: "G", outline: [], rooms: [{ name: "Hall", kind: "room", pts: [], w: [] }] } } });
    expect(m.floors.g.walls).toEqual([]);
    expect(m.floors.g.devices).toEqual([]);
    expect(m.floors.g.rooms[0].id).toBe("room-g-1");
    expect(m.version).toBe(2);
  });

  it("does not turn a v2 sensor into temp", () => {
    const m = migrate({ version: 2, north: 0, floors: { g: { devices: [{ id: "s", type: "sensor" }] } } });
    expect(m.floors.g.devices[0].type).toBe("sensor");
  });

  it("keeps a floor called __proto__ as an own floor", () => {
    const m = migrate(JSON.parse('{"floors":{"__proto__":{"title":"x"}}}'));
    expect(Object.keys(m.floors)).toEqual(["__proto__"]);
    expect(({} as any).title).toBeUndefined();
  });

  it("throws a plain error when a floor field is not an array", () => {
    expect(() => migrate({ floors: { g: { rooms: 5 } } })).toThrow(/rooms must be an array/);
  });

  it("skips devices without a position when it builds the catalogue", () => {
    const m = migrate({ floors: { g: { rooms: [], devices: [{ type: "light", entity: "light.a" }] } } });
    expect(m.catalog).toEqual([]);
  });
});

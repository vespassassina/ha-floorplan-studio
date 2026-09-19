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
    expect(m.floors.ground.rooms.map((r) => r.id)).toEqual(["room-ground-1", "room-ground-2", "room-ground-3", "room-ground-4", "room-ground-5"]);
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

  it("passes bound through unchanged, v1 and v2", () => {
    const l: any = structuredClone(v1);
    l.floors.ground.devices.find((d: any) => d.id === "light-living").bound = "switch.keep_me";
    const m1 = migrate(l);
    expect(m1.floors.ground.devices.find((d) => d.id === "light-living")).toMatchObject({ bound: "switch.keep_me" });
    l.version = 2;
    expect(migrate(l).floors.ground.devices.find((d) => d.id === "light-living")).toMatchObject({ bound: "switch.keep_me" });
  });

  it("does not treat a water room's empty area or a zone's dotted flags as missing", () => {
    const l: any = structuredClone(demo);
    const pts = [[10, 10], [60, 10], [60, 60]];
    l.floors.ground.rooms.push(
      { id: "z1", name: "Nook", area: "nook", label: "", kind: "zone", pts, w: [false, false, false] },
      { id: "w1", name: "Pond", area: "", label: "", kind: "water", pts, w: [false, false, false] },
      { id: "r9", name: "Cellar Store", kind: "room", pts, w: [true, true, true] }, // no area: this one is filled
      { id: "w2", name: "Koi Pond", kind: "water", pts, w: [false, false, false] }, // no area: water gets none
    );
    const rooms = migrate(l).floors.ground.rooms.slice(-4);
    expect(rooms[3].area).toBe(""); // one rule with the editor's Add and Draw: water is not an HA area
    expect(rooms[1].area).toBe(""); // "" is a value, not a gap: a fill that used || would turn it into "pond"
    expect(rooms[0]).toEqual(l.floors.ground.rooms.at(-4));
    expect(rooms[1].w).toEqual([false, false, false]);
    expect(rooms[2].area).toBe("cellar-store");
  });
});

describe("wall kind migration", () => {
  it("defaults a wall with no kind to wall, in v1 and v2, and keeps a kind that is set", () => {
    for (const version of [1, 2]) {
      const m = migrate({ version, north: 0, floors: { g: { title: "G", outline: [], walls: [{ id: "a", a: [0, 0], b: [1, 0] }, { id: "b", a: [0, 0], b: [1, 0], kind: "fence" }] } } });
      expect(m.floors.g.walls.map((w) => w.kind)).toEqual(["wall", "fence"]);
    }
  });
  it("leaves an unknown kind for validate to reject", () => {
    const m = migrate({ version: 2, north: 0, floors: { g: { walls: [{ id: "a", a: [0, 0], b: [1, 0], kind: "garden" }] } } });
    expect(m.floors.g.walls[0].kind).toBe("garden" as any);
  });
});

describe("room names and labels", () => {
  it("fills a missing room name and label with empty strings and leaves a bad one for validate", () => {
    const l: any = structuredClone(demo);
    delete l.floors.ground.rooms[0].name;
    delete l.floors.ground.rooms[0].label;
    l.floors.ground.rooms[1].name = { a: 1 };
    const m = migrate(l);
    expect([m.floors.ground.rooms[0].name, m.floors.ground.rooms[0].label]).toEqual(["", ""]);
    expect(m.floors.ground.rooms[1].name).toEqual({ a: 1 });
    expect(validate(m).ok).toBe(false);
  });
});

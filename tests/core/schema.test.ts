import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { ROOM_KINDS, validate } from "../../src/core/schema";

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
    l.floors.ground.rooms[0].wk = ["wall", "wall"];
    expect(errorsOf(l).join("\n")).toMatch(/room-ground-1.*at least 3 points/);
  });

  it("rejects wk whose length differs from pts", () => {
    const l = clone();
    l.floors.ground.rooms[0].wk = ["wall"];
    expect(errorsOf(l).join("\n")).toMatch(/room-ground-1.*wk must have 4 entries/);
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

  describe("zone and water rooms", () => {
    it("accepts a zone with no wall edge and a water polygon", () => {
      const l = clone();
      l.floors.ground.rooms.push(
        { id: "z1", name: "Nook", area: "nook", label: "", kind: "zone", pts: [[10, 10], [60, 10], [60, 60]], wk: ["boundary", "boundary", "boundary"] },
        { id: "w1", name: "Pond", area: "", label: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60]], wk: ["boundary", "boundary", "boundary"] },
      );
      expect(errorsOf(l)).toEqual([]);
    });
    it("accepts water with wall flags, like a room", () => {
      const l = clone();
      l.floors.ground.rooms.push({ id: "w1", name: "Pool", area: "", label: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60]], wk: ["wall", "wall", "wall"] });
      expect(errorsOf(l)).toEqual([]);
    });
    it("rejects a zone with a wall edge", () => {
      const l = clone();
      l.floors.ground.rooms.push({ id: "z1", name: "Nook", area: "nook", label: "", kind: "zone", pts: [[10, 10], [60, 10], [60, 60]], wk: ["boundary", "wall", "boundary"] });
      expect(errorsOf(l).join("\n")).toMatch(/z1.*zone.*wall/);
    });
    it("rejects a zone or water polygon with fewer than 3 points", () => {
      for (const kind of ["zone", "water"]) {
        const l = clone();
        l.floors.ground.rooms.push({ id: "q1", name: "Q", area: "", label: "", kind, pts: [[0, 0], [1, 1]], wk: ["boundary", "boundary"] });
        expect(errorsOf(l).join("\n")).toMatch(/q1.*at least 3 points/);
      }
    });
    it("still rejects an unknown kind", () => {
      const l = clone();
      l.floors.ground.rooms[0].kind = "lake";
      expect(errorsOf(l).join("\n")).toMatch(/room-ground-1 kind/);
    });
  });
});

describe("wall kinds", () => {
  const withKind = (kind: unknown) => {
    const l = clone();
    l.floors.ground.walls.push({ id: "w1", a: [0, 0], b: [10, 0], kind });
    return l;
  };
  it("accepts wall, boundary, external, fence and edge", () => {
    for (const k of ["wall", "boundary", "external", "fence", "edge"]) expect(errorsOf(withKind(k)), k).toEqual([]);
  });
  it("rejects garden, an empty kind, a missing kind and a non-string kind", () => {
    for (const k of ["garden", "", undefined, 3, null, "Fence"]) expect(errorsOf(withKind(k)).join("\n"), String(k)).toMatch(/w1 kind must be one of wall, boundary, external, fence, edge/);
  });
});

describe("names and labels are strings (review S1.5, finding 5)", () => {
  const BAD = [{ a: 1 }, 5, ["x"], null, true];
  const fixtures: [string, (l: any, v: unknown) => void, RegExp][] = [
    ["room.name", (l, v) => { l.floors.ground.rooms[0].name = v; }, /room-ground-1.*name/],
    ["room.label", (l, v) => { l.floors.ground.rooms[0].label = v; }, /room-ground-1.*label/],
    ["zone.name", (l, v) => { l.floors.ground.rooms[3].name = v; }, /room-ground-4.*name/],
    ["zone.label", (l, v) => { l.floors.ground.rooms[3].label = v; }, /room-ground-4.*label/],
    ["water.name", (l, v) => { l.floors.ground.rooms[6].name = v; }, /room-ground-7.*name/],
    ["stairs.name", (l, v) => { l.floors.ground.stairs[0].name = v; }, /stairs-ground-1.*name/],
    ["extra.name", (l, v) => { l.floors.ground.extras.push({ id: "x1", name: v, a: [0, 0], b: [10, 10] }); }, /x1.*name/],
    ["door.name", (l, v) => { l.floors.ground.doors[0].name = v; }, /door-ground-1.*name/],
    ["device.name", (l, v) => { l.floors.ground.devices[0].name = v; }, /light-living.*name/],
  ];
  for (const [what, set, re] of fixtures)
    for (const bad of BAD)
      it(`rejects ${what} = ${JSON.stringify(bad)}`, () => {
        const l = clone();
        set(l, bad);
        expect(errorsOf(l).join("\n")).toMatch(re);
      });
  it("still accepts a device without a name and a room with an empty label", () => {
    const l = clone();
    delete l.floors.ground.devices[0].name;
    l.floors.ground.rooms[0].label = "";
    expect(errorsOf(l)).toEqual([]);
  });
});

describe("room kinds (S1.14)", () => {
  it("lists the eight kinds in order", () => {
    expect(ROOM_KINDS).toEqual(["room", "garden", "pavement", "fill", "terrace", "structure", "zone", "water"]);
  });
  it("accepts pavement and garden, rejects outdoor and names the eight", () => {
    const l = clone();
    for (const k of ["pavement", "garden"]) { l.floors.ground.rooms[0].kind = k; expect(errorsOf(l)).toEqual([]); }
    l.floors.ground.rooms[0].kind = "outdoor";
    expect(errorsOf(l).join("\n")).toContain("room, garden, pavement, fill, terrace, structure, zone, water");
  });
});

describe("room colour (S1.16)", () => {
  const withColor = (c: unknown) => { const l = clone(); l.floors.ground.rooms[0].color = c; return errorsOf(l).join("\n"); };
  it("rejects anything but #rrggbb and accepts upper case", () => {
    for (const bad of ["red", "#abc", "#aabbcc; x", "#aabbccdd", "aabbcc", 5, null, "\"><script>"])
      expect(withColor(bad)).toMatch(/room-ground-1 color must be a colour like #aabbcc/);
    expect(withColor("#AABBCC")).toBe("");
    expect(withColor("#aabbcc")).toBe("");
  });
});

describe("room wk (S1.17)", () => {
  const errs = (fn: (l: any) => void) => { const l = clone(); fn(l); return errorsOf(l).join("\n"); };
  it("the demo has wk and validates", () => {
    expect(clone().floors.ground.rooms[0].wk).toEqual(["wall", "wall", "wall", "wall"]);
  });
  it("rejects a wk of the wrong length, an unknown kind, and a missing wk", () => {
    expect(errs((l) => { l.floors.ground.rooms[0].wk = ["wall"]; })).toMatch(/room-ground-1.*wk must have 4 entries/);
    expect(errs((l) => { l.floors.ground.rooms[0].wk = ["wall", "wall", "moat", "wall"]; })).toMatch(/room-ground-1.*wk.*one of wall, boundary, external, fence, edge/);
    expect(errs((l) => { delete l.floors.ground.rooms[0].wk; })).toMatch(/room-ground-1.*wk must have 4 entries/);
  });
  it("accepts every wall kind on a room edge", () => {
    expect(errs((l) => { l.floors.ground.rooms[0].wk = ["wall", "boundary", "external", "fence"]; })).toBe("");
    expect(errs((l) => { l.floors.ground.rooms[0].wk = ["edge", "edge", "edge", "edge"]; })).toBe("");
  });
  it("a zone must be boundary on every edge", () => {
    expect(errs((l) => { l.floors.ground.rooms[3].wk[1] = "wall"; })).toMatch(/room-ground-4.*zone.*wk/);
    expect(errs((l) => { l.floors.ground.rooms[3].wk[1] = "fence"; })).toMatch(/room-ground-4.*zone.*wk/);
  });
});

describe("device rot (S1.23)", () => {
  const withRot = (v: unknown) => { const l = clone(); l.floors.ground.devices[0].rot = v; return errorsOf(l).join("\n"); };
  it("accepts a finite number in [0, 360)", () => {
    for (const ok of [0, 90, 359.5]) expect(withRot(ok)).toBe("");
    expect(errorsOf(clone())).toEqual([]); // absent is fine
  });
  it("rejects 400, -1, 360, a string, NaN and null", () => {
    for (const bad of [400, -1, 360, "90", NaN, null, Infinity])
      expect(withRot(bad)).toMatch(/light-living rot must be a number in \[0, 360\)/);
  });
});

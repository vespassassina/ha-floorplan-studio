import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { FLOOR_COLOURS, ROOM_KINDS, STAIR_SHAPES, validate } from "../../src/core/schema";

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

  it("accepts none on a room edge, not on a wall, not on a zone (S1.47)", () => {
    const l = clone();
    (l.floors.ground.rooms[0].wk as string[])[1] = "none";
    expect(errorsOf(l)).toEqual([]);
    const w = clone();
    w.floors.ground.walls.push({ id: "w9", a: [0, 0], b: [10, 0], kind: "none" as never });
    expect(errorsOf(w).join("\n")).toMatch(/w9 kind/);
    const z = clone();
    const zone = z.floors.ground.rooms.find((r: { kind: string }) => r.kind === "zone")!;
    (zone.wk as string[])[0] = "none";
    expect(errorsOf(z).join("\n")).toMatch(/zone/);
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

  it("rejects a room area that is not text, and a device entity that is missing or not an entity id (Opus review)", () => {
    for (const bad of [5, {}, [], null, true]) {
      const l = clone(); l.floors.ground.rooms[0].area = bad;
      expect(errorsOf(l).join("\n"), String(bad)).toMatch(/room-ground-1 area must be text/);
    }
    const ok = clone(); ok.floors.ground.rooms[0].area = ""; // empty is a custom shape: drawn rooms have no area
    expect(validate(ok).ok).toBe(true);
    for (const bad of [5, {}, "", "nodot", null, undefined]) {
      const l = clone(); l.floors.ground.devices[0].entity = bad;
      expect(errorsOf(l).join("\n"), String(bad)).toMatch(/entity must be an entity id/);
    }
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

  it("rotate: accepts 0 and every multiple of 45 below 360, or none; rejects 30, 360, -45, 45.5 and text", () => {
    for (const r of [0, 45, 90, 315, undefined]) { const l = clone() as any; l.rotate = r; expect(errorsOf(l), String(r)).toEqual([]); }
    for (const r of [30, 360, -45, 45.5, "45", null, NaN]) { const l = clone() as any; l.rotate = r; expect(errorsOf(l).join("\n"), String(r)).toMatch(/rotate must be a multiple of 45/); }
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
  it("accepts two lights on one switch, and that switch as a device of its own (S1.32)", () => {
    const l = clone();
    const k = l.floors.ground.devices.find((d: any) => d.id === "light-kitchen");
    k.bound = light(l).bound; // one wall switch, two lamps
    expect(errorsOf(l)).toEqual([]);
    l.floors.ground.devices.push({ id: "switch-relay", type: "switch", entity: light(l).bound, x: 10, y: 10 });
    expect(errorsOf(l)).toEqual([]);
  });
  it("accepts a shared bound across floors and a bound that is another device's entity", () => {
    const l = clone();
    l.floors.first.devices.push({ id: "light-x", type: "light", entity: "light.x", bound: light(l).bound, x: 1, y: 1 });
    expect(errorsOf(l)).toEqual([]);
    light(l).bound = "switch.demo_hall"; // the hall switch is a placed device
    expect(errorsOf(l)).toEqual([]);
  });
  it("still refuses a light bound to its own entity, and a bound on a shared switch that is not an id", () => {
    const l = clone();
    const k = l.floors.ground.devices.find((d: any) => d.id === "light-kitchen");
    k.bound = light(l).bound;
    expect(has(l, /bound must differ from entity/)).toBe(false);
    k.bound = k.entity;
    expect(has(l, /light-kitchen bound must differ from entity/)).toBe(true);
    k.bound = "nodot";
    expect(has(l, /bound must be an entity id/)).toBe(true);
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

describe("room free (S1.24)", () => {
  const withFree = (v: unknown) => { const l = clone(); (l.floors.ground.rooms[0] as unknown as Record<string, unknown>).free = v; return errorsOf(l).join("\n"); };
  it("accepts a boolean, or none", () => {
    expect(withFree(true)).toBe("");
    expect(withFree(false)).toBe("");
    expect(errorsOf(clone())).toEqual([]);
  });
  it("rejects anything else", () => {
    for (const bad of ["yes", 1, null]) expect(withFree(bad)).toMatch(/room-ground-1 free must be true or false/);
  });
});

describe("stairs shape, steps, rotation and diameters (S1.25)", () => {
  const withStairs = (patch: (t: any) => void) => { const l = clone(); patch(l.floors.ground.stairs[0]); return errorsOf(l).join("\n"); };
  const round = (t: any) => { t.shape = "round"; t.dia = 200; t.inner = 60; };
  it("lists the shapes", () => expect([...STAIR_SHAPES]).toEqual(["straight", "round"]));
  it("accepts the demo stairs, a round stair, and an inner of 0 or dia - 40", () => {
    expect(withStairs(() => {})).toBe("");
    expect(withStairs(round)).toBe("");
    expect(withStairs((t) => { round(t); t.inner = 0; })).toBe("");
    expect(withStairs((t) => { round(t); t.inner = 160; })).toBe("");
  });
  it("rejects a shape outside the list", () => {
    for (const v of ["curved", "", undefined, 3]) expect(withStairs((t) => { t.shape = v; }), String(v)).toMatch(/stairs-ground-1.*shape/);
  });
  it("rejects steps that are not an integer in [2, 40]", () => {
    for (const v of [1, 41, 3.5, "12", NaN, undefined]) expect(withStairs((t) => { t.steps = v; }), String(v)).toMatch(/stairs-ground-1.*steps/);
    for (const v of [2, 40]) expect(withStairs((t) => { t.steps = v; }), String(v)).toBe("");
  });
  it("rejects a rot outside [0, 360)", () => {
    for (const v of [-1, 360, Infinity, "0", undefined]) expect(withStairs((t) => { t.rot = v; }), String(v)).toMatch(/stairs-ground-1.*rot/);
    expect(withStairs((t) => { t.rot = 359.5; })).toBe("");
  });
  it("rejects dia or inner on a straight stair", () => {
    expect(withStairs((t) => { t.dia = 200; })).toMatch(/stairs-ground-1.*dia/);
    expect(withStairs((t) => { t.inner = 0; })).toMatch(/stairs-ground-1.*inner/);
  });
  it("rejects a round stair with no dia, or a dia under 40", () => {
    expect(withStairs((t) => { round(t); delete t.dia; })).toMatch(/stairs-ground-1.*dia/);
    expect(withStairs((t) => { round(t); t.dia = 39; t.inner = 0; })).toMatch(/stairs-ground-1.*dia/);
    expect(withStairs((t) => { round(t); t.dia = NaN; })).toMatch(/stairs-ground-1.*dia/);
  });
  it("rejects an inner outside [0, dia - 40]", () => {
    for (const v of [-1, 161, NaN, "5"]) expect(withStairs((t) => { round(t); t.inner = v; }), String(v)).toMatch(/stairs-ground-1.*inner/);
  });
});

describe("device types ac, tv, computer (S1.30)", () => {
  const withType = (type: string) => { const l = clone(); l.floors.ground.devices.push({ id: "new-1", type, entity: "x.new", x: 10, y: 10 }); return validate(l); };
  it("accepts the three new types", () => {
    for (const t of ["ac", "tv", "computer"]) expect(withType(t).ok).toBe(true);
  });
  it("still rejects an unknown type", () => {
    const r = withType("fridge");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.join()).toMatch(/type/);
  });
});

describe("FLOOR_COLOURS (S1.35)", () => {
  it("are the twelve floor materials, in order, each a colour validate accepts", () => {
    expect(FLOOR_COLOURS.map((c) => c.name)).toEqual(["White ceramic", "Marble", "Sand", "Terracotta", "Light oak", "Warm wood", "Dark oak", "Walnut", "Light grey", "Grey floor", "Belgian stone", "Lava"]);
    expect(FLOOR_COLOURS.map((c) => c.hex)).toEqual(["#f4f4f0", "#e2dfda", "#e6d5b8", "#c98a63", "#d8bd94", "#b98b5c", "#86643f", "#5b4130", "#b4b6b8", "#8b8e91", "#4d4e50", "#38393b"]);
    for (const c of FLOOR_COLOURS) {
      const l = clone();
      l.floors.ground.rooms[0].color = c.hex;
      expect(errorsOf(l), c.name).toEqual([]);
    }
  });
});

describe("layout.colors (S1.36)", () => {
  const withColors = (c: unknown) => { const l = clone(); l.colors = c; return l; };
  it("accepts none, an empty object and type keys with #rrggbb values", () => {
    expect(errorsOf(clone())).toEqual([]);
    expect(errorsOf(withColors({}))).toEqual([]);
    expect(errorsOf(withColors({ light: "#aabbcc", ac: "#00FF00" }))).toEqual([]);
  });
  it("rejects a colour that is not #rrggbb, a key that is not a device type, and a non-object", () => {
    expect(errorsOf(withColors({ light: "red" })).join()).toMatch(/colors\.light/);
    expect(errorsOf(withColors({ fridge: "#aabbcc" })).join()).toMatch(/colors.*fridge/);
    for (const bad of [null, [], "x", 3]) expect(errorsOf(withColors(bad)).join(), String(bad)).toMatch(/colors/);
    expect(errorsOf(withColors({ light: 5 })).join()).toMatch(/colors\.light/);
    expect(errorsOf(withColors({ light: "#abc" })).join()).toMatch(/colors\.light/);
  });
});

describe("HA links (S1.37)", () => {
  it("accepts floor.ha, room.entity, furniture.name and furniture.entity", () => {
    const l = clone();
    l.floors.ground.ha = "downstairs";
    l.floors.ground.rooms[5].entity = "sensor.pond";
    l.floors.ground.furniture[0].name = "Sofa";
    l.floors.ground.furniture[0].entity = "media_player.tv";
    expect(errorsOf(l)).toEqual([]);
  });
  it("rejects an empty or non-text ha, an entity that is not an id, and a numeric furniture name", () => {
    for (const bad of ["", 5, null]) { const l = clone(); l.floors.ground.ha = bad; expect(errorsOf(l).join(), String(bad)).toMatch(/ha must be/); }
    for (const bad of ["pond", 5, ""]) { const l = clone(); l.floors.ground.rooms[5].entity = bad; expect(errorsOf(l).join(), String(bad)).toMatch(/entity must be an entity id/); }
    const l = clone(); l.floors.ground.furniture[0].entity = "sofa"; expect(errorsOf(l).join()).toMatch(/entity must be an entity id/);
    const m = clone(); m.floors.ground.furniture[0].name = 7; expect(errorsOf(m).join()).toMatch(/name must be text/);
  });
});

describe("furniture size bounds (S1.51)", () => {
  it("rejects w or h of 0 or of 5000 as out of range", () => {
    for (const bad of [0, 5000]) {
      const l = clone(); l.floors.ground.furniture[0].w = bad; expect(errorsOf(l).join(), String(bad)).toMatch(/w must be between 5 and 2000/);
      const m = clone(); m.floors.ground.furniture[0].h = bad; expect(errorsOf(m).join(), String(bad)).toMatch(/h must be between 5 and 2000/);
    }
  });
  it("rejects w or h of NaN (as not a number)", () => {
    const l = clone(); l.floors.ground.furniture[0].w = NaN; expect(errorsOf(l).join()).toMatch(/w must be a number/);
    const m = clone(); m.floors.ground.furniture[0].h = NaN; expect(errorsOf(m).join()).toMatch(/h must be a number/);
  });
  it("accepts 5 and 2000, the ends of the range", () => {
    const l = clone(); l.floors.ground.furniture[0].w = 5; l.floors.ground.furniture[0].h = 2000;
    expect(errorsOf(l)).toEqual([]);
  });
});

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
    expect(m.floors.ground.rooms.map((r) => r.id)).toEqual(["room-ground-1", "room-ground-2", "room-ground-3", "room-ground-4", "room-ground-5", "room-ground-6", "room-ground-7"]);
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

  it("fills rotate with 0, v1 and v2, and keeps a stored one", () => {
    expect(migrate(v1).rotate).toBe(0);
    const l = structuredClone(demo) as any;
    delete l.rotate;
    expect(migrate(l).rotate).toBe(0);
    l.rotate = 135;
    expect(migrate(l).rotate).toBe(135);
    expect(migrate({ ...v1, rotate: 90 }).rotate).toBe(90);
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

  it("rejects a version that is not a number or a numeric string, not reading true as 1 (Opus review)", () => {
    for (const version of [true, false, null, [], [2], {}, "", " ", "two", "2x", "1e0", NaN, 1.5, -1])
      expect(() => migrate({ version, floors: {} }), String(version)).toThrow(/version/i);
    expect(() => migrate({ floors: {} })).not.toThrow(); // no version at all is v1, as before
    expect(migrate({ version: "1", floors: {} }).version).toBe(2);
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
    const { w, ...z1 } = l.floors.ground.rooms.at(-4);
    expect(rooms[0]).toEqual({ ...z1, wk: ["boundary", "boundary", "boundary"] }); // a zone keeps its area and its dotted edges
    expect(w).toEqual([false, false, false]);
    expect((rooms[1] as any).wk).toEqual(["boundary", "boundary", "boundary"]);
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

describe("an older or hand-written layout still loads (review S1.5 round 2, finding 1)", () => {
  // every optional field missing at once: names, labels, areas, ids, kinds
  const bare = (version: number): any => ({
    version,
    floors: { g: {
      outline: [[0, 0], [100, 0], [100, 100], [0, 100]],
      rooms: [{ pts: [[0, 0], [100, 0], [100, 100], [0, 100]], kind: "room", w: [true, true, true, true] }],
      stairs: [{ pts: [[10, 10], [40, 10], [40, 40], [10, 40]] }],
      extras: [{ a: [0, 50], b: [50, 50] }],
      devices: [{ type: "light", x: 50, y: 50, entity: "light.a" }],
    } },
  });
  for (const v of [1, 2])
    it(`v${v}: stairs and extras with no name migrate to a layout that validates`, () => {
      const r = validate(migrate(bare(v)));
      expect(r).toMatchObject({ ok: true });
      const f = (migrate(bare(v)) as any).floors.g;
      expect([f.stairs[0].name, f.extras[0].name]).toEqual(["", ""]);
    });
  it("keeps a name that is there", () => {
    const l = bare(2);
    l.floors.g.stairs[0].name = "Main"; l.floors.g.extras[0].name = "Fence";
    const f = migrate(l).floors.g as any;
    expect([f.stairs[0].name, f.extras[0].name]).toEqual(["Main", "Fence"]);
  });
});

describe("outdoor is renamed garden (S1.14)", () => {
  const withKinds = (version: number, kinds: string[]) => ({
    version, north: 0,
    floors: { g: { title: "G", outline: [], rooms: kinds.map((kind, i) => ({ id: `r${i}`, name: "R", area: "r", label: "", kind, pts: [[0, 0], [1, 0], [1, 1]], w: [true, true, true] })) } },
  });
  for (const v of [1, 2])
    it(`v${v}: outdoor becomes garden, other kinds stay, and a second migrate changes nothing`, () => {
      const once = migrate(withKinds(v, ["outdoor", "room", "terrace", "garden"]));
      expect(once.floors.g.rooms.map((r) => r.kind)).toEqual(["garden", "room", "terrace", "garden"]);
      expect(migrate(once)).toEqual(once);
    });
  it("a room with no kind is left without one, so validate reports it", () => {
    const l: any = withKinds(2, ["room"]);
    delete l.floors.g.rooms[0].kind;
    const m = migrate(l);
    expect(m.floors.g.rooms[0].kind).toBeUndefined();
    expect(validate(m).ok).toBe(false);
  });
});

describe("room edge kinds wk (S1.17)", () => {
  const rooms = (version: number, r: any) => ({ version, north: 0, floors: { g: { title: "G", outline: [[0, 0], [1, 0], [1, 1]], rooms: [{ id: "r0", name: "R", area: "r", label: "", kind: "room", pts: [[0, 0], [1, 0], [1, 1]], ...r }] } } });
  for (const v of [1, 2])
    it(`v${v}: w [true, false, true] becomes wk [wall, boundary, wall], w is gone, and a second migrate changes nothing`, () => {
      const once = migrate(rooms(v, { w: [true, false, true] }));
      const r = once.floors.g.rooms[0] as any;
      expect(r.wk).toEqual(["wall", "boundary", "wall"]);
      expect(r).not.toHaveProperty("w");
      expect(migrate(once)).toEqual(once);
    });
  it("break it: w [true, true] on three points gives three entries, the third wall, and validate accepts it", () => {
    const m = migrate(rooms(2, { w: [true, true] }));
    expect((m.floors.g.rooms[0] as any).wk).toEqual(["wall", "wall", "wall"]);
    expect(validate(m).ok).toBe(true);
  });
  it("fills a missing wk with wall and pads a short one, and leaves a valid one alone", () => {
    expect((migrate(rooms(2, {})).floors.g.rooms[0] as any).wk).toEqual(["wall", "wall", "wall"]);
    expect((migrate(rooms(2, { wk: ["fence"] })).floors.g.rooms[0] as any).wk).toEqual(["fence", "wall", "wall"]);
    const kept = migrate(rooms(2, { wk: ["external", "fence", "edge"] })).floors.g.rooms[0] as any;
    expect(kept.wk).toEqual(["external", "fence", "edge"]);
  });
  it("a wk that is already there wins over a stale w, and an unknown entry is left for validate", () => {
    const r = migrate(rooms(2, { wk: ["fence", "edge", "wall"], w: [false, false, false] })).floors.g.rooms[0] as any;
    expect(r.wk).toEqual(["fence", "edge", "wall"]);
    expect(r).not.toHaveProperty("w");
    expect(validate(migrate(rooms(2, { wk: ["fence", "wall", "wall"] }))).ok).toBe(true); // the same helper is valid with good kinds
    expect(JSON.stringify(validate(migrate(rooms(2, { wk: ["fence", "bogus", "wall"] }))))).toContain("wk entries");
  });
});

describe("room free (S1.24)", () => {
  it("passes free through and adds none", () => {
    const l = structuredClone(demo) as any;
    l.floors.ground.rooms[0].free = true;
    const m = migrate(l) as any;
    expect(m.floors.ground.rooms[0].free).toBe(true);
    expect(m.floors.ground.rooms[1]).not.toHaveProperty("free");
  });
});

describe("stairs get a shape, steps and rot (S1.25)", () => {
  const bare = (t: any) => ({ version: 2, floors: { g: { outline: [[0, 0], [100, 0], [100, 100], [0, 100]], stairs: [{ pts: [[10, 10], [40, 10], [40, 40], [10, 40]], ...t }] } } });
  const stairsOf = (x: any) => (migrate(x).floors.g as any).stairs[0];
  it("fills straight, a derived step count and 0 on stairs that have none", () => {
    const t = stairsOf(bare({}));
    expect([t.shape, t.steps, t.rot]).toEqual(["straight", 2, 0]); // a 30 cm run: the floor of 2
    expect("dia" in t || "inner" in t).toBe(false);
  });
  it("keeps what is there and gives a round stair without inner an inner of 0", () => {
    expect(stairsOf(bare({ shape: "round", dia: 200, steps: 9, rot: 30 }))).toMatchObject({ shape: "round", dia: 200, inner: 0, steps: 8, rot: 30 }); // 9 is ignored
    expect(stairsOf(bare({ shape: "round", dia: 200, inner: 50 })).inner).toBe(50);
  });
  it("is idempotent and the result validates", () => {
    const once = migrate(bare({ shape: "round", dia: 200 }));
    expect(migrate(once)).toEqual(once);
    expect(validate(once).ok).toBe(true);
  });
  it("leaves rubbish for validate to report", () => {
    expect(validate(migrate(bare({ shape: "curved" }))).ok).toBe(false);
    expect(validate(migrate(bare({ steps: 3.5 }))).ok).toBe(true); // steps are derived, so a bad stored count is dropped
  });
  it("recomputes steps and ignores a stored mismatch (S1.44)", () => {
    const big = { pts: [[0, 0], [100, 0], [100, 300], [0, 300]] };
    expect(stairsOf(bare({ ...big, steps: 30 })).steps).toBe(8);
    expect(stairsOf(bare({ ...big, steps: 99 })).steps).toBe(8);
  });
});

describe("layout.colors (S1.36)", () => {
  it("is passed through untouched and never invented", () => {
    const l: any = structuredClone(demo);
    delete l.colors;
    expect("colors" in migrate(l)).toBe(false);
    l.colors = { light: "#aabbcc" };
    expect(migrate(l).colors).toEqual({ light: "#aabbcc" });
    expect("colors" in migrate(structuredClone(v1))).toBe(false);
  });
});

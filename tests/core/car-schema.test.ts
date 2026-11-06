import { describe, it, expect } from "vitest";
import { CAR_MODELS, MAX_CAR_ATTACHED, validate, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { attachedEntities, placedEntities, unplacedCatalog } from "../../src/core/bind";

// S35.1, spec C2 and criterion 1: `model`, `color` and `attached` live on a car piece only, and a layout file is
// untrusted input (finding 1): validate never throws, migrate drops what validate would refuse.
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "m1", symbol, x: 100, y: 100, rot: 0, w: 470, h: 182, ...extra });
const layoutOf = (m: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } });
const errorsOf = (m: unknown): string[] => { const r = validate(layoutOf(m)); return r.ok ? [] : r.errors; };
const furnitureOf = (l: unknown) => (l as Layout).floors.Ground.furniture[0] as unknown as Record<string, unknown>;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `sensor.car_${i}`);

describe("the car keys: constants", () => {
  it("lists nine models in the spec's order and caps attached at 24", () => {
    expect(CAR_MODELS).toEqual(["sedan", "wagon", "suv", "offroad", "truck", "van", "utility", "citycar", "electric"]);
    expect(MAX_CAR_ATTACHED).toBe(24);
  });
});

describe("validate: a car with valid keys passes, junk is reported and names the piece", () => {
  it("accepts every model with a colour and attached entities", () => {
    for (const model of CAR_MODELS) expect(errorsOf(piece("car", { model, color: "#c03030", attached: ["device_tracker.car", "sensor.battery"] })), model).toEqual([]);
  });
  it("accepts a car with none of the keys, and with 24 attached", () => {
    expect(errorsOf(piece("car"))).toEqual([]);
    expect(errorsOf(piece("car", { attached: ids(24) }))).toEqual([]);
  });
  const junk: [string, Record<string, unknown>, RegExp][] = [
    ["model Sedan", { model: "Sedan" }, /model/],
    ["model __proto__", { model: "__proto__" }, /model/],
    ["model constructor", { model: "constructor" }, /model/],
    ["model 5", { model: 5 }, /model/],
    ["color red", { color: "red" }, /color/],
    ["color #12345", { color: "#12345" }, /color/],
    ["color number", { color: 5 }, /color/],
    ["attached a string", { attached: "x" }, /attached/],
    ["attached [5]", { attached: [5] }, /attached/],
    ["attached no dot", { attached: ["x"] }, /attached/],
    ["attached with a space (review finding 12)", { attached: ["sensor.x y"] }, /attached/],
    ["attached with a second dot", { attached: ["sensor.x.y"] }, /attached/],
    ["attached with markup", { attached: ['sensor."><script>'] }, /attached/],
    ["main entity with a space", { entity: "device_tracker.my car" }, /entity/],
    ["attached repeat", { attached: ["light.x", "light.x"] }, /attached.*(twice|repeat|duplicate)/i],
    ["attached 25 ids", { attached: ids(25) }, /attached/],
  ];
  for (const [label, extra, re] of junk) {
    it(`reports ${label}, names the piece, and does not throw`, () => {
      const errs = errorsOf(piece("car", extra));
      expect(errs.length, label).toBeGreaterThan(0);
      expect(errs.some((e) => e.includes("m1") && re.test(e)), `${label}: ${errs.join(" | ")}`).toBe(true);
    });
  }
  // B53.4: `color` is the paint of any other piece now (tests/core/furniture-paint.test.ts); model and attached stay a car's.
  for (const key of ["model", "attached"] as const) {
    it(`reports ${key} on a sofa`, () => {
      const v = { model: "suv", attached: ["sensor.x"] }[key];
      const errs = errorsOf(piece("sofa", { [key]: v }));
      expect(errs.some((e) => e.includes("m1") && e.includes(key) && /car/.test(e))).toBe(true);
    });
  }
});

describe("migrate: junk is dropped, good parts kept, and the result passes validate", () => {
  const cases: Record<string, Record<string, unknown>> = {
    "model Sedan": { model: "Sedan" }, "model __proto__": { model: "__proto__" }, "model 5": { model: 5 }, "model from a newer file": { model: "hovercraft" },
    "color red": { color: "red" }, "color short": { color: "#12345" },
    "attached string": { attached: "x" }, "attached numbers": { attached: [5] }, "attached repeat": { attached: ["light.x", "light.x"] }, "attached 25": { attached: ids(25) },
    "attached object": { attached: { 0: "a.b" } }, "attached empty": { attached: [] },
  };
  for (const [label, extra] of Object.entries(cases)) {
    it(`${label}: loads and validates`, () => {
      const l = migrate(layoutOf(piece("car", extra)));
      const r = validate(l);
      expect(r.ok, r.ok ? "" : r.errors.join(" | ")).toBe(true);
    });
  }
  it("keeps the good parts of a mixed piece", () => {
    const m = furnitureOf(migrate(layoutOf(piece("car", { model: "wagon", color: "nope", attached: ["a.b", 7, "c.d", "a.b", "", "nodot"] }))));
    expect(m.model).toBe("wagon");
    expect("color" in m).toBe(false);
    expect(m.attached).toEqual(["a.b", "c.d"]);
  });
  it("cuts attached at 24, keeping the first 24 in order", () => {
    expect(furnitureOf(migrate(layoutOf(piece("car", { attached: ids(30) })))).attached).toEqual(ids(24));
  });
  it("deletes an unknown model, a bad colour and an empty attached", () => {
    const m = furnitureOf(migrate(layoutOf(piece("car", { model: "Sedan", color: "red", attached: [] }))));
    expect(Object.keys(m)).not.toContain("model");
    expect(Object.keys(m)).not.toContain("color");
    expect(Object.keys(m)).not.toContain("attached");
  });
  it("deletes model and attached from a piece that is not a car, and keeps its paint colour (B53.4)", () => {
    const m = furnitureOf(migrate(layoutOf(piece("sofa", { model: "suv", color: "#aabbcc", attached: ["a.b"] }))));
    for (const k of ["model", "attached"]) expect(Object.keys(m)).not.toContain(k);
    expect(m.color).toBe("#aabbcc");
  });
  it("a layout saved with the keys keeps them through migrate and validate", () => {
    const keep = { model: "electric", color: "#102030", attached: ["device_tracker.tesla", "sensor.tesla_battery"] };
    const l = migrate(layoutOf(piece("car", keep)));
    expect(furnitureOf(l)).toMatchObject(keep);
    const r = validate(l);
    expect(r.ok).toBe(true);
    expect(furnitureOf(r.ok ? r.layout : l)).toMatchObject(keep);
  });
  it("never writes through a polluted key", () => {
    migrate(layoutOf(piece("car", { model: "__proto__", attached: ["__proto__.x"] })));
    expect(({} as any).x).toBeUndefined();
  });
});

describe("validate never throws on a hostile car", () => {
  // A layout is parsed JSON, so the hostile shapes are JSON shapes: null, nesting, wrong types. (A getter that throws
  // cannot come out of JSON.parse, and no other field of validate defends against one either.)
  it("survives null, nested and wrong-typed values in every car key", () => {
    for (const extra of [{ model: null }, { color: null }, { attached: null }, { attached: [null, {}, []] }, { model: { a: 1 } }, { model: [] }, { color: {} }, { attached: { length: 2 } }, { attached: "__proto__.x" }])
      expect(() => validate(layoutOf(piece("car", extra)))).not.toThrow();
  });
});

describe("attachedEntities and placedEntities", () => {
  const l = (extra: Record<string, unknown>) => migrate(layoutOf(piece("car", extra)));
  it("counts a car's attached entities, so they are not offered again as icons", () => {
    expect([...attachedEntities(l({ attached: ["sensor.battery", "lock.doors"] }))].sort()).toEqual(["lock.doors", "sensor.battery"]);
  });
  it("keeps a car's main entity placed, and not attached", () => {
    const lay = l({ entity: "device_tracker.car", attached: ["sensor.battery"] });
    expect(placedEntities(lay).has("device_tracker.car")).toBe(true);
    expect(attachedEntities(lay).has("device_tracker.car")).toBe(false);
  });
  it("hides an attached entity from the unplaced catalogue", () => {
    const lay = l({ attached: ["sensor.battery"] });
    lay.catalog = [{ id: "c1", floor: "Ground", room: "", type: "temp", name: "Battery", entity: "sensor.battery" }, { id: "c2", floor: "Ground", room: "", type: "temp", name: "Other", entity: "sensor.other" }];
    expect(unplacedCatalog(lay).map((c) => c.entity)).toEqual(["sensor.other"]);
  });
  it("does not throw on junk attached", () => {
    const lay = layoutOf(piece("car", { attached: "x" })) as unknown as Layout;
    expect(() => attachedEntities(lay)).not.toThrow();
    (lay.floors.Ground.furniture[0] as any).attached = [null, 5, "a.b"];
    expect([...attachedEntities(lay)]).toEqual(["a.b"]);
  });
});

describe("one entity-id check for a car (review finding 12)", () => {
  const BAD = ["sensor.x y", "sensor.x.y", "sensor.", ".x", "x", "Sensor.X Y", 'a.b"c', ""];
  it("migrate drops what validate refuses and carEntities ignores: the three agree on every string", async () => {
    const { carEntities } = await import("../../src/core/car-status");
    for (const bad of BAD) {
      const m = furnitureOf(migrate(layoutOf(piece("car", { attached: ["sensor.good", bad] }))));
      expect(m.attached, JSON.stringify(bad)).toEqual(["sensor.good"]);
      expect(carEntities({ attached: ["sensor.good", bad] }), JSON.stringify(bad)).toEqual(["sensor.good"]);
      expect(errorsOf(piece("car", { attached: ["sensor.good", bad] })).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    for (const ok of ["sensor.x_y", "device_tracker.Car_2", "lock.a1"]) {
      expect(furnitureOf(migrate(layoutOf(piece("car", { attached: [ok] })))).attached).toEqual([ok]);
      expect(carEntities({ attached: [ok] })).toEqual([ok]);
      expect(errorsOf(piece("car", { attached: [ok] }))).toEqual([]);
    }
  });
});

describe("migrate: a car's main entity that 0.32.1 accepted but the strict id check refuses (S35 re-check)", () => {
  it.each(["sensor.my-car", "device_tracker.tesla.1", "sensor.a b"])("%s: the link goes, the car stays, the file opens", (entity) => {
    const l = migrate(layoutOf(piece("car", { entity, model: "suv" })));
    const m = furnitureOf(l);
    expect(m.entity).toBeUndefined();
    expect(m.model).toBe("suv");
    expect(validate(l).ok).toBe(true);
  });
  it("a good id stays", () => {
    expect(furnitureOf(migrate(layoutOf(piece("car", { entity: "device_tracker.Auto" })))).entity).toBe("device_tracker.Auto");
  });
  it("validate says why", () => {
    expect(errorsOf(piece("car", { entity: "sensor.my-car" })).join(" ")).toMatch(/letters, digits and underscores/);
  });
});

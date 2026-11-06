import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS, MAX_CAR_ATTACHED, validate, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { LINKABLE } from "../../src/core/link";

// B53.11 (spec 19d): `entity` and `attached` on an appliance or a plant are validated and migrated as the car's. A layout file is
// untrusted (finding 1): validate never throws, migrate drops what validate would refuse and the result passes.
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "m1", symbol, x: 100, y: 100, rot: 0, w: 60, h: 60, ...extra });
const layoutOf = (m: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } });
const errorsOf = (m: unknown): string[] => { const r = validate(layoutOf(m)); return r.ok ? [] : r.errors; };
const furnitureOf = (l: unknown) => (l as Layout).floors.Ground.furniture[0] as unknown as Record<string, unknown>;
const NEW_LINKED = LINKABLE.filter((s) => s !== "car");

describe("every symbol decides whether it links", () => {
  for (const s of FURNITURE_SYMBOLS) {
    const linked = LINKABLE.includes(s);
    it(`${s}: ${linked ? "takes" : "refuses"} entity and attached`, () => {
      const errs = errorsOf(piece(s, { entity: "sensor.a_b", attached: ["sensor.c_d"] }));
      if (linked) expect(errs, s).toEqual([]);
      else expect(errs.some((e) => e.includes("m1") && e.includes("attached") && /linked|car/.test(e)), `${s}: ${errs.join(" | ")}`).toBe(true);
    });
  }
});

describe("validate: an appliance or a plant is strict about its ids", () => {
  const junk: [string, Record<string, unknown>, RegExp][] = [
    ["main entity with a space", { entity: "sensor.my washer" }, /entity/],
    ["main entity without a dot", { entity: "washer" }, /entity/],
    ["main entity with markup", { entity: 'sensor."><script>' }, /entity/],
    ["attached a string", { attached: "sensor.x" }, /attached/],
    ["attached [5]", { attached: [5] }, /attached/],
    ["attached with a second dot", { attached: ["sensor.x.y"] }, /attached/],
    ["attached repeat", { attached: ["sensor.x", "sensor.x"] }, /attached.*(twice|repeat)/i],
    ["attached 25 ids", { attached: Array.from({ length: MAX_CAR_ATTACHED + 1 }, (_, i) => `sensor.s${i}`) }, /attached/],
  ];
  for (const sym of NEW_LINKED) for (const [label, extra, re] of junk) {
    it(`${sym}: reports ${label}`, () => {
      const errs = errorsOf(piece(sym, extra));
      expect(errs.some((e) => e.includes("m1") && re.test(e)), `${label}: ${errs.join(" | ")}`).toBe(true);
    });
  }
  it("accepts 24 attached", () => {
    expect(errorsOf(piece("washer", { attached: Array.from({ length: MAX_CAR_ATTACHED }, (_, i) => `sensor.s${i}`) }))).toEqual([]);
  });
});

describe("minMoisture: a plant's, a whole percent from 1 to 99", () => {
  for (const ok of [1, 20, 99]) it(`accepts ${ok}`, () => expect(errorsOf(piece("plant", { minMoisture: ok }))).toEqual([]));
  for (const bad of [0, 100, -5, 20.5, "20", null, NaN, Infinity, {}, [20]])
    it(`reports ${JSON.stringify(bad)}`, () => expect(errorsOf(piece("plant", { minMoisture: bad })).some((e) => e.includes("m1") && e.includes("minMoisture"))).toBe(true));
  for (const sym of FURNITURE_SYMBOLS.filter((s) => s !== "plant"))
    it(`${sym} refuses it`, () => expect(errorsOf(piece(sym, { minMoisture: 20 })).some((e) => e.includes("m1") && e.includes("minMoisture") && /plant/.test(e))).toBe(true));
});

describe("migrate: junk is dropped, good parts kept, and the result passes validate", () => {
  const cases: Record<string, Record<string, unknown>> = {
    "entity with a space": { entity: "sensor.my washer" }, "entity 5": { entity: 5 }, "attached string": { attached: "x" }, "attached numbers": { attached: [5] },
    "attached repeat": { attached: ["sensor.x", "sensor.x"] }, "attached 25": { attached: Array.from({ length: 25 }, (_, i) => `sensor.s${i}`) },
    "attached object": { attached: { 0: "a.b" } }, "attached empty": { attached: [] }, "attached __proto__": { attached: ["__proto__.x", "constructor.y"] },
    "minMoisture 0": { minMoisture: 0 }, "minMoisture 20.5": { minMoisture: 20.5 }, "minMoisture string": { minMoisture: "20" }, "minMoisture 100": { minMoisture: 100 },
  };
  for (const sym of NEW_LINKED) for (const [label, extra] of Object.entries(cases))
    it(`${sym}, ${label}: loads and validates`, () => {
      const r = validate(migrate(layoutOf(piece(sym, extra))));
      expect(r.ok, r.ok ? "" : r.errors.join(" | ")).toBe(true);
    });
  it("keeps the good parts of a mixed appliance", () => {
    const m = furnitureOf(migrate(layoutOf(piece("washer", { entity: "sensor.w", attached: ["a.b", 7, "c.d", "a.b", "", "nodot"] }))));
    expect(m.entity).toBe("sensor.w");
    expect(m.attached).toEqual(["a.b", "c.d"]);
  });
  it("keeps a good minMoisture on a plant and drops it everywhere else", () => {
    expect(furnitureOf(migrate(layoutOf(piece("plant", { minMoisture: 35 })))).minMoisture).toBe(35);
    for (const sym of FURNITURE_SYMBOLS.filter((s) => s !== "plant")) expect("minMoisture" in furnitureOf(migrate(layoutOf(piece(sym, { minMoisture: 35 }))))).toBe(false);
  });
  it("drops attached from a piece that does not link, and keeps its other keys", () => {
    const m = furnitureOf(migrate(layoutOf(piece("sofa", { attached: ["sensor.x"], color: "#aabbcc" }))));
    expect("attached" in m).toBe(false);
    expect(m.color).toBe("#aabbcc");
  });
  it("a tv keeps its loose entity from older files", () => {
    expect(furnitureOf(migrate(layoutOf(piece("tv", { entity: "media_player.tv" })))).entity).toBe("media_player.tv");
  });
});

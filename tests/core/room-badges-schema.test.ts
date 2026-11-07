import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { MAX_ROOM_SENSORS, ROOM_CORNERS, validate } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";

// B55.1 (docs/specs/batch-s52.md F32): a room's `badges`, `power` and `water`.
const clone = () => structuredClone(demo) as any;
const errs = (l: unknown) => { const r = validate(l); return r.ok ? "" : r.errors.join("\n"); };
const withRoom = (patch: Record<string, unknown>) => { const l = clone(); Object.assign(l.floors.ground.rooms[0], patch); return l; };

describe("schema: room badges", () => {
  it("accepts each of the four corners", () => {
    expect([...ROOM_CORNERS]).toEqual(["nw", "ne", "sw", "se"]);
    for (const corner of ROOM_CORNERS) expect(errs(withRoom({ badges: { corner } }))).toBe("");
  });
  it("rejects a bad shape without throwing", () => {
    for (const bad of [5, null, "nw", [], { corner: "north" }, { corner: 1 }, {}, { corner: "__proto__" }, { corner: '"><script>' }])
      expect(errs(withRoom({ badges: bad })), JSON.stringify(bad)).toMatch(/badges/);
  });
  it("power and water are lists of sensor ids, at most MAX_ROOM_SENSORS", () => {
    for (const f of ["power", "water"]) {
      expect(errs(withRoom({ [f]: ["sensor.a", "sensor.b"] }))).toBe("");
      expect(errs(withRoom({ [f]: 5 }))).toMatch(new RegExp(`${f} must be a list`));
      expect(errs(withRoom({ [f]: [5, null] }))).toMatch(new RegExp(`${f}\\[0\\]`));
      expect(errs(withRoom({ [f]: ["light.a"] }))).toMatch(new RegExp(`${f}\\[0\\]`));
      expect(errs(withRoom({ [f]: ['"><script>'] }))).toMatch(new RegExp(`${f}\\[0\\]`));
      expect(errs(withRoom({ [f]: Array.from({ length: MAX_ROOM_SENSORS }, (_, i) => `sensor.x${i}`) }))).toBe("");
      expect(errs(withRoom({ [f]: Array.from({ length: MAX_ROOM_SENSORS + 1 }, (_, i) => `sensor.x${i}`) }))).toMatch(new RegExp(`${f} holds at most`));
    }
  });
});

describe("migrate: room badges", () => {
  it("keeps good fields", () => {
    const r = (migrate(withRoom({ badges: { corner: "se" }, power: ["sensor.p"], water: ["sensor.w"] })) as any).floors.ground.rooms[0];
    expect(r.badges).toEqual({ corner: "se" });
    expect(r.power).toEqual(["sensor.p"]);
    expect(r.water).toEqual(["sensor.w"]);
  });
  it("drops bad shapes, so the file opens", () => {
    for (const bad of [5, null, "nw", { corner: "up" }, {}]) {
      const m = migrate(withRoom({ badges: bad, power: bad, water: bad })) as any;
      const r = m.floors.ground.rooms[0];
      expect("badges" in r, JSON.stringify(bad)).toBe(false);
      expect("power" in r).toBe(false);
      expect("water" in r).toBe(false);
      expect(errs(m)).toBe("");
    }
    const m = migrate(withRoom({ power: ["sensor.a", 5], water: Array.from({ length: MAX_ROOM_SENSORS + 1 }, (_, i) => `sensor.x${i}`) })) as any;
    expect(m.floors.ground.rooms[0].power).toBeUndefined();
    expect(m.floors.ground.rooms[0].water).toBeUndefined();
  });
});

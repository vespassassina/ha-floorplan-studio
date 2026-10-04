import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, type Device, type DeviceType, type Layout } from "../../src/core/schema";
import { activeDevices } from "../../src/core/active";
import { classOf, FLOORPLAN_CSS, renderFloor, type StateOverlay } from "../../src/core/render";

const ground = (demo as unknown as Layout).floors.ground;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-09-19T10:00:00Z" });
const dev = (type: DeviceType, entity: string): Device => ({ id: `${type}-x`, type, entity, x: 50, y: 50 }) as Device;
const draw = (devices: Device[], state: StateOverlay, extra: Partial<typeof ground> = {}) =>
  renderFloor({ ...ground, rooms: [], devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], ...extra } as typeof ground, { scale: 0.5, state });
const classes = (html: string) => html.match(/<g data-x="0" class="([^"]*)"/)![1].split(" ");

// Finding 17: one decision per DeviceType, typed so a new type does not compile until someone writes it down.
// true: the type wears an "on" colour on the plan for its fixture state below. A cover does only as a garage door, a
// gate or a door (Diego, 2026-10-03; the full device_class table is tests/core/cover-class.test.ts), so the fixture is garage.
const WEARS_ON: Record<DeviceType, [state: string, attrs: Record<string, unknown>, wears: boolean]> = {
  light: ["on", {}, true], motion: ["on", {}, true], contact: ["on", {}, true], heater: ["heat", { hvac_action: "heating" }, true],
  climate: ["heat", { hvac_action: "heating" }, true], ac: ["cool", { hvac_action: "cooling" }, true], tv: ["on", {}, true],
  media: ["playing", {}, true], speaker: ["playing", {}, true], cover: ["open", { device_class: "garage" }, true], plug: ["on", {}, true],
  computer: ["on", {}, true], person: ["home", {}, true], vacuum: ["cleaning", {}, true],
  switch: ["on", {}, true], temp: ["21", {}, false], humidity: ["50", {}, false], battery: ["on", {}, true], inverter: ["on", {}, true],
  server: ["on", {}, true], access_point: ["on", {}, true], lock: ["locked", {}, false], vibration: ["on", {}, true], other: ["on", {}, true],
  boiler: ["on", {}, true], car: ["on", {}, true], ups: ["on", {}, true], printer: ["on", {}, true], radar: ["on", {}, true], camera: ["idle", {}, false],
};

describe("covers with no garage, gate or door class draw idle (curtains, blinds, shutters)", () => {
  it("iterates every DeviceType: the on class follows the decision table, and the table has no gaps", () => {
    expect(Object.keys(WEARS_ON).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) {
      const [state, attrs, wears] = WEARS_ON[t];
      expect(classes(draw([dev(t, "x.e")], { "x.e": st(state, attrs) })).includes("on"), `${t} ${state}`).toBe(wears);
    }
  });
  it("a cover with no device class is never on, whatever its state; unavailable still reads unavailable", () => {
    for (const s of ["open", "opening", "closing", "closed", "on", "stopped"]) {
      expect(classOf(dev("cover", "cover.c"), { scale: 1, state: { "cover.c": st(s) } }), s).toBe("off");
      expect(classes(draw([dev("cover", "cover.c")], { "cover.c": st(s) })), s).toEqual(["dev", "dev-cover", "off"]);
    }
    expect(classOf(dev("cover", "cover.c"), { scale: 1, state: { "cover.c": st("unavailable") } })).toBe("unavailable");
  });
  it("the Active list leaves an open curtain (no class) out; a lamp beside it is still listed", () => {
    const l = { version: 2, unit: "cm", north: 0, catalog: [], floors: { f: { ...ground, rooms: [], doors: [], devices: [dev("cover", "cover.c"), dev("light", "light.l")] } } } as unknown as Layout;
    expect(activeDevices(l, { "cover.c": st("open"), "light.l": st("on") }).map((a) => a.entity)).toEqual(["light.l"]);
  });
  it("a door with an open cover keeps its orange line (doors are unchanged)", () => {
    const door = { id: "d", kind: "door", a: [0, 0], b: [90, 0], cover: "cover.c" };
    const html = draw([], { "cover.c": st("open") }, { doors: [door] } as never);
    expect(html).toContain("cover-open");
    expect(FLOORPLAN_CSS).toContain(".door.cover-open{stroke:var(--fp-open-door)");
  });
});

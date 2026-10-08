import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { validate, type Device, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { activeDevices } from "../../src/core/active";
import { classOf, renderFloor, type StateOverlay } from "../../src/core/render";
import { PLUG_ACTIVE_WATTS, findPowerSensor, plugThreshold, wattsOf } from "../../src/core/power";

const ground = (demo as unknown as Layout).floors.ground;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-03T10:00:00Z" });
const plug = (extra: Partial<Device> = {}): Device => ({ id: "plug-1", type: "plug", entity: "switch.tv", name: "TV plug", x: 50, y: 50, ...extra }) as Device;
const watts = (state: string, unit: string | undefined = "W") => st(state, unit === undefined ? {} : { unit_of_measurement: unit });
const cls = (d: Device, state: StateOverlay, extra: object = {}) => classOf(d, { scale: 1, state, ...extra });
const layoutOf = (devices: Device[]): Layout => ({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: { ...ground, rooms: [], doors: [], walls: [], openings: [], extras: [], furniture: [], stairs: [], unlinked: [], devices } } }) as unknown as Layout;

describe("wattsOf: a power reading in watts, or null", () => {
  it("reads W, kW (x1000), and a missing unit as W", () => {
    expect(wattsOf(watts("14.5"))).toBe(14.5);
    expect(wattsOf(watts("0.0035", "kW"))).toBeCloseTo(3.5, 10);
    expect(wattsOf(watts("7", undefined))).toBe(7);
  });
  it("is null for another unit, a non-number, unavailable, unknown, empty, or nothing", () => {
    for (const s of [watts("5", "mW"), watts("5", "A"), watts("5", "kWh"), watts("abc"), watts(""), watts("  "), watts("1e3"), watts("0x10"), watts("NaN"), watts("Infinity"), watts("unavailable"), watts("unknown"), undefined])
      expect(wattsOf(s as never), JSON.stringify(s)).toBeNull();
  });
  it("survives junk attributes", () => {
    expect(wattsOf({ state: "5", attributes: null } as never)).toBe(5);
    expect(wattsOf({ state: 5, attributes: {} } as never)).toBeNull();
  });
});

describe("plugThreshold: untrusted config", () => {
  it("is 2 W by default and for junk; a number >= 0 stands", () => {
    expect(PLUG_ACTIVE_WATTS).toBe(2);
    for (const v of [undefined, null, "5", NaN, Infinity, -1, {}, [], true]) expect(plugThreshold(v), String(v)).toBe(2);
    expect(plugThreshold(0)).toBe(0);
    expect(plugThreshold(10.5)).toBe(10.5);
  });
});

describe("classOf for a plug: active only while it draws power", () => {
  const d = plug({ power: "sensor.tv_power" });
  const run = (sw: string, p: ReturnType<typeof st> | undefined, extra: object = {}) => cls(d, { "switch.tv": st(sw), ...(p ? { "sensor.tv_power": p } : {}) }, extra);

  it("switch on: 1.99 W is off, exactly 2 W is on, 2.01 W is on", () => {
    expect(run("on", watts("1.99"))).toBe("off");
    expect(run("on", watts("2"))).toBe("on");
    expect(run("on", watts("2.01"))).toBe("on");
    expect(run("on", watts("0"))).toBe("off");
    expect(run("on", watts("0.4"))).toBe("off");
  });
  it("kW is scaled: 0.0019 kW is 1.9 W (off), 0.002 kW is 2 W (on)", () => {
    expect(run("on", watts("0.0019", "kW"))).toBe("off");
    expect(run("on", watts("0.002", "kW"))).toBe("on");
  });
  it("switch off is off, whatever the sensor says", () => {
    expect(run("off", watts("500"))).toBe("off");
  });
  it("switch unavailable or unknown is unavailable, whatever the sensor says (S23.5; was off, 2026-10-06)", () => {
    expect(run("unavailable", watts("500"))).toBe("unavailable");
    expect(run("unknown", watts("500"))).toBe("unavailable");
  });
  it("switch on, power unknown, unavailable, junk, another unit or not in the overlay: still on (a flaky sensor must not hide a plug)", () => {
    for (const p of [watts("unavailable"), watts("unknown"), watts("lots"), watts("50", "A"), undefined]) expect(run("on", p), JSON.stringify(p)).toBe("on");
  });
  it("no power sensor at all: today's rule, on when the switch is on", () => {
    expect(cls(plug(), { "switch.tv": st("on") })).toBe("on");
    expect(cls(plug(), { "switch.tv": st("off") })).toBe("off");
  });
  it("plug_watts overrides the threshold; junk falls back to 2", () => {
    expect(run("on", watts("5"), { plugWatts: 10 })).toBe("off");
    expect(run("on", watts("10"), { plugWatts: 10 })).toBe("on");
    expect(run("on", watts("0"), { plugWatts: 0 })).toBe("on"); // 0 W >= 0 W: "any reading counts"
    expect(run("on", watts("1.9"), { plugWatts: "x" })).toBe("off");
    expect(run("on", watts("2"), { plugWatts: "x" })).toBe("on");
  });
  it("an explicit power wins over an auto-link; a link fills in only when power is unset", () => {
    const links = { powerLinks: { "switch.tv": "sensor.auto" } };
    const state = { "switch.tv": st("on"), "sensor.auto": watts("50"), "sensor.tv_power": watts("0.1") };
    expect(cls(d, state, links)).toBe("off"); // explicit says 0.1 W
    expect(cls(plug(), state, links)).toBe("on"); // auto-link says 50 W
  });
  it("only a plug is affected: a switch device keeps the plain rule even with a power field", () => {
    const s = { ...plug({ power: "sensor.tv_power" }), type: "switch" } as Device;
    expect(cls(s, { "switch.tv": st("on"), "sensor.tv_power": watts("0") })).toBe("on");
  });
});

describe("the Active list follows the same rule", () => {
  const d = plug({ power: "sensor.tv_power" });
  it("a plug idling at 0.5 W is not listed; at 35 W it is; with no sensor it is listed when on", () => {
    expect(activeDevices(layoutOf([d]), { "switch.tv": st("on"), "sensor.tv_power": watts("0.5") })).toEqual([]);
    expect(activeDevices(layoutOf([d]), { "switch.tv": st("on"), "sensor.tv_power": watts("35") }).map((a) => a.entity)).toEqual(["switch.tv"]);
    expect(activeDevices(layoutOf([plug()]), { "switch.tv": st("on") }).map((a) => a.entity)).toEqual(["switch.tv"]);
  });
  it("takes the threshold and runtime links from its options", () => {
    const state = { "switch.tv": st("on"), "sensor.auto": watts("5") };
    expect(activeDevices(layoutOf([plug()]), state, { powerLinks: { "switch.tv": "sensor.auto" } }).map((a) => a.entity)).toEqual(["switch.tv"]);
    expect(activeDevices(layoutOf([plug()]), state, { powerLinks: { "switch.tv": "sensor.auto" }, plugWatts: 6 })).toEqual([]);
  });
});

describe("renderFloor: class, tooltip and room ring", () => {
  const draw = (devices: Device[], state: StateOverlay, extra: Partial<typeof ground> = {}) =>
    renderFloor({ ...ground, rooms: [], devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], ...extra } as typeof ground, { scale: 0.5, state });

  it("the icon wears on at 2 W and not at 1.9 W", () => {
    const d = plug({ power: "sensor.p" });
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("1.9") })).toMatch(/<g data-x="0" class="dev dev-plug off"/);
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("2") })).toMatch(/<g data-x="0" class="dev dev-plug on"/);
  });
  it("the tooltip shows live watts when known, none when not", () => {
    const d = plug({ power: "sensor.p" });
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("14") })).toContain("<title>plug: TV plug, 14 W</title>");
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("14.26") })).toContain("plug: TV plug, 14.3 W");
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("0.0125", "kW") })).toContain("plug: TV plug, 12.5 W");
    expect(draw([d], { "switch.tv": st("on"), "sensor.p": watts("unavailable") })).toContain("<title>plug: TV plug</title>");
    expect(draw([plug()], { "switch.tv": st("on") })).toContain("<title>plug: TV plug</title>");
  });
  it("the tooltip stays escaped", () => {
    const d = plug({ power: "sensor.p", name: `"><script>` });
    const html = draw([d], { "switch.tv": st("on"), "sensor.p": watts("14") });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("a room whose entity is a plug follows the rule (ring and on class)", () => {
    const room = { ...ground.rooms[0], entity: "switch.tv", area: undefined } as never;
    const d = plug({ power: "sensor.p" });
    const idle = draw([d], { "switch.tv": st("on"), "sensor.p": watts("0.4") }, { rooms: [room] });
    const busy = draw([d], { "switch.tv": st("on"), "sensor.p": watts("35") }, { rooms: [room] });
    expect(idle).not.toContain("room on ring");
    expect(busy).toContain("room on ring");
  });
});

describe("findPowerSensor: exactly one sibling, or nothing", () => {
  const sw = { id: "switch.tv", domain: "switch", dev: "d1" };
  const pw = (id: string, extra: object = {}) => ({ id, domain: "sensor", dc: "power", dev: "d1", ...extra });
  it("one sibling power sensor is the link", () => {
    expect(findPowerSensor([sw, pw("sensor.tv_power"), { id: "sensor.tv_energy", domain: "sensor", dc: "energy", dev: "d1" }], "switch.tv")).toBe("sensor.tv_power");
  });
  it("none, or two, is no link", () => {
    expect(findPowerSensor([sw], "switch.tv")).toBeUndefined();
    expect(findPowerSensor([sw, pw("sensor.a"), pw("sensor.b")], "switch.tv")).toBeUndefined();
  });
  it("diagnostic and config entities, other devices, other domains and other classes are not candidates", () => {
    const rows = [sw, pw("sensor.diag", { cat: "diagnostic" }), pw("sensor.cfg", { cat: "config" }), pw("sensor.other_dev", { dev: "d2" }), pw("sensor.nodev", { dev: undefined }), pw("binary_sensor.x", { domain: "binary_sensor" }), pw("sensor.volt", { dc: "voltage" }), pw("sensor.nodc", { dc: undefined })];
    expect(findPowerSensor(rows, "switch.tv")).toBeUndefined();
    expect(findPowerSensor([...rows, pw("sensor.real")], "switch.tv")).toBe("sensor.real");
  });
  it("a plug with no device id, or one the list does not know, has none", () => {
    expect(findPowerSensor([{ id: "switch.tv", domain: "switch" }, pw("sensor.a")], "switch.tv")).toBeUndefined();
    expect(findPowerSensor([pw("sensor.a")], "switch.tv")).toBeUndefined();
  });
  it("junk rows never throw", () => {
    expect(findPowerSensor([null, 5, { id: 7 }, sw, pw("sensor.a")] as never, "switch.tv")).toBe("sensor.a");
    expect(findPowerSensor(undefined as never, "switch.tv")).toBeUndefined();
  });
});

describe("schema: power on a plug", () => {
  const withDev = (extra: object): Layout => layoutOf([{ ...plug(), ...extra } as Device]);
  it("accepts a sensor entity id on a plug, and none", () => {
    expect(validate(withDev({ power: "sensor.tv_power" })).ok).toBe(true);
    expect(validate(withDev({})).ok).toBe(true);
  });
  it("refuses junk without throwing: a number, an object, a non-entity string, another type, the plug's own entity", () => {
    for (const power of [5, {}, [], "", "tv_power"]) {
      const r = validate(withDev({ power }));
      expect(r.ok, JSON.stringify(power)).toBe(false);
    }
    const other = validate(layoutOf([{ ...plug(), type: "light", entity: "light.l", power: "sensor.p" } as Device]));
    expect(other.ok).toBe(false);
    expect(validate(withDev({ power: "switch.tv" })).ok).toBe(false);
  });
  it("migrate keeps a power string and does not choke on junk", () => {
    const l = JSON.parse(JSON.stringify(withDev({ power: "sensor.tv_power" })));
    expect(migrate(l).floors.f.devices[0]).toMatchObject({ power: "sensor.tv_power" });
    const junk = JSON.parse(JSON.stringify(withDev({ power: { a: 1 } })));
    expect(() => migrate(junk)).not.toThrow();
  });
});

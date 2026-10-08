import { describe, it, expect } from "vitest";
import { DEVICE_TYPES, type Device, type DeviceType, type Door, type Layout } from "../../src/core/schema";
import type { StateOverlay } from "../../src/core/render";
import { ATTENTION_KINDS, ATTENTION_RULE, attention } from "../../src/core/attention";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/core/migrate";

// S24.3 (G1, G2, G3): what is wrong, before what is on.
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-08T10:00:00Z") => ({ state, attributes, last_changed });
const dev = (type: DeviceType, entity: string, extra: Record<string, unknown> = {}): Device => ({ id: `id-${entity}`, type, entity, x: 10, y: 10, ...extra }) as Device;
const door = (id: string, name: string, extra: Record<string, unknown> = {}): Door => ({ id, name, kind: "door", a: [0, 50], b: [0, 150], ...extra }) as unknown as Door;
const sq = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const floorOf = (title: string, devices: Device[], doors: Door[] = [], extra: Record<string, unknown> = {}) => ({
  title, outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], devices, doors,
  rooms: [{ id: "r1", name: "Hall", area: "", kind: "room", pts: sq(0, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"] }],
  ...extra,
});
const layoutOf = (floors: Record<string, ReturnType<typeof floorOf>>): Layout => ({ version: 2, unit: "cm", north: 0, catalog: [], floors }) as unknown as Layout;
const one = (devices: Device[], doors: Door[] = []) => layoutOf({ g: floorOf("Ground", devices, doors) });

/** For each rule, a state that must raise it and one that must not. */
const RAISE: Record<string, [ReturnType<typeof st>, string][]> = {
  alarm: [[st("triggered"), "alarm-triggered"], [st("armed_away"), "alarm-armed"], [st("armed_night"), "alarm-armed"], [st("arming"), "alarm-armed"], [st("pending"), "alarm-armed"]],
  open: [[st("on"), "open"]],
  unlocked: [[st("unlocked"), "unlocked"]],
};
const CALM: Record<string, ReturnType<typeof st>[]> = {
  alarm: [st("disarmed")], open: [st("off")], unlocked: [st("locked"), st("jammed")],
};
/** Every state that raises anything for some type: a type whose rule is "none" must raise nothing on any of them. */
const ALL_LOUD = [st("on"), st("open", { device_class: "garage" }), st("unlocked"), st("triggered"), st("armed_away"), st("5"), st("on", { device_class: "moisture" }), st("on", { device_class: "smoke" })];

describe("S24.3: every DeviceType has a written attention rule (finding 17)", () => {
  it("ATTENTION_RULE names every DeviceType and nothing else", () => {
    expect(Object.keys(ATTENTION_RULE).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it.each(DEVICE_TYPES)("%s: raises exactly what its rule says, and unavailable like every type", (t) => {
    const rule = ATTENTION_RULE[t];
    const e = t === "other" ? `binary_sensor.${t}` : `x.${t}`;
    const kinds = (s: ReturnType<typeof st>) => attention(one([dev(t, e)]), { [e]: s }).items.map((i) => i.kind);
    expect(attention(one([dev(t, e)]), { [e]: st("unavailable") }).unavailable.map((i) => i.entity)).toEqual([e]);
    expect(kinds(st("unavailable"))).toEqual([]);
    // A device's own battery (coordinator, S24.3): any type, by a numeric battery_level under 20.
    expect(kinds(st("zzz", { battery_level: 12 })), `${t} battery_level 12`).toEqual(["battery-low"]);
    expect(kinds(st("zzz", { battery_level: "19.5" })), `${t} battery_level "19.5"`).toEqual(["battery-low"]);
    for (const v of [20, 80, "abc", null, "", Number.NaN]) expect(kinds(st("zzz", { battery_level: v })), `${t} battery_level ${String(v)}`).toEqual([]);
    expect(kinds(st("unavailable", { battery_level: 5 }))).toEqual([]);
    if (rule === "none") {
      for (const s of ALL_LOUD) expect(kinds(s), `${t} ${s.state}`).toEqual([]);
      return;
    }
    if (rule === "hazard") {
      expect(kinds(st("on", { device_class: "moisture" }))).toEqual(["leak"]);
      for (const dc of ["smoke", "carbon_monoxide", "gas"]) expect(kinds(st("on", { device_class: dc })), dc).toEqual(["smoke"]);
      expect(kinds(st("off", { device_class: "moisture" }))).toEqual([]);
      expect(kinds(st("on", { device_class: "power" }))).toEqual([]);
      expect(kinds(st("on"))).toEqual([]);
      return;
    }
    if (t === "cover") {
      for (const cls of ["garage", "gate", "door"]) expect(kinds(st("open", { device_class: cls })), cls).toEqual(["open"]);
      for (const cls of ["blind", "curtain", "shutter"]) expect(kinds(st("open", { device_class: cls })), cls).toEqual([]);
      expect(kinds(st("closed", { device_class: "garage" }))).toEqual([]);
      return;
    }
    for (const [s, kind] of RAISE[rule]!) expect(kinds(s), `${t} ${s.state}`).toEqual([kind]);
    for (const s of CALM[rule]!) expect(kinds(s), `${t} ${s.state}`).toEqual([]);
  });

  it("low battery is a device's battery, never a home battery's charge (coordinator, S24.3)", () => {
    const l = one([
      dev("battery", "sensor.home_soc", { name: "Home battery" }), dev("lock", "lock.front", { name: "Front lock" }),
      dev("other", "sensor.remote_battery", { name: "Remote battery" }), dev("other", "sensor.door_battery", { name: "Door battery" }),
      dev("other", "sensor.plain", { name: "Plain" }),
    ]);
    const a = attention(l, {
      "sensor.home_soc": st("10", { device_class: "battery" }), "lock.front": st("locked", { battery_level: 12 }),
      "sensor.remote_battery": st("15", { device_class: "battery" }), "sensor.door_battery": st("20", { device_class: "battery" }),
      "sensor.plain": st("3"),
    });
    expect(a.items.map((i) => [i.kind, i.name, i.entity])).toEqual([["battery-low", "Front lock", "lock.front"], ["battery-low", "Remote battery", "sensor.remote_battery"]]);
    expect(attention(l, { "sensor.remote_battery": st("abc", { device_class: "battery" }), "lock.front": st("locked", { battery_level: {} }) }).items).toEqual([]);
  });

  it("an unlocked lock with a low battery is both", () => {
    const a = attention(one([dev("lock", "lock.front", { name: "Front lock" })]), { "lock.front": st("unlocked", { battery_level: 5 }) });
    expect(a.items.map((i) => i.kind)).toEqual(["unlocked", "battery-low"]);
    expect(a.floors.g!.count).toBe(2);
  });

  it("a hazard needs a binary sensor: a numeric moisture sensor reading 'on' is not a leak", () => {
    expect(attention(one([dev("other", "sensor.soil")]), { "sensor.soil": st("on", { device_class: "moisture" }) }).items).toEqual([]);
  });
});

describe("attention: items", () => {
  it("orders by severity, then name, and says where each thing is", () => {
    const l = one([
      dev("lock", "lock.b", { name: "B lock" }), dev("lock", "lock.a", { name: "A lock" }), dev("other", "sensor.bat", { name: "Remote" }),
      dev("alarm", "alarm_control_panel.h", { name: "Panel" }), dev("contact", "binary_sensor.c", { name: "Fridge" }),
      dev("other", "binary_sensor.leak", { name: "Sink" }), dev("other", "binary_sensor.smoke", { name: "Smoke" }),
    ]);
    const a = attention(l, {
      "lock.b": st("unlocked"), "lock.a": st("unlocked"), "sensor.bat": st("7", { device_class: "battery" }), "alarm_control_panel.h": st("armed_home"),
      "binary_sensor.c": st("on", {}, "2026-10-08T09:00:00Z"), "binary_sensor.leak": st("on", { device_class: "moisture" }), "binary_sensor.smoke": st("on", { device_class: "smoke" }),
    });
    expect(a.items.map((i) => [i.kind, i.name])).toEqual([
      ["alarm-armed", "Panel"], ["open", "Fridge"], ["unlocked", "A lock"], ["unlocked", "B lock"], ["leak", "Sink"], ["smoke", "Smoke"], ["battery-low", "Remote"],
    ]);
    expect(a.items[1]).toMatchObject({ floor: "g", at: { what: "device", index: 4, id: "id-binary_sensor.c" }, entity: "binary_sensor.c", room: "Hall", type: "contact", state: "on", lastChanged: "2026-10-08T09:00:00Z" });
    expect(ATTENTION_KINDS).toEqual(["alarm-triggered", "alarm-armed", "open", "unlocked", "leak", "smoke", "battery-low", "unavailable"]);
  });

  it("a triggered alarm comes first and flags its floor; an armed one does not flag it", () => {
    const l = layoutOf({ g: floorOf("Ground", [dev("alarm", "alarm_control_panel.a")]), f: floorOf("First", [dev("alarm", "alarm_control_panel.b"), dev("lock", "lock.x")]) });
    const a = attention(l, { "alarm_control_panel.a": st("armed_away"), "alarm_control_panel.b": st("triggered"), "lock.x": st("unlocked") });
    expect(a.items.map((i) => [i.kind, i.floor])).toEqual([["alarm-triggered", "f"], ["alarm-armed", "g"], ["unlocked", "f"]]);
    expect(a.floors).toEqual({ g: { count: 1, unavailable: 0, alarm: false }, f: { count: 2, unavailable: 0, alarm: true } });
  });

  it("G3: a door with only a lock left unlocked is Unlocked, not Open; its contact sensor makes it Open", () => {
    const d = door("d1", "Garage side door", { locks: ["lock.side"], sensors: ["binary_sensor.side"] });
    const kinds = (s: StateOverlay) => attention(one([], [d]), s).items.map((i) => [i.kind, i.name, i.room]);
    expect(kinds({ "lock.side": st("unlocked"), "binary_sensor.side": st("off") })).toEqual([["unlocked", "Garage side door", "Hall"]]);
    expect(kinds({ "lock.side": st("locked"), "binary_sensor.side": st("on") })).toEqual([["open", "Garage side door", "Hall"]]);
    expect(kinds({ "lock.side": st("unlocked"), "binary_sensor.side": st("on") })).toEqual([["open", "Garage side door", "Hall"], ["unlocked", "Garage side door", "Hall"]]);
    expect(attention(one([], [d]), { "lock.side": st("unlocked") }).items[0]).toMatchObject({ at: { what: "door", index: 0, id: "d1" }, entity: "lock.side" });
  });

  it("a door is Open when its own garage opener stands open, never for a window's curtains", () => {
    const garage = door("d1", "Garage door", { cover: "cover.garage" });
    const win = { ...door("d2", "Bay window", { cover: "cover.bay" }), kind: "window" } as Door;
    const a = attention(one([], [garage, win]), { "cover.garage": st("open"), "cover.bay": st("open") });
    expect(a.items.map((i) => [i.kind, i.name, i.entity])).toEqual([["open", "Garage door", "cover.garage"]]);
  });

  it("an entity placed as its own icon is reported once, by the icon, not again by the door", () => {
    const d = door("d1", "Front door", { locks: ["lock.front"] });
    const a = attention(one([dev("lock", "lock.front", { name: "Front lock" })], [d]), { "lock.front": st("unlocked") });
    expect(a.items.map((i) => [i.kind, i.name])).toEqual([["unlocked", "Front lock"]]);
  });

  it("unavailable: its own list, by name, one per thing; unknown and no state at all are not unavailable", () => {
    const d = door("d1", "Back door", { sensors: ["binary_sensor.b1"], locks: ["lock.b2"] });
    const a = attention(one([dev("light", "light.z", { name: "Zed" }), dev("light", "light.a", { name: "Ann" }), dev("light", "light.u"), dev("light", "light.none")], [d]), {
      "light.z": st("unavailable"), "light.a": st("unavailable"), "light.u": st("unknown"), "binary_sensor.b1": st("unavailable"), "lock.b2": st("unavailable"),
    });
    expect(a.unavailable.map((i) => [i.kind, i.name])).toEqual([["unavailable", "Ann"], ["unavailable", "Back door"], ["unavailable", "Zed"]]);
    expect(a.items).toEqual([]);
    expect(a.floors.g).toEqual({ count: 0, unavailable: 3, alarm: false });
  });

  it("a linked furniture piece that is unavailable is listed, as a piece", () => {
    const l = layoutOf({ g: floorOf("Ground", [], [], { furniture: [{ id: "tv1", symbol: "tv", x: 50, y: 50, rot: 0, w: 100, h: 10, entity: "media_player.tv", name: "Telly" }] }) });
    expect(attention(l, { "media_player.tv": st("unavailable") }).unavailable).toMatchObject([{ name: "Telly", at: { what: "piece", index: 0, id: "tv1" }, room: "Hall" }]);
  });

  it("untrusted state and layout never throw and never make up an item", () => {
    const l = one([dev("other", "sensor.b"), dev("alarm", "alarm_control_panel.a"), dev("lock", ""), dev("contact", 5 as unknown as string)], [door("d", "D", { locks: "lock.x", sensors: [null, 3] })]);
    const junk = { "sensor.b": { state: 5, attributes: null }, "alarm_control_panel.x": { state: "on", attributes: { battery_level: "5" } }, "alarm_control_panel.a": { state: "triggered" }, "lock.x": st("unlocked") } as unknown as StateOverlay;
    expect(() => attention(l, junk)).not.toThrow();
    expect(attention(l, junk).items.map((i) => i.kind)).toEqual(["alarm-triggered"]);
    expect(attention(l, { "sensor.b": st(" 12 ", { device_class: "battery" }) }).items.map((i) => i.kind)).toEqual(["battery-low"]);
    expect(attention(l, { "sensor.b": st("1e1", { device_class: "battery" }) }).items).toEqual([]);
    expect(attention(l, { "alarm_control_panel.a": { state: "disarmed", attributes: [5] } } as unknown as StateOverlay).items).toEqual([]);
    expect(attention(l, undefined)).toEqual({ items: [], unavailable: [], floors: { g: { count: 0, unavailable: 0, alarm: false } } });
    const broken = { version: 2, floors: { g: { title: "G", devices: 5, doors: null, rooms: "x", furniture: [null] } } } as unknown as Layout;
    expect(attention(broken, { x: st("on") })).toEqual({ items: [], unavailable: [], floors: { g: { count: 0, unavailable: 0, alarm: false } } });
  });
});

/**
 * The stress house (437 devices, three floors) with a hand-written state. Counted by hand, so the test documents the
 * rule. Two hazard sensors are added (the fixture has none), each a binary_sensor typed `other`.
 *
 * Ground: alarm triggered (1); open: Living patio door (contact), Garage door (its own garage opener), Mailbox (contact
 * icon), Driveway gate (a gate cover icon) (4); unlocked: Key cabinet (lock icon), Front door (one of its two locks),
 * Garage side door (its only lock) (3); battery-low: Key cabinet, its lock's battery_level at 12 (1). 9 items. The Home
 * battery at 15 % is a storage battery's charge, not a low battery, and is not counted. Unavailable: Garage camera, Living
 * spot 1 (2); Living spot 2 is unknown, not counted.
 * First: open: Master bedroom window 1 (1); leak: Master bath leak (1). 2 items. Unavailable: Master bedroom spot 1, and
 * Bedroom 2 window 1 by its contact sensor (2).
 * Second: open: Library window 1 by its contact (its curtains do not count, nor Home cinema window 1's) (1); smoke:
 * Server room smoke (1). 2 items. Unavailable: Guest bedroom spot 1, the Library TV piece (2).
 */
describe("attention on the stress house, counted by hand", () => {
  const layout = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;
  layout.floors.first!.devices.push(dev("other", "binary_sensor.master_bath_leak", { name: "Master bath leak", x: 800, y: 300 }));
  layout.floors.second!.devices.push(dev("other", "binary_sensor.server_room_smoke", { name: "Server room smoke", x: 1450, y: 1000 }));
  const state: StateOverlay = {
    "alarm_control_panel.home": st("triggered"),
    "binary_sensor.living_window_1_contact": st("on"), "lock.living_patio_door": st("locked"),
    "binary_sensor.garage_door_contact": st("off"), "cover.garage_door": st("open"),
    "binary_sensor.mailbox": st("on"), "binary_sensor.kitchen_fridge_door": st("off"),
    "cover.driveway_gate": st("open", { device_class: "gate" }), "cover.living_blind": st("open", { device_class: "blind" }),
    "lock.cloakroom_cabinet": st("unlocked", { battery_level: 12 }),
    "binary_sensor.front_door_contact": st("off"), "lock.front_door": st("locked"), "lock.front_door_deadbolt": st("unlocked"),
    "lock.garage_side_door": st("unlocked"),
    "sensor.home_battery_soc": st("15", { unit_of_measurement: "%" }),
    "camera.garage": st("unavailable"), "light.living_spot_1": st("unavailable"), "light.living_spot_2": st("unknown"),
    "binary_sensor.master_bedroom_window_1_contact": st("on"),
    "binary_sensor.master_bath_leak": st("on", { device_class: "moisture" }),
    "light.master_bedroom_spot_1": st("unavailable"), "binary_sensor.bedroom_2_window_1_contact": st("unavailable"),
    "binary_sensor.library_window_1_contact": st("on"), "cover.library_shutter_1": st("open"), "cover.home_cinema_shutter_1": st("open"),
    "binary_sensor.server_room_smoke": st("on", { device_class: "smoke" }),
    "light.guest_bedroom_spot_1": st("unavailable"), "media_player.library_tv": st("unavailable"),
  };
  const a = attention(layout, state);

  it("per-floor counts and the alarm flag", () => {
    expect(a.floors).toEqual({
      ground: { count: 9, unavailable: 2, alarm: true },
      first: { count: 2, unavailable: 2, alarm: false },
      second: { count: 2, unavailable: 2, alarm: false },
    });
  });

  it("the items, in order", () => {
    expect(a.items.map((i) => `${i.kind}: ${i.name}`)).toEqual([
      "alarm-triggered: Alarm panel",
      "open: Driveway gate", "open: Garage door", "open: Library window 1", "open: Living patio door", "open: Mailbox", "open: Master bedroom window 1",
      "unlocked: Front door", "unlocked: Garage side door", "unlocked: Key cabinet",
      "leak: Master bath leak", "smoke: Server room smoke", "battery-low: Key cabinet",
    ]);
    expect(a.unavailable.map((i) => `${i.floor}: ${i.name}`)).toEqual([
      "first: Bedroom 2 window 1", "ground: Garage camera", "second: Guest bedroom spot 1", "second: Library TV", "ground: Living spot 1", "first: Master bedroom spot 1",
    ]);
  });

  it("G3: the Garage side door is Unlocked, and the Front door names the lock that is open", () => {
    // It sits between the Office and the Garage; a door's room is the first in layout order that it borders.
    expect(a.items.find((i) => i.name === "Garage side door")).toMatchObject({ kind: "unlocked", floor: "ground", room: "Office", entity: "lock.garage_side_door", at: { what: "door", id: "door-ground-28" } });
    expect(a.items.find((i) => i.name === "Front door")!.entity).toBe("lock.front_door_deadbolt");
  });
});

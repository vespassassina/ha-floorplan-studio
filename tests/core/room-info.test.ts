import { describe, it, expect } from "vitest";
import type { Device, DeviceType, Door, Floor, Pt } from "../../src/core/schema";
import { DEVICE_TYPES } from "../../src/core/schema";
import { FLOORPLAN_CSS, renderFloor, type StateOverlay } from "../../src/core/render";
import { NO_TOGGLE } from "../../src/card/actions";
import { ROOM_ROW_TAP, deviceInfo, filterToRoom, formatChanged, meanReading, roomAreaM2, roomSummary } from "../../src/core/room-info";

// S11.3 and S11.4 (spec docs/specs/room-sensors.md, criteria 5 and 6). Pure builders: what the card's left panel shows.
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-04T10:00:00Z") => ({ state, attributes, last_changed });
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const dev = (type: DeviceType, entity: string, x: number, y: number, extra: Record<string, unknown> = {}): Device => ({ id: entity, type, entity, name: entity.split(".")[1], x, y, ...extra }) as Device;
const room = (name: string, pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: name, name, area: "", kind: "room", pts, wk: ["wall", "wall", "wall", "wall"], ...extra });
const door = (id: string, name: string, kind: string, a: Pt, b: Pt, extra: Record<string, unknown> = {}) => ({ id, name, kind, a, b, ...extra }) as unknown as Door;

// Living: 450 x 320 cm = 14.4 m2 (deliberately not square and not round). Study: 350 x 320 = 11.2 m2, to its right.
const floor = (devices: Device[], extra: Record<string, unknown> = {}): Floor => ({
  title: "Ground", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], devices,
  rooms: [
    room("Living", sq(0, 0, 450, 320), { temps: ["sensor.t1", "sensor.t2"], humidity: ["sensor.h1"], motion: ["binary_sensor.m1"] }),
    room("Study", sq(450, 0, 350, 320)),
  ],
  doors: [
    door("d1", "Hall door", "door", [450, 100], [450, 180], { sensors: ["binary_sensor.hall_contact"] }), // shared wall: borders both rooms
    door("d2", "Big window", "window", [100, 0], [300, 0], { sensors: ["binary_sensor.win"] }), // Living's top edge, closed
    door("d3", "Study window", "window", [500, 320], [700, 320], { sensors: ["binary_sensor.study_win"] }), // Study only, open
    door("d4", "Back door", "door", [0, 100], [0, 200], { locks: ["lock.back"] }), // Living only, unlocked
  ],
  ...extra,
}) as unknown as Floor;

const DEVICES = [
  dev("light", "light.lamp", 100, 100), dev("light", "light.floor", 200, 100), dev("switch", "switch.fan", 300, 100),
  dev("camera", "camera.cam", 50, 250), dev("person", "person.diego", 60, 60), dev("light", "light.desk", 600, 100),
  dev("motion", "binary_sensor.placed_motion", 150, 250), dev("heater", "climate.rad", 0, 0, { a: [10, 300], b: [110, 300], trvs: ["climate.trv"] }),
];
const STATE: StateOverlay = {
  "sensor.t1": st("21", { unit_of_measurement: "°C" }), "sensor.t2": st("22.4", { unit_of_measurement: "°C" }), "sensor.h1": st("48", { unit_of_measurement: "%" }),
  "binary_sensor.m1": st("on", {}, "2026-10-04T09:30:00Z"),
  "light.lamp": st("on", { friendly_name: "Lamp (HA)" }), "light.floor": st("off"), "switch.fan": st("on"), "light.desk": st("on"),
  "binary_sensor.hall_contact": st("on"), "binary_sensor.win": st("off"), "binary_sensor.study_win": st("on"), "lock.back": st("unlocked"),
  "camera.cam": st("idle"), "person.diego": st("home"),
};
const sum = (state: StateOverlay | undefined = STATE, f: Floor = floor(DEVICES), i = 0) => roomSummary(f, i, state, {})!;

describe("roomAreaM2", () => {
  it("is the polygon's area in square metres from its points (the plan is in cm)", () => {
    expect(roomAreaM2(sq(0, 0, 450, 320))).toBe(14.4);
    expect(roomAreaM2([[0, 0], [300, 0], [0, 200]])).toBe(3); // a triangle, winding the other way round too
    expect(roomAreaM2([[0, 0], [0, 200], [300, 0]])).toBe(3);
  });
  it("is null for junk, never NaN", () => {
    expect(roomAreaM2(5)).toBeNull();
    expect(roomAreaM2([[0, 0], [1, 1]])).toBeNull();
    expect(roomAreaM2([[0, 0], [1, NaN], [5, 5]])).toBeNull();
  });
});

describe("meanReading", () => {
  it("is the mean to 0.1 with the first unit, and the card's readout reads the same function", () => {
    expect(meanReading(["sensor.t1", "sensor.t2"], STATE)).toBe("21.7 °C");
  });
  it("skips unreadable states, and is empty with none", () => {
    expect(meanReading(["sensor.x", "sensor.t1"], { ...STATE, "sensor.x": st("unavailable") })).toBe("21 °C");
    expect(meanReading(["sensor.x"], { "sensor.x": st("unknown") })).toBe("");
    expect(meanReading(["sensor.t1"], undefined)).toBe("");
  });
});

describe("meanReading with mixed units (Opus review of Sprint 11)", () => {
  const mix = { "sensor.c": st("21", { unit_of_measurement: "°C" }), "sensor.f": st("70", { unit_of_measurement: "°F" }), "sensor.c2": st("22", { unit_of_measurement: "°C" }) };
  it("averages only the readings in the first unit seen, never a bare mean of Celsius and Fahrenheit", () => {
    expect(meanReading(["sensor.c", "sensor.f"], mix)).toBe("21 °C");
    expect(meanReading(["sensor.f", "sensor.c"], mix)).toBe("70 °F");
    expect(meanReading(["sensor.c", "sensor.f", "sensor.c2"], mix)).toBe("21.5 °C");
  });
});

describe("roomSummary", () => {
  it("names the room and gives its area, temperature and humidity", () => {
    const s = sum();
    expect(s.name).toBe("Living");
    expect(s.areaM2).toBe(14.4);
    expect(s.temperature).toBe("21.7 °C");
    expect(s.humidity).toBe("48 %");
  });
  it("reports motion on, with when it changed", () => {
    expect(sum().motion).toEqual({ on: true, since: "2026-10-04T09:30:00Z" });
    expect(sum({ ...STATE, "binary_sensor.m1": st("off", {}, "2026-10-04T11:00:00Z") }).motion).toEqual({ on: false, since: "2026-10-04T11:00:00Z" });
  });
  it("has no motion line for a room with no motion sensor", () => {
    expect(sum(STATE, floor(DEVICES), 1).motion).toBeNull();
  });
  it("lists the open doors and windows that border this room, by name, and only those", () => {
    expect(sum().openings).toEqual(["Hall door", "Back door"]); // Big window is closed; Study window is the other room's
    expect(sum(STATE, floor(DEVICES), 1).openings).toEqual(["Hall door", "Study window"]);
  });
  it("lists the lights that are on in this room by name, not the one in the other room", () => {
    expect(sum().lightsOn).toEqual(["lamp"]);
  });
  it("lists the devices standing in the room, in plan order, not a person, not another room's", () => {
    const rows = sum().devices;
    expect(rows.map((r) => r.entity)).toEqual(["light.lamp", "light.floor", "switch.fan", "camera.cam", "binary_sensor.placed_motion", "climate.rad"]);
    expect(rows[0]).toMatchObject({ index: 0, name: "lamp", type: "light", state: "on", on: true });
    expect(rows[1]).toMatchObject({ state: "off", on: false });
  });
  it("lists the room's own sensors as rows too, since they have no icon on the plan", () => {
    expect(sum().sensors.map((r) => [r.entity, r.kind, r.state])).toEqual([["sensor.t1", "temps", "21 °C"], ["sensor.t2", "temps", "22.4 °C"], ["sensor.h1", "humidity", "48 %"], ["binary_sensor.m1", "motion", "on"]]);
  });
  it("lists a sensor the room owns that also has an icon once, as a device, not again as a sensor", () => {
    const s = sum(STATE, floor([...DEVICES, dev("temp", "sensor.t1", 20, 20)]));
    expect(s.devices.map((r) => r.entity)).toContain("sensor.t1");
    expect(s.sensors.map((r) => r.entity)).toEqual(["sensor.t2", "sensor.h1", "binary_sensor.m1"]);
  });
  it("shows what it has with no HA state: no NaN, no undefined, no throw", () => {
    const s = roomSummary(floor(DEVICES), 0, undefined, {})!; // not sum(undefined): a default parameter would fill it
    expect(s.temperature).toBe("");
    expect(s.motion).toBeNull();
    expect(s.openings).toEqual([]);
    expect(s.lightsOn).toEqual([]);
    expect(s.devices[0]!.state).toBe("no state");
    expect(JSON.stringify(s)).not.toMatch(/NaN|undefined/);
  });
  it("copes with unavailable states and an empty room", () => {
    const empty = floor([], { rooms: [room("Void", sq(0, 0, 100, 100))], doors: [] });
    const s = roomSummary(empty, 0, {}, {})!;
    expect(s).toMatchObject({ name: "Void", areaM2: 1, temperature: "", humidity: "", motion: null, openings: [], lightsOn: [], devices: [], sensors: [] });
    const dead = sum({ ...STATE, "sensor.t1": st("unavailable"), "sensor.t2": st("unavailable"), "binary_sensor.m1": st("unavailable") });
    expect(dead.temperature).toBe("");
    expect(dead.motion).toBeNull();
  });
  it("is null for an index that is not a room", () => {
    expect(roomSummary(floor(DEVICES), 9, STATE, {})).toBeNull();
    expect(roomSummary(floor(DEVICES), -1, STATE, {})).toBeNull();
  });
  it("survives a hostile room", () => {
    const f = floor(DEVICES, { rooms: [room('"><script>', sq(0, 0, 450, 320), { temps: 5, motion: [5, null] })] });
    expect(() => roomSummary(f, 0, STATE, {})).not.toThrow();
    expect(roomSummary(f, 0, STATE, {})!.name).toBe('"><script>');
  });
});

describe("filterToRoom", () => {
  const rows = [
    { entity: "light.lamp" }, { entity: "light.desk" }, { entity: "binary_sensor.m1" }, { entity: "climate.trv" },
    { entity: "binary_sensor.hall_contact" }, { entity: "binary_sensor.study_win" }, { entity: "lock.back" },
  ];
  it("keeps the room's devices, its own sensors, a device's attached entities and its doors' sensors; drops the rest", () => {
    expect(filterToRoom(rows, sum()).map((r) => r.entity)).toEqual(["light.lamp", "binary_sensor.m1", "climate.trv", "binary_sensor.hall_contact", "lock.back"]);
  });
  it("keeps nothing for an empty room, and the order of the input", () => {
    const empty = roomSummary(floor([], { rooms: [room("Void", sq(0, 0, 100, 100))], doors: [] }), 0, {}, {})!;
    expect(filterToRoom(rows, empty)).toEqual([]);
  });
});

describe("a tap on a room row", () => {
  it("is decided for every device type (finding 17), and a toggling type is never one the plan refuses to toggle", () => {
    for (const t of DEVICE_TYPES) expect(["toggle", "more-info"], t).toContain(ROOM_ROW_TAP[t]);
    expect(Object.keys(ROOM_ROW_TAP).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) if (ROOM_ROW_TAP[t] === "toggle") expect(NO_TOGGLE.has(t), t).toBe(false);
  });
  it("toggles light, switch, plug and cover, and opens more-info for the rest", () => {
    expect(DEVICE_TYPES.filter((t) => ROOM_ROW_TAP[t] === "toggle")).toEqual(DEVICE_TYPES.filter((t) => ["light", "switch", "plug", "cover"].includes(t)));
  });
});

describe("deviceInfo (S11.4)", () => {
  // Shapes copied from the Home Assistant frontend (src/types.ts: hass.entities, hass.devices, hass.areas; src/data/device/device_registry.ts
  // DeviceRegistryEntry; src/data/entity/entity_registry.ts EntityRegistryDisplayEntry), read 2026-10-04: entities[id].device_id and
  // .area_id, devices[id].manufacturer / model / sw_version / area_id (all string | null), areas[id].name.
  const hass = {
    states: { "light.lamp": st("on", {}, "2026-10-04T09:30:15Z") } as StateOverlay,
    entities: { "light.lamp": { entity_id: "light.lamp", device_id: "dev1" } },
    devices: { dev1: { id: "dev1", manufacturer: "Signify", model: "Hue white", sw_version: "1.88.1", area_id: "living" } },
    areas: { living: { area_id: "living", name: "Living room" } },
  };
  const asMap = (rows: { label: string; value: string }[]) => Object.fromEntries(rows.map((r) => [r.label, r.value]));
  it("gives manufacturer, model, firmware, area, entity, state and last changed from the registry", () => {
    const rows = deviceInfo("light.lamp", hass);
    expect(rows.map((r) => r.label)).toEqual(["Manufacturer", "Model", "Firmware", "Area", "Entity", "State", "Last changed"]);
    expect(asMap(rows)).toMatchObject({ Manufacturer: "Signify", Model: "Hue white", Firmware: "1.88.1", Area: "Living room", Entity: "light.lamp", State: "on" });
    expect(asMap(rows)["Last changed"]).toBe(formatChanged("2026-10-04T09:30:15Z"));
  });
  it("shows only entity, state and last changed when the registry has no entry", () => {
    expect(deviceInfo("light.lamp", { states: hass.states }).map((r) => r.label)).toEqual(["Entity", "State", "Last changed"]);
    expect(deviceInfo("light.lamp", { ...hass, entities: {} }).map((r) => r.label)).toEqual(["Entity", "State", "Last changed"]);
    expect(deviceInfo("light.lamp", { ...hass, devices: {} }).map((r) => r.label)).toEqual(["Entity", "State", "Last changed"]);
  });
  it("drops a field the registry has as null or empty, and takes the entity's own area over its device's", () => {
    const h = { ...hass, devices: { dev1: { id: "dev1", manufacturer: null, model: "", sw_version: null, area_id: "living" } } };
    expect(deviceInfo("light.lamp", h).map((r) => r.label)).toEqual(["Area", "Entity", "State", "Last changed"]);
    const own = { ...hass, entities: { "light.lamp": { entity_id: "light.lamp", device_id: "dev1", area_id: "kitchen" } }, areas: { ...hass.areas, kitchen: { area_id: "kitchen", name: "Kitchen" } } };
    expect(asMap(deviceInfo("light.lamp", own)).Area).toBe("Kitchen");
  });
  it("says so when the entity has no state, and never prints NaN or undefined", () => {
    const rows = deviceInfo("light.gone", { states: {} });
    expect(asMap(rows)).toEqual({ Entity: "light.gone", State: "no state", "Last changed": "unknown" });
    expect(JSON.stringify(deviceInfo("light.lamp", { states: { "light.lamp": st("on", {}, "garbage") }, devices: { x: 5 }, entities: { "light.lamp": { device_id: "x" } } } as never))).not.toMatch(/NaN|undefined|Invalid/);
  });
  it("does not throw on a hostile registry", () => {
    const evil = { states: hass.states, entities: { "light.lamp": { device_id: "__proto__" } }, devices: { dev1: { manufacturer: { x: 1 }, model: 7, area_id: "constructor" } }, areas: 5 };
    expect(() => deviceInfo("light.lamp", evil as never)).not.toThrow();
  });
  it("adds a unit to a sensor's state", () => {
    expect(asMap(deviceInfo("sensor.t", { states: { "sensor.t": st("21.5", { unit_of_measurement: "°C" }) } })).State).toBe("21.5 °C");
  });
});

describe("formatChanged", () => {
  it("is ISO date and 24-hour time in the local zone", () => {
    const d = new Date("2026-10-04T09:30:15Z"), p = (n: number) => String(n).padStart(2, "0");
    expect(formatChanged("2026-10-04T09:30:15Z")).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    expect(formatChanged("nonsense")).toBe("unknown");
    expect(formatChanged(undefined)).toBe("unknown");
  });
});

describe("renderFloor: the room the card has picked (S11.3)", () => {
  const html = (selectedRoom?: number) => renderFloor(floor(DEVICES), { scale: 0.5, state: STATE, ...(selectedRoom === undefined ? {} : { selectedRoom }) });
  const rings = (h: string) => [...h.matchAll(/<polygon class="room-picked" data-picked="(\d+)"[^>]*>/g)].map((m) => Number(m[1]));
  const dataR = (h: string) => [...h.matchAll(/<polygon data-r="(\d+)"/g)].length;
  it("draws one outline ring for that room, after the walls, and never a second pick target", () => {
    expect(rings(html(1))).toEqual([1]);
    expect(rings(html(0))).toEqual([0]);
    expect(dataR(html(1))).toBe(2); // the two rooms' own polygons, and no data-r on the ring
    expect(html(1).indexOf('class="room-picked"')).toBeGreaterThan(html(1).lastIndexOf('<line class="e'));
  });
  it("does not disturb the motion perimeter's own markup or mask id when both are drawn for one room", () => {
    const withMotion = (n?: number) => renderFloor(floor(DEVICES), { scale: 0.5, state: STATE, ...(n === undefined ? {} : { selectedRoom: n }) });
    const ids = [...withMotion(0).matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, "no mask id is minted twice").toBe(ids.length);
    expect([...withMotion(0).matchAll(/class="motion-perimeter[^"]*"/g)].length).toBe([...withMotion().matchAll(/class="motion-perimeter[^"]*"/g)].length);
  });
  it("draws nothing when none is picked, or the index is not a room, or the room has no ring", () => {
    expect(rings(html())).toEqual([]);
    expect(rings(html(7))).toEqual([]);
    expect(rings(renderFloor(floor(DEVICES, { rooms: [room("Bad", [[0, 0], [1, 1]])] }), { scale: 0.5, selectedRoom: 0 }))).toEqual([]);
  });
  it("is drawn by the shared path, with a style rule for it", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.room-picked\{/);
  });
});

describe("room rows: a piece whose entity a plug device also uses (S19.B)", () => {
  // The plan draws that piece by the plug's rule (`pieceOn` with the plugs map); the room row used to skip the map and read the tv's rule.
  // The plug sits in the Study, the tv piece in the Living room, so the row's own-room dedupe does not hide it. The plug idles at 0.5 W
  // (below the 2 W threshold), so the plan shows both off while the switch itself says "on", which a tv rule would call on.
  const plug = dev("plug", "switch.tv_plug", 600, 100, { power: "sensor.tv_watts" });
  const piece = { id: "tv1", symbol: "tv", x: 100, y: 200, rot: 0, w: 100, h: 10, entity: "switch.tv_plug", name: "Telly" };
  const state: StateOverlay = { "switch.tv_plug": st("on"), "sensor.tv_watts": st("0.5", { unit_of_measurement: "W" }) };
  it("reads off, as the plan draws it, while the plug idles", () => {
    const f = floor([plug], { furniture: [piece] });
    const row = roomSummary(f, 0, state)!.devices.find((d) => d.piece)!;
    expect(row.on).toBe(false);
    expect(renderFloor(f, { state }).match(/<g[^>]*data-f="0"[^>]*>/)![0]).not.toMatch(/\bon\b/);
  });
  it("reads on when the plug draws power, and the plan agrees", () => {
    const busy: StateOverlay = { ...state, "sensor.tv_watts": st("80", { unit_of_measurement: "W" }) };
    const f = floor([plug], { furniture: [piece] });
    expect(roomSummary(f, 0, busy)!.devices.find((d) => d.piece)!.on).toBe(true);
  });
});

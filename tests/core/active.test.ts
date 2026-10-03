import { describe, it, expect } from "vitest";
import { DEVICE_TYPES, type Device, type Layout } from "../../src/core/schema";
import { ACTIVE_LIST_RULE, activeDevices, groupActiveByType } from "../../src/core/active";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-09-27T10:00:00Z" });

/** One device of `type`, with just enough fields for `activeDevices` to read. */
const dev = (type: Device["type"], entity: string, extra: Partial<Device> = {}): Device => ({ id: entity, type, entity, x: 0, y: 0, ...extra }) as Device;

/** A layout with one floor ("f") holding whatever `devices` are given. */
const layoutOf = (devices: Device[]): Layout => ({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: { title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices, furniture: [], unlinked: [] } } });

/** A state overlay that puts `entity` in whatever shape makes `classOf`/the active rule read it as "on", per type. */
const ON_STATE: Partial<Record<Device["type"], ReturnType<typeof st>>> = {
  light: st("on"), motion: st("on"), contact: st("on"), tv: st("on"), plug: st("on"), computer: st("on"), cover: st("open", { device_class: "garage" }),
  heater: st("heat", { hvac_action: "heating" }), climate: st("heat", { hvac_action: "heating" }),
  ac: st("cool", { hvac_action: "cooling" }), media: st("playing"), person: st("home"),
  camera: st("idle"), vacuum: st("cleaning"), speaker: st("playing"),
  switch: st("on"), temp: st("21"), humidity: st("50"), battery: st("on"), inverter: st("on"), server: st("on"),
  access_point: st("on"), lock: st("locked"), vibration: st("on"), other: st("on"), boiler: st("on"), car: st("on"),
  ups: st("on"), printer: st("on"), radar: st("on"),
};
/** The same devices, at rest — never active for an "on" type. */
const OFF_STATE: Partial<Record<Device["type"], ReturnType<typeof st>>> = {
  light: st("off"), motion: st("off"), contact: st("off"), tv: st("off"), plug: st("off"), computer: st("off"), cover: st("closed"),
  heater: st("heat", { hvac_action: "idle" }), climate: st("heat", { hvac_action: "idle" }),
  ac: st("off"), media: st("idle"), person: st("not_home"), speaker: st("idle"),
  camera: st("idle"), vacuum: st("returning"), // "returning" is on-plan-active but off-list (the one deliberate gap)
};

describe("S9.5: every DeviceType is a decided list membership (CLAUDE.md finding 17)", () => {
  it("ACTIVE_LIST_RULE has an entry for every DeviceType, nothing left to a catch-all", () => {
    for (const t of DEVICE_TYPES) expect(ACTIVE_LIST_RULE[t], t).toBeDefined();
    expect(Object.keys(ACTIVE_LIST_RULE).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it.each(DEVICE_TYPES)("%s: listed exactly when ACTIVE_LIST_RULE says so", (t) => {
    const entity = `x.${t}`;
    const rule = ACTIVE_LIST_RULE[t];
    const onState = ON_STATE[t] ?? st("on");
    if (rule === "always") {
      expect(activeDevices(layoutOf([dev(t, entity)]), { [entity]: onState }).map((i) => i.type)).toContain(t);
      return;
    }
    if (rule === "never") {
      expect(activeDevices(layoutOf([dev(t, entity)]), { [entity]: onState }).map((i) => i.type)).not.toContain(t);
      return;
    }
    // "on" and "cleaning" both have a real off state to check against.
    const offState = OFF_STATE[t]!;
    expect(offState, `${t} needs an OFF_STATE fixture`).toBeDefined();
    expect(activeDevices(layoutOf([dev(t, entity)]), { [entity]: onState }).map((i) => i.type)).toContain(t);
    expect(activeDevices(layoutOf([dev(t, entity)]), { [entity]: offState }).map((i) => i.type)).not.toContain(t);
  });
});

describe("activeDevices", () => {
  it("a light on has no entry: unavailable, off and no state at all are all excluded", () => {
    const l = layoutOf([dev("light", "light.a")]);
    expect(activeDevices(l, {}).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "light.a": st("off") }).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "light.a": st("unavailable") }).map((i) => i.entity)).toEqual([]);
  });

  it("a bound light (S9.5 spec: reuse classOf) counts when its switch is on, even with the light entity itself off", () => {
    const l = layoutOf([dev("light", "light.a", { bound: "switch.a" })]);
    expect(activeDevices(l, { "light.a": st("off"), "switch.a": st("on") }).map((i) => i.entity)).toEqual(["light.a"]);
  });

  it("a vacuum returning to base is on the plan (classOf) but not on this list; cleaning is", () => {
    const l = layoutOf([dev("vacuum", "vacuum.a")]);
    expect(activeDevices(l, { "vacuum.a": st("returning") }).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "vacuum.a": st("cleaning") }).map((i) => i.entity)).toEqual(["vacuum.a"]);
  });

  it("a camera is listed whatever its state, including one HA has never reported", () => {
    const l = layoutOf([dev("camera", "camera.a")]);
    expect(activeDevices(l, {}).map((i) => i.entity)).toEqual(["camera.a"]);
    expect(activeDevices(l, { "camera.a": st("idle") }).map((i) => i.entity)).toEqual(["camera.a"]);
  });

  it("Opus review finding 9: a device with an empty entity is never listed, of any type, camera included", () => {
    const l = layoutOf([dev("camera", ""), dev("light", "")]);
    expect(activeDevices(l, {}).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "": st("on") }).map((i) => i.entity)).toEqual([]);
  });

  it("Opus review finding 9: an unavailable or unknown camera is not listed", () => {
    const l = layoutOf([dev("camera", "camera.a")]);
    expect(activeDevices(l, { "camera.a": st("unavailable") }).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "camera.a": st("unknown") }).map((i) => i.entity)).toEqual([]);
  });

  it("lists devices from every floor, not only one shown floor", () => {
    const layout: Layout = {
      version: 2, unit: "cm", north: 0, catalog: [],
      floors: {
        ground: { title: "Ground", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [dev("light", "light.ground")], furniture: [], unlinked: [] },
        first: { title: "First", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [dev("light", "light.first")], furniture: [], unlinked: [] },
      },
    };
    const state = { "light.ground": st("on"), "light.first": st("on") };
    const items = activeDevices(layout, state);
    expect(items.map((i) => i.entity).sort()).toEqual(["light.first", "light.ground"]);
    expect(items.find((i) => i.entity === "light.first")!.floor).toBe("first");
  });

  it("name falls back name ?? friendly_name ?? entity, in that order", () => {
    const l = layoutOf([dev("light", "light.a", { name: "Kitchen" }), dev("light", "light.b"), dev("light", "light.c")]);
    const state = { "light.a": st("on"), "light.b": st("on", { friendly_name: "Bedroom light" }), "light.c": st("on") };
    const names = Object.fromEntries(activeDevices(l, state).map((i) => [i.entity, i.name]));
    expect(names["light.a"]).toBe("Kitchen"); // plan name wins over friendly_name it never even reads
    expect(names["light.b"]).toBe("Bedroom light");
    expect(names["light.c"]).toBe("light.c");
  });

  it("Opus review finding 2: a playing speaker is listed (it already pulses on the plan; the list must agree)", () => {
    const l = layoutOf([dev("speaker", "media_player.speaker")]);
    expect(activeDevices(l, { "media_player.speaker": st("playing") }).map((i) => i.entity)).toEqual(["media_player.speaker"]);
    expect(activeDevices(l, { "media_player.speaker": st("idle") }).map((i) => i.entity)).toEqual([]);
    expect(activeDevices(l, { "media_player.speaker": st("playing") })[0].colorVar).toBe("--fp-dev-speaker");
  });

  it("Opus review finding 1: a tv is listed for playing/paused/idle/on, not only 'on'; off/standby are excluded", () => {
    const l = layoutOf([dev("tv", "media_player.tv")]);
    for (const s of ["on", "playing", "paused", "idle"]) {
      expect(activeDevices(l, { "media_player.tv": st(s) }).map((i) => i.entity), s).toEqual(["media_player.tv"]);
    }
    for (const s of ["off", "standby"]) {
      expect(activeDevices(l, { "media_player.tv": st(s) }).map((i) => i.entity), s).toEqual([]);
    }
  });

  it("Opus review finding 10: a camera's row colour is --fp-ink, not --fp-dev-camera (that resolves to the same shade as --fp-idle/--fp-room in blueprint, unreadable on the panel's own --fp-room background)", () => {
    const l = layoutOf([dev("camera", "camera.a")]);
    expect(activeDevices(l, { "camera.a": st("idle") })[0].colorVar).toBe("--fp-ink");
  });

  it("an ac takes its colour var from acMode: cool or heat, never a flat --fp-dev-ac", () => {
    const l = layoutOf([dev("ac", "climate.cool"), dev("ac", "climate.heat")]);
    const state = { "climate.cool": st("cool", { hvac_action: "cooling" }), "climate.heat": st("heat", { hvac_action: "heating" }) };
    const items = activeDevices(l, state);
    expect(items.find((i) => i.entity === "climate.cool")!.colorVar).toBe("--fp-dev-ac-cool");
    expect(items.find((i) => i.entity === "climate.heat")!.colorVar).toBe("--fp-dev-ac-heat");
  });
});

describe("S10.3: a door's own contact/vibration sensors join the active list under the door's name", () => {
  /** A layout with one floor ("f") holding one door and no devices. */
  const layoutWithDoor = (door: Partial<Layout["floors"]["f"]["doors"][number]>): Layout => ({
    version: 2, unit: "cm", north: 0, catalog: [],
    floors: { f: { title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [{ id: "d", name: "Front door", kind: "door", a: [0, 0], b: [1, 0], ...door }], openings: [], extras: [], devices: [], furniture: [], unlinked: [] } },
  });

  it("a contact sensor attached to a door is listed under the door's name when on, not when off", () => {
    const l = layoutWithDoor({ sensors: ["binary_sensor.front"] });
    const on = activeDevices(l, { "binary_sensor.front": st("on") });
    expect(on).toEqual([{ entity: "binary_sensor.front", name: "Front door", type: "contact", floor: "f", colorVar: "--fp-open-door" }]);
    expect(activeDevices(l, { "binary_sensor.front": st("off") })).toEqual([]);
  });

  it("a vibration sensor attached to a door is listed under the door's name, as type vibration", () => {
    const l = layoutWithDoor({ vibration: ["binary_sensor.shake"] });
    const on = activeDevices(l, { "binary_sensor.shake": st("on") });
    expect(on).toEqual([{ entity: "binary_sensor.shake", name: "Front door", type: "vibration", floor: "f", colorVar: "--fp-open-door" }]);
    expect(activeDevices(l, { "binary_sensor.shake": st("off") })).toEqual([]);
  });

  it("unavailable/unknown door sensors are excluded, same as any other type", () => {
    const l = layoutWithDoor({ sensors: ["binary_sensor.front"] });
    expect(activeDevices(l, { "binary_sensor.front": st("unavailable") })).toEqual([]);
    expect(activeDevices(l, { "binary_sensor.front": st("unknown") })).toEqual([]);
    expect(activeDevices(l, {})).toEqual([]);
  });

  it("a sensor attached to a door is never duplicated when the same entity is also a placed device icon", () => {
    const layout: Layout = {
      version: 2, unit: "cm", north: 0, catalog: [],
      floors: {
        f: {
          title: "F", outline: [], rooms: [], walls: [], stairs: [],
          doors: [{ id: "d", name: "Front door", kind: "door", a: [0, 0], b: [1, 0], sensors: ["binary_sensor.front"] }],
          openings: [], extras: [], devices: [dev("contact", "binary_sensor.front")], furniture: [], unlinked: [],
        },
      },
    };
    const items = activeDevices(layout, { "binary_sensor.front": st("on") });
    expect(items).toEqual([{ entity: "binary_sensor.front", name: "binary_sensor.front", type: "contact", floor: "f", colorVar: "--fp-dev-contact" }]);
  });

  it("both a contact and a vibration sensor on the same door each get their own row", () => {
    const l = layoutWithDoor({ sensors: ["binary_sensor.front"], vibration: ["binary_sensor.shake"] });
    const items = activeDevices(l, { "binary_sensor.front": st("on"), "binary_sensor.shake": st("on") });
    expect(items.map((i) => i.entity).sort()).toEqual(["binary_sensor.front", "binary_sensor.shake"]);
    expect(items.every((i) => i.name === "Front door")).toBe(true);
  });
});

describe("groupActiveByType", () => {
  it("groups by type in DEVICE_TYPES' own order, dropping empty types", () => {
    const items = activeDevices(layoutOf([dev("camera", "camera.a"), dev("light", "light.a"), dev("light", "light.b"), dev("motion", "motion.a")]), {
      "camera.a": st("idle"), "light.a": st("on"), "light.b": st("on"), "motion.a": st("on"),
    });
    const grouped = groupActiveByType(items);
    expect(grouped.map(([t]) => t)).toEqual(["light", "motion", "camera"]); // DEVICE_TYPES order, not insertion order
    expect(grouped.find(([t]) => t === "light")![1]).toHaveLength(2);
  });

  it("no active devices: an empty list, not an empty group", () => {
    expect(groupActiveByType([])).toEqual([]);
  });
});

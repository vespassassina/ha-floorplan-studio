import { describe, it, expect } from "vitest";
import type { Device, Floor, Pt } from "../../src/core/schema";
import { validate } from "../../src/core/schema";
import { customCalls, haScenesFor, presetCalls, roomScenes, sceneNeedsConfirm } from "../../src/core/room-scenes";
import { readFileSync } from "node:fs";

// S14.7 (docs/specs/card-polish-and-light.md, item 19). Pure rules: which scenes a room offers, and which service calls
// each makes. The registry shapes are those of Home Assistant's frontend `hass` (src/types.ts): `entities[id].area_id` and
// `.device_id`, `devices[id].area_id`; scene.turn_on and light.turn_on take `entity_id` (+ brightness_pct, color_temp_kelvin,
// hs_color), as in the HA docs for the light and scene integrations.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-06T10:00:00Z" });
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const dev = (type: string, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity.split(".")[1], x, y }) as Device;
const floorWith = (rooms: Record<string, unknown>[], devices: Device[]): Floor => ({
  title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices,
  rooms: rooms.map((r, i) => ({ id: `r${i}`, name: `R${i}`, area: "", kind: "room", pts: sq(i * 500, 0, 400, 400), wk: ["wall", "wall", "wall", "wall"], ...r })),
}) as unknown as Floor;

const HASS = {
  states: {
    "scene.relax": st("scheduled", { friendly_name: "Living relax" }), "scene.hue_bright": st("unknown", { friendly_name: "Bright" }),
    "scene.kitchen_cook": st("unknown", { friendly_name: "Cook" }), "scene.stray": st("unknown", { friendly_name: "Stray" }),
    "sensor.x": st("1"), "light.a": st("on"), "light.b": st("off"),
  },
  entities: {
    "scene.relax": { area_id: "living" },                       // area on the entity itself
    "scene.hue_bright": { device_id: "hue_room", area_id: null }, // area through its device (the Hue integration's way)
    "scene.kitchen_cook": { area_id: "kitchen" },
    "sensor.x": { area_id: "living" },
  },
  devices: { hue_room: { area_id: "living" } },
};

describe("haScenesFor: scene.* entities of the room", () => {
  const f = floorWith([{ area: "living", haScenes: ["scene.stray"] }, { area: "kitchen" }, { area: "" }], []);
  it("lists scenes whose entity area, or whose device's area, is the room's area, plus the explicit list; names from friendly_name", () => {
    expect(haScenesFor(f.rooms[0], HASS)).toEqual([
      { entity: "scene.hue_bright", name: "Bright" }, { entity: "scene.relax", name: "Living relax" }, { entity: "scene.stray", name: "Stray" },
    ]);
  });
  it("does not leak another room's scene, and a room with no area has only its explicit list", () => {
    expect(haScenesFor(f.rooms[1], HASS)).toEqual([{ entity: "scene.kitchen_cook", name: "Cook" }]);
    expect(haScenesFor(f.rooms[2], HASS)).toEqual([]);
  });
  it("lists an explicit scene once, and drops one Home Assistant no longer has", () => {
    const r = { ...f.rooms[0], haScenes: ["scene.relax", "scene.relax", "scene.gone"] };
    expect(haScenesFor(r, HASS).map((s) => s.entity)).toEqual(["scene.hue_bright", "scene.relax"]);
  });
  it("falls back to the entity id for a scene with no friendly name, and works with no registry at all", () => {
    expect(haScenesFor({ ...f.rooms[0], haScenes: ["scene.plain"] }, { states: { "scene.plain": st("unknown") } })).toEqual([{ entity: "scene.plain", name: "scene.plain" }]);
  });
  it("never throws on a hostile room or hass", () => {
    for (const r of [{ area: 5, haScenes: 7 }, { area: "living", haScenes: [null, 3, {}] }, null, undefined, "x"]) expect(() => haScenesFor(r as never, HASS)).not.toThrow();
    for (const h of [undefined, null, {}, { states: 5 }, { states: HASS.states, entities: 5, devices: [] }]) expect(() => haScenesFor(f.rooms[0], h as never)).not.toThrow();
    expect(haScenesFor({ area: "living" } as never, { states: HASS.states, entities: { "scene.relax": 5 } } as never)).toEqual([]);
  });
});

describe("customCalls: a custom scene through the light and switch services", () => {
  it("turns a light on with only the fields it sets, off with a bare turn_off, a switch on and off", () => {
    const calls = customCalls({ id: "s", name: "Movie", items: [
      { entity: "light.a", on: true, brightness: 30, kelvin: 2400 }, { entity: "light.b", on: true, hs: [200, 80] }, { entity: "light.c", on: false },
      { entity: "switch.fan", on: true }, { entity: "switch.heat", on: false }, { entity: "light.d", on: true },
    ] });
    expect(calls).toEqual([
      { domain: "light", service: "turn_on", data: { entity_id: "light.a", brightness_pct: 30, color_temp_kelvin: 2400 } },
      { domain: "light", service: "turn_on", data: { entity_id: "light.b", hs_color: [200, 80] } },
      { domain: "light", service: "turn_off", data: { entity_id: "light.c" } },
      { domain: "switch", service: "turn_on", data: { entity_id: "switch.fan" } },
      { domain: "switch", service: "turn_off", data: { entity_id: "switch.heat" } },
      { domain: "light", service: "turn_on", data: { entity_id: "light.d" } },
    ]);
  });
  it("skips what it cannot do: another domain, a bad entity, a malformed item, and never throws", () => {
    const calls = customCalls({ id: "s", name: "x", items: [{ entity: "lock.x", on: true }, { entity: 5, on: true }, null, { entity: "light.ok", on: true, brightness: NaN }] } as never);
    expect(calls).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: "light.ok" } }]);
    for (const s of [null, 5, {}, { items: 7 }, { items: [[]] }]) expect(customCalls(s as never)).toEqual([]);
  });
  it("asks to confirm only when it turns a non-light OFF (S14.2's rule: a light is exempt)", () => {
    expect(sceneNeedsConfirm({ id: "a", name: "a", items: [{ entity: "light.a", on: false }, { entity: "switch.s", on: true }] })).toBe(false);
    expect(sceneNeedsConfirm({ id: "b", name: "b", items: [{ entity: "light.a", on: true }, { entity: "switch.s", on: false }] })).toBe(true);
    expect(sceneNeedsConfirm(null as never)).toBe(false);
  });
});

describe("roomScenes: what the card's Room section lists", () => {
  const f = floorWith([{ area: "living", scenes: [{ id: "s1", name: "Movie", items: [{ entity: "light.a", on: true, brightness: 20 }] }] }, { area: "kitchen" }], [
    dev("light", "light.a", 100, 100), dev("light", "light.b", 200, 100), dev("switch", "switch.fan", 300, 100), dev("light", "light.k", 700, 100),
  ]);
  it("gives HA scenes, custom scenes and the two presets over the room's own lights only", () => {
    const m = roomScenes(f, 0, HASS);
    expect(m.ha.map((s) => s.entity)).toEqual(["scene.hue_bright", "scene.relax"]);
    expect(m.custom).toEqual([{ id: "s1", name: "Movie", confirm: false }]);
    expect(m.lights).toEqual(["light.a", "light.b"]);
  });
  it("a room with no scene and no light has nothing, so the card shows no section", () => {
    expect(roomScenes(floorWith([{}], []), 0, { states: {} })).toEqual({ ha: [], custom: [], lights: [] });
    expect(roomScenes(f, 9, HASS)).toEqual({ ha: [], custom: [], lights: [] });
  });
  it("All off and All on are one light.turn_off / light.turn_on over those lights; none with no lights", () => {
    expect(presetCalls("off", ["light.a", "light.b"])).toEqual([{ domain: "light", service: "turn_off", data: { entity_id: ["light.a", "light.b"] } }]);
    expect(presetCalls("on", ["light.a"])).toEqual([{ domain: "light", service: "turn_on", data: { entity_id: ["light.a"] } }]);
    expect(presetCalls("off", [])).toEqual([]);
  });
  it("a preset uses each entity's own domain: light.*, switch.*, and homeassistant.* for anything else (S14 review)", () => {
    const e = ["light.a", "switch.b", "light.c", "fan.d", "group.e", "input_boolean.f"];
    expect(presetCalls("off", e)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.a", "light.c"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.b"] } },
      { domain: "homeassistant", service: "turn_off", data: { entity_id: ["fan.d", "group.e", "input_boolean.f"] } },
    ]);
    expect(presetCalls("on", ["switch.b"])).toEqual([{ domain: "switch", service: "turn_on", data: { entity_id: ["switch.b"] } }]);
    expect(presetCalls("on", ["nodot", ""])).toEqual([{ domain: "homeassistant", service: "turn_on", data: { entity_id: ["nodot", ""] } }]);
  });
  it("skips a malformed scene in the layout instead of throwing", () => {
    const bad = floorWith([{ area: "living", scenes: [null, 5, { id: 1 }, { id: "ok", name: "Ok", items: [] }] }], []);
    expect(roomScenes(bad, 0, HASS).custom).toEqual([{ id: "ok", name: "Ok", confirm: false }]);
    expect(() => roomScenes(floorWith([{ scenes: 5 }], []), 0, HASS)).not.toThrow();
  });
});

describe("validate: the optional scene fields (layout files are untrusted)", () => {
  const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
  const withRoom = (extra: unknown) => { const l = structuredClone(demo); Object.assign(l.floors.ground.rooms[0], extra); return l; };
  const errors = (l: unknown) => { const v = validate(l); return v.ok ? [] : v.errors; };
  const good = { scenes: [{ id: "s1", name: "Movie", items: [{ entity: "light.demo_living", on: true, brightness: 40, kelvin: 2700 }, { entity: "switch.demo_hall", on: false }, { entity: "light.demo_kitchen", on: true, hs: [10, 90] }] }], haScenes: ["scene.relax"] };
  it("accepts good scenes and no scenes at all (the demo has none)", () => {
    expect(errors(withRoom(good))).toEqual([]);
    expect(errors(demo)).toEqual([]);
  });
  it.each([
    ["scenes not a list", { scenes: 5 }, /scenes/],
    ["a scene that is not an object", { scenes: [null] }, /scenes\[0\]/],
    ["no name", { scenes: [{ id: "a", name: "", items: [] }] }, /name/],
    ["a duplicate id", { scenes: [{ id: "a", name: "A", items: [] }, { id: "a", name: "B", items: [] }] }, /id/],
    ["items not a list", { scenes: [{ id: "a", name: "A", items: "x" }] }, /items/],
    ["too many scenes", { scenes: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, name: "n", items: [] })) }, /at most 12/],
    ["too many items", { scenes: [{ id: "a", name: "A", items: Array.from({ length: 41 }, () => ({ entity: "light.x", on: true })) }] }, /at most 40/],
    ["an item entity that is a sensor", { scenes: [{ id: "a", name: "A", items: [{ entity: "sensor.x", on: true }] }] }, /light or switch/],
    ["on not a boolean", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: "yes" }] }] }, /on must be/],
    ["brightness 0", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, brightness: 0 }] }] }, /brightness/],
    ["brightness 101", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, brightness: 101 }] }] }, /brightness/],
    ["brightness NaN", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, brightness: NaN }] }] }, /brightness/],
    ["kelvin 500", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, kelvin: 500 }] }] }, /kelvin/],
    ["hs out of range", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, hs: [361, 10] }] }] }, /hs/],
    ["hs with one number", { scenes: [{ id: "a", name: "A", items: [{ entity: "light.x", on: true, hs: [1] }] }] }, /hs/],
    ["haScenes not a list", { haScenes: "scene.a" }, /haScenes/],
    ["haScenes naming a light", { haScenes: ["light.a"] }, /scene\.name/],
  ])("refuses %s", (_n, extra, re) => {
    const e = errors(withRoom(extra));
    expect(e.length, JSON.stringify(e)).toBeGreaterThan(0);
    expect(e.join("\n")).toMatch(re);
  });
  it("never throws on garbage in the scene fields", () => {
    for (const extra of [{ scenes: [[]] }, { scenes: [{ items: [null, 5, [], { hs: {} }] }] }, { scenes: [{ id: {}, name: [], items: [{ entity: {}, on: {}, brightness: {}, kelvin: {}, hs: null }] }] }, { haScenes: [null, {}, 5] }, { scenes: { length: 99 } }]) expect(() => validate(withRoom(extra))).not.toThrow();
  });
});

// S17.2 (docs/specs/scene-designer.md): fan, cover, climate and media_player join light and switch. One list of what each
// type may set, one function that turns an item into calls. A type outside the list is ignored, never an error.
describe("customCalls: fan, cover, climate and media_player", () => {
  const calls = (items: object[]) => customCalls({ id: "s", name: "x", items } as never);
  it("fan: on with a speed, on bare, off", () => {
    expect(calls([{ entity: "fan.a", on: true, percentage: 60 }, { entity: "fan.b", on: true }, { entity: "fan.c", on: false }])).toEqual([
      { domain: "fan", service: "turn_on", data: { entity_id: "fan.a", percentage: 60 } },
      { domain: "fan", service: "turn_on", data: { entity_id: "fan.b" } },
      { domain: "fan", service: "turn_off", data: { entity_id: "fan.c" } },
    ]);
  });
  it("cover: a position wins, else on opens and off closes", () => {
    expect(calls([{ entity: "cover.a", on: true, position: 30 }, { entity: "cover.b", on: true }, { entity: "cover.c", on: false }])).toEqual([
      { domain: "cover", service: "set_cover_position", data: { entity_id: "cover.a", position: 30 } },
      { domain: "cover", service: "open_cover", data: { entity_id: "cover.b" } },
      { domain: "cover", service: "close_cover", data: { entity_id: "cover.c" } },
    ]);
  });
  it("climate: a mode and a temperature are two calls, bare on is turn_on, off is turn_off", () => {
    expect(calls([{ entity: "climate.a", on: true, hvac: "heat", temperature: 21.5 }, { entity: "climate.b", on: true, temperature: 19 }, { entity: "climate.c", on: true }, { entity: "climate.d", on: false }])).toEqual([
      { domain: "climate", service: "set_hvac_mode", data: { entity_id: "climate.a", hvac_mode: "heat" } },
      { domain: "climate", service: "set_temperature", data: { entity_id: "climate.a", temperature: 21.5 } },
      { domain: "climate", service: "set_temperature", data: { entity_id: "climate.b", temperature: 19 } },
      { domain: "climate", service: "turn_on", data: { entity_id: "climate.c" } },
      { domain: "climate", service: "turn_off", data: { entity_id: "climate.d" } },
    ]);
  });
  it("media_player: on, then volume as a 0..1 level, then the source; off is turn_off", () => {
    expect(calls([{ entity: "media_player.a", on: true, volume: 25, source: "Spotify" }, { entity: "media_player.b", on: false }])).toEqual([
      { domain: "media_player", service: "turn_on", data: { entity_id: "media_player.a" } },
      { domain: "media_player", service: "volume_set", data: { entity_id: "media_player.a", volume_level: 0.25 } },
      { domain: "media_player", service: "select_source", data: { entity_id: "media_player.a", source: "Spotify" } },
      { domain: "media_player", service: "turn_off", data: { entity_id: "media_player.b" } },
    ]);
  });
  it("junk fields are dropped, never thrown on; an off item ignores its fields", () => {
    expect(calls([
      { entity: "fan.a", on: true, percentage: NaN }, { entity: "cover.a", on: true, position: "x" }, { entity: "climate.a", on: true, hvac: 5, temperature: Infinity },
      { entity: "media_player.a", on: true, volume: NaN, source: 7 }, { entity: "fan.z", on: false, percentage: 50 },
    ])).toEqual([
      { domain: "fan", service: "turn_on", data: { entity_id: "fan.a" } },
      { domain: "cover", service: "open_cover", data: { entity_id: "cover.a" } },
      { domain: "climate", service: "turn_on", data: { entity_id: "climate.a" } },
      { domain: "media_player", service: "turn_on", data: { entity_id: "media_player.a" } },
      { domain: "fan", service: "turn_off", data: { entity_id: "fan.z" } },
    ]);
  });
  it("turning a fan, climate or player OFF asks first; a cover and a light do not", () => {
    for (const e of ["fan.a", "climate.a", "media_player.a"]) expect(sceneNeedsConfirm({ id: "s", name: "x", items: [{ entity: e, on: false }] })).toBe(true);
    for (const e of ["cover.a", "light.a"]) expect(sceneNeedsConfirm({ id: "s", name: "x", items: [{ entity: e, on: false }] })).toBe(false);
  });
});

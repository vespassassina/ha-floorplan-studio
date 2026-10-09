import { describe, it, expect } from "vitest";
import { DEVICE_TYPES, type Device, type DeviceType, type Floor } from "../../src/core/schema";
import type { StateOverlay } from "../../src/core/render";
import { FLOOR_OFF_GROUP, floorOffCalls, floorOffRows } from "../../src/core/floor-off";

// S24.8 (C2): "Turn off on this floor…". What the checklist lists, and the calls a confirm sends. Call shapes are the ones
// the card already sends for All off (`presetCalls`): callService(domain, "turn_off", { entity_id: [...] }), one per domain.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T10:00:00Z" });
const dev = (type: DeviceType, entity: string, x: number, extra: Partial<Device> = {}): Device => ({ id: entity, type, entity, name: entity.split(".")[1], x, y: 100, ...extra }) as Device;
const floor = (devices: Device[], furniture: unknown[] = []): Floor => ({
  title: "Ground", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], devices, furniture,
  rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [800, 0], [800, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }],
}) as unknown as Floor;

describe("FLOOR_OFF_GROUP: every device type is a decision (finding 17)", () => {
  it("names a group or null for each type, and only these four types are listed", () => {
    for (const t of DEVICE_TYPES) expect(Object.hasOwn(FLOOR_OFF_GROUP, t), t).toBe(true);
    const listed = DEVICE_TYPES.filter((t) => FLOOR_OFF_GROUP[t] !== null);
    expect(Object.fromEntries(listed.map((t) => [t, FLOOR_OFF_GROUP[t]]))).toEqual({ light: "lights", switch: "switches", plug: "plugs", tv: "media", media: "media", speaker: "media" });
  });
});

describe("floorOffRows: what is on, one row per thing, grouped", () => {
  const f = floor([
    dev("light", "light.on", 100), dev("light", "light.off", 120),
    dev("light", "light.relay_lit", 140, { bound: "switch.relay" } as Partial<Device>),
    dev("switch", "switch.fan", 160), dev("switch", "switch.idle", 170),
    dev("plug", "switch.kettle", 180),
    dev("tv", "media_player.tv", 200), dev("speaker", "media_player.kitchen", 220), dev("media", "media_player.off", 240),
    dev("heater", "climate.heater", 260), dev("motion", "binary_sensor.motion", 280), dev("cover", "cover.garage", 300),
  ]);
  const state: StateOverlay = {
    "light.on": st("on", { friendly_name: "Ceiling" }), "light.off": st("off"),
    "light.relay_lit": st("off"), "switch.relay": st("on", { friendly_name: "Hall relay" }),
    "switch.fan": st("on"), "switch.idle": st("off"), "switch.kettle": st("on"),
    "media_player.tv": st("idle"), "media_player.kitchen": st("paused"), "media_player.off": st("standby"),
    "climate.heater": st("heat"), "binary_sensor.motion": st("on"), "cover.garage": st("open"),
  };
  const rows = floorOffRows(f, state);

  it("lists only the things that are on, in group order then layout order", () => {
    expect(rows.map((r) => [r.group, r.entities])).toEqual([
      ["lights", ["light.on"]],
      ["lights", ["switch.relay"]], // drawn lit by its relay: the relay is what turns it off (S22.1)
      ["switches", ["switch.fan"]],
      ["plugs", ["switch.kettle"]],
      ["media", ["media_player.tv"]],
      ["media", ["media_player.kitchen"]], // paused is still on: turning it off means something
    ]);
  });

  it("names a row by the plan name, else HA's, and says which relay a lamp goes off with", () => {
    expect(rows[0]!.name).toBe("on");
    expect(rows[1]!.via).toBe("Hall relay");
    expect(rows[0]!.via).toBeUndefined();
    expect(rows[1]!.at).toEqual({ what: "device", index: 2 });
  });

  it("a linked tv piece is a media row; a piece whose entity a device lists is not repeated", () => {
    const g = floor([dev("tv", "media_player.lounge", 100)], [
      { id: "p1", symbol: "tv", x: 300, y: 100, w: 100, d: 10, rot: 0, entity: "media_player.lounge" },
      { id: "p2", symbol: "tv", x: 400, y: 100, w: 100, d: 10, rot: 0, entity: "media_player.den" },
    ]);
    const r = floorOffRows(g, { "media_player.lounge": st("on"), "media_player.den": st("playing") });
    expect(r.map((x) => [x.entities, x.at])).toEqual([
      [["media_player.lounge"], { what: "device", index: 0 }],
      [["media_player.den"], { what: "piece", index: 1 }],
    ]);
  });

  it("unavailable and unknown are not on; nothing on is an empty list", () => {
    expect(floorOffRows(floor([dev("switch", "switch.x", 1), dev("tv", "media_player.y", 2)]), { "switch.x": st("unavailable"), "media_player.y": st("unknown") })).toEqual([]);
    expect(floorOffRows(f, {})).toEqual([]);
  });

  it("never throws on a malformed floor (finding 1)", () => {
    for (const junk of [null, {}, { devices: 5 }, { devices: [null, 3, { type: "light" }], furniture: "x" }]) {
      expect(floorOffRows(junk as unknown as Floor, state)).toEqual([]);
    }
  });
});

describe("floorOffCalls: exactly the ticked rows, one call per domain", () => {
  it("each domain to its own turn_off; a relay two lamps share goes once; anything else to homeassistant", () => {
    const rows = [
      { entities: ["light.a", "switch.relay"] }, { entities: ["switch.relay"] }, { entities: ["switch.plug"] },
      { entities: ["media_player.tv"] }, { entities: ["input_boolean.power"] },
    ];
    expect(floorOffCalls(rows)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.a"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay", "switch.plug"] } },
      { domain: "media_player", service: "turn_off", data: { entity_id: ["media_player.tv"] } },
      { domain: "homeassistant", service: "turn_off", data: { entity_id: ["input_boolean.power"] } },
    ]);
  });
  it("no rows, no calls", () => {
    expect(floorOffCalls([])).toEqual([]);
  });
});

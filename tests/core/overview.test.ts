import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Device, DeviceType, Door, Floor, Layout, Pt } from "../../src/core/schema";
import type { StateOverlay } from "../../src/core/render";
import { activeDevices } from "../../src/core/active";
import { formatAge, relayText, roomSummary } from "../../src/core/room-info";

// S24.7: what the card's Overview rows need from core. A row carries where its thing is (so a tap can find it on the
// plan) and its room; a lamp lit only by its relay reads on, as the plan draws it (S22.F4); an Attention row says how long.
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-08T10:00:00Z") => ({ state, attributes, last_changed });
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const dev = (type: DeviceType, entity: string, x: number, y: number, extra: Record<string, unknown> = {}): Device => ({ id: entity, type, entity, x, y, ...extra }) as Device;
const room = (name: string, pts: Pt[]) => ({ id: name, name, area: "", kind: "room", pts, wk: ["wall", "wall", "wall", "wall"] });
const floor = (devices: Device[], extra: Record<string, unknown> = {}): Floor => ({
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], devices,
  rooms: [room("Living", sq(0, 0, 450, 320)), room("Study", sq(450, 0, 350, 320))],
  doors: [], ...extra,
}) as unknown as Floor;
const layoutOf = (floors: Record<string, Floor>): Layout => ({ version: 2, floors } as unknown as Layout);

describe("formatAge (S24.7: an Attention row says how long)", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("reads now, minutes, hours and days, rounded down", () => {
    expect(formatAge("2026-10-08T11:59:31Z", now)).toBe("now");
    expect(formatAge("2026-10-08T11:48:00Z", now)).toBe("12 min");
    expect(formatAge("2026-10-08T08:59:00Z", now)).toBe("3 h");
    expect(formatAge("2026-10-05T11:00:00Z", now)).toBe("3 d");
  });
  it("is empty for anything that is not a past date (untrusted, finding 1)", () => {
    for (const v of [undefined, null, "", "yesterday", 5, {}, "2026-10-08T12:30:00Z"]) expect(formatAge(v, now), String(v)).toBe("");
  });
});

describe("relayText (S22.F4: a relay-lit lamp reads on, via the relay)", () => {
  const lamp = dev("light", "light.lamp", 100, 100, { bound: "switch.relay" });
  it("names the relay by its friendly name, else its id", () => {
    expect(relayText(lamp, { "light.lamp": st("off"), "switch.relay": st("on", { friendly_name: "Hall relay" }) })).toBe("on · via Hall relay");
    expect(relayText(lamp, { "light.lamp": st("off"), "switch.relay": st("on") })).toBe("on · via switch.relay");
  });
  it("is null when the light is on itself, the relay is off, or the device is not a bound light", () => {
    expect(relayText(lamp, { "light.lamp": st("on"), "switch.relay": st("on") })).toBeNull();
    expect(relayText(lamp, { "light.lamp": st("off"), "switch.relay": st("off") })).toBeNull();
    expect(relayText(dev("plug", "switch.p", 0, 0, { bound: "switch.relay" }), { "switch.relay": st("on") })).toBeNull();
    expect(relayText(dev("light", "light.x", 0, 0), { "light.x": st("off") })).toBeNull();
  });
  it("the room panel's row for that lamp reads on, via the relay, not the light's own off", () => {
    const f = floor([lamp]);
    const s = roomSummary(f, 0, { "light.lamp": st("off"), "switch.relay": st("on", { friendly_name: "Hall relay" }) }, {})!;
    expect(s.devices[0]!.state).toBe("on · via Hall relay");
  });
});

describe("activeDevices rows carry where they are (S24.7, F2)", () => {
  it("a device row has its index and room; a door row its door index and the room it borders", () => {
    const f = floor([dev("plug", "switch.a", 10, 10), dev("light", "light.b", 600, 100)], {
      doors: [{ id: "d", name: "Study window", kind: "window", a: [500, 320], b: [700, 320], sensors: ["binary_sensor.w"] } as unknown as Door],
    });
    const items = activeDevices(layoutOf({ g: f }), { "light.b": st("on"), "binary_sensor.w": st("on") });
    expect(items.map((i) => [i.entity, i.at, i.room])).toEqual([
      ["light.b", { what: "device", index: 1 }, "Study"],
      ["binary_sensor.w", { what: "door", index: 0 }, "Study"],
    ]);
  });
  it("a linked piece row points into furniture; a device outside every room has no room", () => {
    const f = floor([dev("light", "light.out", 2000, 2000)], { furniture: [{ id: "tv", symbol: "tv", x: 100, y: 100, w: 100, h: 20, rot: 0, entity: "media_player.tv" }] });
    const items = activeDevices(layoutOf({ g: f }), { "light.out": st("on"), "media_player.tv": st("playing") });
    expect(items.map((i) => [i.entity, i.at, i.room])).toEqual([
      ["light.out", { what: "device", index: 0 }, undefined],
      ["media_player.tv", { what: "piece", index: 0 }, "Living"],
    ]);
  });
  it("on the stress layout every row's ref points at a thing on its floor with that entity", () => {
    const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8")) as Layout;
    const state: StateOverlay = {};
    for (const f of Object.values(layout.floors)) for (const d of f.devices) if (d.entity) state[d.entity] = st(d.type === "vacuum" ? "cleaning" : d.type === "media" || d.type === "tv" ? "playing" : "on");
    const items = activeDevices(layout, state);
    expect(items.length).toBeGreaterThan(50);
    for (const it of items) {
      const f = layout.floors[it.floor]!;
      if (it.at.what === "device") expect(f.devices[it.at.index]!.entity).toBe(it.entity);
      else if (it.at.what === "door") expect(f.doors[it.at.index]).toBeTruthy();
      else expect(f.furniture[it.at.index]).toBeTruthy();
    }
  });
});

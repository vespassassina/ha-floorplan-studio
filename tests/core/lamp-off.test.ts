import { describe, it, expect } from "vitest";
import type { Device, Floor, Pt } from "../../src/core/schema";
import type { StateOverlay } from "../../src/core/render";
import { floorSummary, roomSummary } from "../../src/core/room-info";
import { lampOffCalls, presetCalls } from "../../src/core/room-scenes";
import { moreInfoEntities } from "../../src/core/attachments";
import { lampOp } from "../../src/card/popup";

// S22.1 (C1): a lamp lit by its bound relay can be turned off from the card. The plan draws a bound light on while either the
// light entity or the relay is on (render.ts `boundClassOf`), so whatever the card offers to turn it off must reach both.
// Call shapes are Home Assistant's: callService(domain, service, { entity_id }) with switch.turn_off / light.turn_off.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T10:00:00Z" });
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const lamp = (entity: string, x: number, bound?: string): Device => ({ id: entity, type: "light", entity, name: entity.split(".")[1], x, y: 100, ...(bound ? { bound } : {}) }) as Device;
const floor = (devices: Device[]): Floor => ({
  title: "Ground", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices,
  rooms: [
    { id: "a", name: "A", area: "", kind: "room", pts: sq(0, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"] },
    { id: "b", name: "B", area: "", kind: "room", pts: sq(400, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"] },
  ],
}) as unknown as Floor;

describe("lampOffCalls: what Turn off on one lamp calls", () => {
  const d = lamp("light.pendant", 100, "switch.relay");
  it("light off, relay on: switch.turn_off on the relay only", () => {
    expect(lampOffCalls(d, { "light.pendant": st("off"), "switch.relay": st("on") })).toEqual([{ domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } }]);
  });
  it("light on, relay on: light.turn_off on the light and switch.turn_off on the relay", () => {
    expect(lampOffCalls(d, { "light.pendant": st("on"), "switch.relay": st("on") })).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.pendant"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } },
    ]);
  });
  it("relay off: no relay call", () => {
    expect(lampOffCalls(d, { "light.pendant": st("on"), "switch.relay": st("off") })).toEqual([{ domain: "light", service: "turn_off", data: { entity_id: ["light.pendant"] } }]);
  });
  it("a relay that is not a switch goes to homeassistant.turn_off", () => {
    expect(lampOffCalls(lamp("light.p", 100, "input_boolean.power"), { "light.p": st("unavailable"), "input_boolean.power": st("on") })).toEqual([{ domain: "homeassistant", service: "turn_off", data: { entity_id: ["input_boolean.power"] } }]);
  });
  it("a lamp with no bound switch keeps the plain rule", () => {
    expect(lampOffCalls(lamp("light.p", 100), { "light.p": st("on") })).toEqual([{ domain: "light", service: "turn_off", data: { entity_id: ["light.p"] } }]);
  });
});

describe("All off over a room or a floor adds the bound relays that are on", () => {
  it("a lamp lit only by its relay is a target: its relay, not its light", () => {
    const f = floor([lamp("light.bound", 100, "switch.relay"), lamp("light.plain", 200)]);
    const state: StateOverlay = { "light.bound": st("off"), "switch.relay": st("on"), "light.plain": st("on") };
    const s = roomSummary(f, 0, state, {})!;
    expect(s.offEntities).toEqual(["switch.relay", "light.plain"]); // device order; presetCalls groups by domain
    expect(presetCalls("off", s.offEntities)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.plain"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } },
    ]);
  });
  it("two lamps on one relay: one switch call naming it once", () => {
    const f = floor([lamp("light.p1", 100, "switch.relay"), lamp("light.p2", 300, "switch.relay"), lamp("light.p3", 500, "switch.relay")]);
    const state: StateOverlay = { "light.p1": st("on"), "light.p2": st("off"), "light.p3": st("off"), "switch.relay": st("on") };
    expect(presetCalls("off", floorSummary(f, state, {}).offEntities)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.p1"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } },
    ]);
    // the room holds two of the three lamps: still one relay call
    expect(presetCalls("off", roomSummary(f, 0, state, {})!.offEntities)).toEqual([
      { domain: "light", service: "turn_off", data: { entity_id: ["light.p1"] } },
      { domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } },
    ]);
  });
  it("a relay that is off is not called", () => {
    const f = floor([lamp("light.p1", 100, "switch.relay")]);
    const s = roomSummary(f, 0, { "light.p1": st("on"), "switch.relay": st("off") }, {})!;
    expect(s.offEntities).toEqual(["light.p1"]);
  });
  it("another room's relay is not in this room's list", () => {
    const f = floor([lamp("light.p1", 100), lamp("light.p2", 500, "switch.other")]);
    const state: StateOverlay = { "light.p1": st("on"), "light.p2": st("off"), "switch.other": st("on") };
    expect(roomSummary(f, 0, state, {})!.offEntities).toEqual(["light.p1"]);
    expect(roomSummary(f, 1, state, {})!.offEntities).toEqual(["switch.other"]);
  });
});

describe("the lamp's popup button", () => {
  const d = lamp("light.pendant", 100, "switch.relay");
  it("relay on, light off: Turn off, no confirm, and it carries the relay call", () => {
    const op = lampOp(d, { "light.pendant": st("off"), "switch.relay": st("on") });
    expect(op).toMatchObject({ label: "Turn off", confirm: null, calls: [{ domain: "switch", service: "turn_off", data: { entity_id: ["switch.relay"] } }] });
  });
  it("relay on, light unavailable: still Turn off on the relay (the plan draws it on)", () => {
    expect(lampOp(d, { "light.pendant": st("unavailable"), "switch.relay": st("on") })?.label).toBe("Turn off");
  });
  it("relay off: today's rule, light.turn_on on the light", () => {
    expect(lampOp(d, { "light.pendant": st("off"), "switch.relay": st("off") })).toMatchObject({ label: "Turn on", domain: "light", service: "turn_on" });
  });
});

describe("More info offers the relay", () => {
  it("a light with bound lists its own entity, then the relay", () => {
    expect(moreInfoEntities(lamp("light.pendant", 100, "switch.relay"))).toEqual(["light.pendant", "switch.relay"]);
  });
  it("a light without bound lists only itself", () => {
    expect(moreInfoEntities(lamp("light.pendant", 100))).toEqual(["light.pendant"]);
  });
});

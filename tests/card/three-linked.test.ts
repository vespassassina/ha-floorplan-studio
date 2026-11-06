import { describe, expect, it } from "vitest";
import { liveOf } from "../../src/core/live";
import type { Floor } from "../../src/core/schema";
import { isKnownRole } from "../../src/card/three/palette";

// B53.11: the live state of a linked appliance and plant in 3D, and the palette's water-blue role. States as in link.test.ts (Home Connect, Mi Flora).
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-11-06T10:00:00Z" });
const floor = (furniture: unknown[]): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "p", symbol, x: 300, y: 250, rot: 0, w: 60, h: 60, ...extra });
const live = (f: Floor, state: Record<string, unknown>) => liveOf(f, { scale: 1, state: state as never }, 0);

describe("live: a linked plant and appliance", () => {
  const f = floor([piece("plant", { entity: "sensor.fern", minMoisture: 30 }), piece("washer", { entity: "sensor.w", attached: ["binary_sensor.door"] }), piece("fridge"), piece("rug", { entity: "sensor.x" })]);
  const S = (o: Record<string, unknown> = {}) => ({
    "sensor.fern": st("14", { device_class: "moisture", unit_of_measurement: "%" }), "sensor.w": st("run"), "binary_sensor.door": st("off", { device_class: "door" }), ...o,
  });
  it("a thirsty plant is thirsty and not on (its look is the blue glow); one with water is neither", () => {
    expect(live(f, S()).pieces[0]).toEqual({ on: false, thirsty: true });
    expect(live(f, S({ "sensor.fern": st("55", { device_class: "moisture", unit_of_measurement: "%" }) })).pieces[0]).toEqual({ on: false });
  });
  it("a running washer is on; a fridge door open alerts, running or not; a washer door left ajar does not", () => {
    expect(live(f, S()).pieces[1]).toEqual({ on: true });
    const ajar = S({ "sensor.w": st("ready"), "binary_sensor.door": st("on", { device_class: "door" }) });
    expect(live(f, ajar).pieces[1]).toEqual({ on: false });
    const g = floor([piece("fridge", { entity: "sensor.w", attached: ["binary_sensor.door"] })]);
    expect(live(g, ajar).pieces[0]).toEqual({ on: false, alert: true });
  });
  it("an unlinked appliance and a rug have no live state", () => {
    const l = live(f, S()).pieces;
    expect(l[2]).toBeNull();
    expect(l[3]).toBeNull();
  });
  it("the palette knows the water-blue role", () => { expect(isKnownRole("plant-thirsty")).toBe(true); });
});

// Opus review of B53.10-B53.13: the linked branch returned only `thirsty` and `alert`, so 3D never faded a robot out cleaning.
describe("live: a robot vacuum that is out cleaning is away (the plan draws it at 35 %)", () => {
  const f = floor([piece("robot-vacuum", { entity: "vacuum.robo" }), piece("robot-dock", { entity: "vacuum.robo" })]);
  it("cleaning and returning: on and away; docked: neither; the dock is never away", () => {
    expect(live(f, { "vacuum.robo": st("cleaning") }).pieces).toEqual([{ on: true, away: true }, { on: false }]);
    expect(live(f, { "vacuum.robo": st("returning") }).pieces[0]).toEqual({ on: true, away: true });
    expect(live(f, { "vacuum.robo": st("docked") }).pieces).toEqual([{ on: false }, { on: false }]);
  });
});

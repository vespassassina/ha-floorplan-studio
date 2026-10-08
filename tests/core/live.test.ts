import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { liveOf } from "../../src/core/live";
import { roomAt, type StateOverlay } from "../../src/core/render";

// S12.5: the payload the 3D view draws. Every figure is what the 2D plan decides from the same state.
const ground = (demo as unknown as Layout).floors.ground, upper = (demo as unknown as Layout).floors.first;
const NOW = Date.parse("2026-10-04T10:00:00Z");
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-04T10:00:00Z") => ({ state, attributes, last_changed });
const live = (state: StateOverlay, f = ground, extra: Record<string, unknown> = {}) => liveOf(f, { scale: 1, now: NOW, state, ...extra }, NOW);

describe("liveOf", () => {
  it("a lit light carries the room the 2D aura clip uses, its own colour and level", () => {
    const l = live({ "light.demo_living": st("on", { rgb_color: [255, 100, 0], brightness: 128 }) });
    expect(l.lights).toHaveLength(1);
    const i = ground.devices.findIndex((d) => d.entity === "light.demo_living"), d = ground.devices[i] as { x: number; y: number };
    expect(l.lights[0]).toMatchObject({ device: i, room: roomAt(ground, [d.x, d.y]), rgb: "rgb(255,100,0)" });
    expect(l.lights[0].room).toBe(0);
    expect(l.lights[0].level).toBeGreaterThan(0.3);
    expect(l.lights[0].level).toBeLessThan(0.9);
    expect(live({ "light.demo_living": st("off") }).lights).toEqual([]);
  });
  it("a door reads open from its contact sensor, a window too", () => {
    expect(live({ "binary_sensor.demo_front_door": st("on") }).doors[0]).toMatchObject({ open: true, alarm: false });
    expect(live({ "binary_sensor.demo_front_door": st("off") }).doors[0]?.open).toBe(false);
    expect(live({ "binary_sensor.demo_bedroom_window": st("on") }, upper).doors.some((d) => d?.open)).toBe(true);
  });
  it("a room's own sensors make the readout and the motion ring, and the sensor draws no icon", () => {
    const f = structuredClone(ground) as typeof ground;
    f.rooms[0].temps = ["sensor.t"]; f.rooms[0].motion = ["binary_sensor.m"];
    f.devices.push({ id: "t", type: "temp", entity: "sensor.t", name: "T", x: 10, y: 10 } as never, { id: "m", type: "motion", entity: "binary_sensor.m", name: "M", x: 20, y: 10 } as never);
    const l = liveOf(f, { scale: 1, now: NOW, state: { "sensor.t": st("21.5", { unit_of_measurement: "°C" }), "binary_sensor.m": st("on", {}, "2026-10-04T09:59:59Z") } }, NOW);
    expect(l.rooms[0]?.readout).toBe("21.5\u202F°C");
    expect(l.rooms[0]?.motion).toMatchObject({ on: true, v: 1 });
    expect(l.rooms[0]?.motion?.pulseAge).toBeCloseTo(1, 1);
    expect(l.devices[f.devices.length - 1]).toBeNull();
    expect(l.devices[f.devices.length - 2]).toBeNull();
  });
  it("an off motion sensor fades by last_changed and never pulses", () => {
    const f = structuredClone(ground) as typeof ground;
    f.rooms[0].motion = ["binary_sensor.m"];
    const l = liveOf(f, { scale: 1, now: NOW, fade: 300, state: { "binary_sensor.m": st("off", {}, "2026-10-04T09:57:30Z") } }, NOW);
    expect(l.rooms[0]?.motion).toMatchObject({ on: false, pulseAge: null });
    expect(l.rooms[0]!.motion!.v).toBeCloseTo(0.5, 1);
  });
  it("an icon wears what the plan gives it: heating, playing, the unavailable class", () => {
    const l = live({ "climate.demo_living": st("heat", { hvac_action: "heating" }), "media_player.demo_office": st("playing") });
    const heater = ground.devices.findIndex((d) => d.entity === "climate.demo_living");
    expect(l.devices[heater]).toMatchObject({ state: "on", klass: expect.stringContaining("on") });
    expect(live({ "climate.demo_living": st("heat", { hvac_action: "idle" }) }).devices[heater]?.state).toBe("off");
    const u = liveOf(upper, { scale: 1, now: NOW, state: { "media_player.demo_office": st("playing") } }, NOW), m = upper.devices.findIndex((d) => d.entity === "media_player.demo_office");
    expect(u.devices[m]?.playing).toBe(true);
    expect(u.devices[m]?.icon).toContain("wave");
    expect(live({ "light.demo_living": st("unavailable") }).devices[0]?.state).toBe("unavailable"); // S23.5: a dead light is unavailable, not off
    expect(live({ "climate.demo_living": st("unavailable") }).devices[heater]?.state).toBe("unavailable");
  });
  it("a sensor reads as the plan prints it, and junk as a dash", () => {
    const i = ground.devices.findIndex((d) => d.entity === "sensor.demo_living_temperature");
    expect(live({ "sensor.demo_living_temperature": st("20.5", { unit_of_measurement: "°C" }) }).devices[i]?.value).toBe("20.5\u202F°C");
    expect(live({ "sensor.demo_living_temperature": st("warm") }).devices[i]?.value).toBe("–");
  });
  it("junk layouts and junk state never throw", () => {
    expect(() => liveOf(null as never, { scale: 1 }, NOW)).not.toThrow();
    expect(() => liveOf({ devices: [null, 5, { type: 3 }], rooms: [null, { pts: 5 }], doors: [7] } as never, { scale: 1, state: { x: 5 } as never }, NOW)).not.toThrow();
    const l = liveOf({ devices: 5, rooms: "x", doors: {} } as never, { scale: 1 }, NOW);
    expect(l).toMatchObject({ lights: [], doors: [], devices: [], rooms: [] });
  });
  it("carries the toggles (the card does not pass the layout's device colours to 3D: DECISIONS, S12 fixes, Not done)", () => {
    const l = live({}, ground, { labels: false, showNames: true, night: true, colors: { light: "#ff0000", bogus: "#00ff00" } });
    expect(l).toMatchObject({ labels: false, names: true, night: true });
    expect(l).not.toHaveProperty("colours"); // computed once, read by nothing: removed
    expect(live({}).labels).toBe(true);
  });
});

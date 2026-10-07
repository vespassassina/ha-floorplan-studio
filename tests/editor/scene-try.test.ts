import { describe, it, expect } from "vitest";
import { itemFromState, restoreScene, tryScene } from "../../src/editor/scene-try";
import type { SceneCall } from "../../src/core/room-scenes";

// S17.7: Try sends the draft to the real devices and keeps what was there; Restore puts it back. A fake writer stands in for Home Assistant:
// its one method is the same `callService` the real writer has (hass-write.ts).
const fake = (fail?: string) => {
  const calls: SceneCall[] = [];
  return { calls, w: { callService: async (c: SceneCall) => { if (fail && c.data.entity_id === fail) throw new Error("boom"); calls.push(c); } } };
};
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "" });

describe("itemFromState: what an entity is doing now, as a scene item", () => {
  it("a light: off; on with brightness and kelvin; on in a colour mode with hs", () => {
    expect(itemFromState("light.a", st("off"))).toEqual({ entity: "light.a", on: false });
    expect(itemFromState("light.a", st("on", { brightness: 128, color_mode: "color_temp", color_temp_kelvin: 2700, hs_color: [30, 40] }))).toEqual({ entity: "light.a", on: true, brightness: 50, kelvin: 2700 });
    expect(itemFromState("light.a", st("on", { brightness: 255, color_mode: "hs", hs_color: [30.4, 40.2], color_temp_kelvin: 3000 }))).toEqual({ entity: "light.a", on: true, brightness: 100, hs: [30.4, 40.2] });
    expect(itemFromState("light.a", st("on", { brightness: 1 }))).toEqual({ entity: "light.a", on: true, brightness: 1 });
  });
  it("fan, cover, climate, media player", () => {
    expect(itemFromState("fan.a", st("on", { percentage: 40 }))).toEqual({ entity: "fan.a", on: true, percentage: 40 });
    expect(itemFromState("cover.a", st("open", { current_position: 70 }))).toEqual({ entity: "cover.a", on: true, position: 70 });
    expect(itemFromState("cover.a", st("closed", { current_position: 0 }))).toEqual({ entity: "cover.a", on: false });
    expect(itemFromState("climate.a", st("heat", { temperature: 21 }))).toEqual({ entity: "climate.a", on: true, hvac: "heat", temperature: 21 });
    expect(itemFromState("climate.a", st("off"))).toEqual({ entity: "climate.a", on: false });
    expect(itemFromState("media_player.a", st("playing", { volume_level: 0.25, source: "TV" }))).toEqual({ entity: "media_player.a", on: true, volume: 25, source: "TV" });
  });
  it("nothing for an unknown, unavailable or missing entity, or junk", () => {
    for (const s of [undefined, st("unavailable"), st("unknown"), null as never, { state: 5 } as never]) expect(itemFromState("light.a", s)).toBeNull();
    expect(itemFromState("lock.a", st("on"))).toBeNull();
  });
});

describe("tryScene and restoreScene", () => {
  const items = [{ entity: "light.a", on: true, brightness: 10 }, { entity: "fan.b", on: false }];
  const states = { "light.a": st("on", { brightness: 255, color_mode: "color_temp", color_temp_kelvin: 4000 }), "fan.b": st("on", { percentage: 60 }) };
  it("sends the draft's calls, and returns the old state so Restore sends exactly that", async () => {
    const { calls, w } = fake();
    const r = await tryScene(w, items, states, []);
    expect(calls.map((c) => [c.domain, c.service, c.data.entity_id])).toEqual([["light", "turn_on", "light.a"], ["fan", "turn_off", "fan.b"]]);
    expect(calls[0].data).toMatchObject({ brightness_pct: 10 });
    expect(r.backup).toEqual([{ entity: "light.a", on: true, brightness: 100, kelvin: 4000 }, { entity: "fan.b", on: true, percentage: 60 }]);
    calls.length = 0;
    await restoreScene(w, r.backup);
    expect(calls.map((c) => [c.service, c.data])).toEqual([
      ["turn_on", { entity_id: "light.a", brightness_pct: 100, color_temp_kelvin: 4000 }],
      ["turn_on", { entity_id: "fan.b", percentage: 60 }],
    ]);
  });
  it("a second Try keeps the first backup for an entity, and adds the new ones", async () => {
    const { w } = fake();
    const first = await tryScene(w, [items[0]], states, []);
    const moved = { ...states, "light.a": st("on", { brightness: 26, color_mode: "color_temp", color_temp_kelvin: 2000 }) }; // the lamp now shows the tried scene
    const second = await tryScene(w, items, moved, first.backup);
    expect(second.backup.find((b) => b.entity === "light.a")).toEqual(first.backup[0]);
    expect(second.backup.map((b) => b.entity)).toEqual(["light.a", "fan.b"]);
  });
  it("an entity Home Assistant does not know is still tried, reported as unrestorable, and one failing call does not stop the rest", async () => {
    const { calls, w } = fake("light.a");
    const r = await tryScene(w, items, { "fan.b": states["fan.b"] }, []);
    expect(calls.map((c) => c.data.entity_id)).toEqual(["fan.b"]);
    expect(r.failed).toEqual(["light.a"]);
    expect(r.unrestorable).toEqual(["light.a"]);
    expect(r.backup.map((b) => b.entity)).toEqual(["fan.b"]);
  });
  it("Restore with nothing kept sends nothing", async () => {
    const { calls, w } = fake();
    await restoreScene(w, []);
    expect(calls).toEqual([]);
  });
});

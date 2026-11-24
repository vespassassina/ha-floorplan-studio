import { describe, it, expect, vi } from "vitest";
import { customCalls } from "../../src/core";
import {
  createSceneDraft,
  disableHaEntity,
  haDynamicScriptPayload,
  haScenePayload,
  listRoomHaScenes,
  loadHaDynamicScene,
  loadHaScene,
  makeCardSceneHandlers,
  migrateHueScene,
  parseHaDynamicScript,
  parseHaSceneConfig,
  type SceneEditorHass,
  type SceneTarget,
} from "../../src/card/scene";

const TARGETS: SceneTarget[] = [
  { entity: "light.living", name: "Living", domain: "light" },
  { entity: "switch.lamp", name: "Lamp", domain: "switch" },
  { entity: "cover.blind", name: "Blind", domain: "cover" },
];

describe("Sprint 63: scene round-trip parsing & Hue migration", () => {
  it("parseHaSceneConfig round-trips all domains and survives hostile inputs", () => {
    const payload = haScenePayload("fp_test", "Evening", [
      { entity: "light.living", on: true, brightness: 60, kelvin: 2700, effect: "candle", transition: 2 },
      { entity: "light.accent", on: true, brightness: 80, hs: [120, 75] },
      { entity: "switch.lamp", on: false },
      { entity: "fan.ceil", on: true, percentage: 50 },
      { entity: "cover.blind", on: true, position: 40, tilt: 25 },
      { entity: "climate.ac", on: true, hvac: "cool", temperature: 22.5, fan_mode: "auto" },
      { entity: "media_player.tv", on: true, volume: 35, source: "HDMI 1" },
    ]);
    const parsed = parseHaSceneConfig(payload);
    expect(parsed.name).toBe("Evening");
    expect(parsed.items).toHaveLength(7);
    const l1 = parsed.items.find((i) => i.entity === "light.living")!;
    expect(l1).toMatchObject({ on: true, brightness: 60, kelvin: 2700, effect: "candle", transition: 2 });
    const l2 = parsed.items.find((i) => i.entity === "light.accent")!;
    expect(l2).toMatchObject({ on: true, brightness: 80, hs: [120, 75] });
    expect(parsed.items.find((i) => i.entity === "switch.lamp")).toMatchObject({ on: false });
    expect(parsed.items.find((i) => i.entity === "fan.ceil")).toMatchObject({ on: true, percentage: 50 });
    expect(parsed.items.find((i) => i.entity === "cover.blind")).toMatchObject({ on: true, position: 40, tilt: 25 });
    expect(parsed.items.find((i) => i.entity === "climate.ac")).toMatchObject({ on: true, hvac: "cool", temperature: 22.5, fan_mode: "auto" });
    expect(parsed.items.find((i) => i.entity === "media_player.tv")).toMatchObject({ on: true, volume: 35, source: "HDMI 1" });

    // rgb_color fallback when hs_color is absent
    const rgbParsed = parseHaSceneConfig({ name: "Red", entities: { "light.a": { state: "on", rgb_color: [255, 0, 0] } } });
    expect(rgbParsed.items[0]!.hs).toEqual([0, 100]);

    // Hostile / malformed inputs never throw
    expect(parseHaSceneConfig(null)).toEqual({ name: "", items: [] });
    expect(parseHaSceneConfig({ name: 123, entities: { "sensor.bad": { state: "on" }, "light.x": null } })).toEqual({ name: "", items: [] });
  });

  it("parseHaDynamicScript round-trips multi-step loop and play-once scripts", () => {
    const payload = haDynamicScriptPayload(
      "Sunset",
      [
        { items: [{ entity: "light.living", on: true, brightness: 80, kelvin: 3000 }], duration: 15, transition: 3 },
        { items: [{ entity: "light.living", on: true, brightness: 20, hs: [20, 90] }], duration: 20, transition: 4 },
      ],
      true,
      customCalls,
    );
    const parsed = parseHaDynamicScript(payload);
    expect(parsed.name).toBe("Sunset");
    expect(parsed.loop).toBe(true);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]).toMatchObject({ duration: 15, transition: 3 });
    expect(parsed.steps[0]!.items[0]).toMatchObject({ entity: "light.living", on: true, brightness: 80, kelvin: 3000 });
    expect(parsed.steps[1]).toMatchObject({ duration: 20, transition: 4 });
    expect(parsed.steps[1]!.items[0]).toMatchObject({ entity: "light.living", on: true, brightness: 20, hs: [20, 90] });

    // Malformed input returns safe default
    expect(parseHaDynamicScript(undefined)).toEqual({ name: "", steps: [{ items: [], duration: 10 }], loop: false });
  });

  it("listRoomHaScenes separates HA scenes, Hue scenes, and dynamic scripts in the room area", async () => {
    const hass: SceneEditorHass = {
      states: { "scene.hue_relax": { attributes: { friendly_name: "Relax" } } },
      callWS: vi.fn(async () => [
        { entity_id: "scene.hue_relax", area_id: "living", platform: "hue", unique_id: "hue-1", original_name: "Relax" },
        { entity_id: "scene.evening", area_id: "living", platform: "homeassistant", unique_id: "fp_evening", name: "Evening" },
        { entity_id: "script.fp_dyn_sunset", area_id: "living", platform: "script", unique_id: "fp_dyn_sunset", name: "Sunset" },
        { entity_id: "scene.hue_disabled", area_id: "living", platform: "hue", disabled_by: "user", name: "Old" },
        { entity_id: "scene.kitchen_bright", area_id: "kitchen", platform: "hue", name: "Bright" },
      ]) as SceneEditorHass["callWS"],
    };
    const list = await listRoomHaScenes(hass, "living");
    expect(list).toEqual([
      { entityId: "scene.hue_relax", configId: "hue-1", name: "Relax", kind: "hue", platform: "hue" },
      { entityId: "scene.evening", configId: "fp_evening", name: "Evening", kind: "scene", platform: "homeassistant" },
      { entityId: "script.fp_dyn_sunset", configId: "fp_dyn_sunset", name: "Sunset", kind: "dynamic", platform: "script" },
    ]);
  });

  it("disableHaEntity calls entity_registry/update with disabled_by: user and blocks non-admins", async () => {
    const callWS = vi.fn(async () => ({})) as unknown as SceneEditorHass["callWS"];
    await disableHaEntity({ user: { is_admin: true }, callWS }, "scene.hue_relax");
    expect(callWS).toHaveBeenCalledWith({
      type: "config/entity_registry/update",
      entity_id: "scene.hue_relax",
      disabled_by: "user",
    });
    await expect(disableHaEntity({ user: { is_admin: false }, callWS }, "scene.hue_relax")).rejects.toThrow(/administrator/i);
  });

  it("loadHaScene, loadHaDynamicScene, and Hue migration save + disconnect work end-to-end", async () => {
    const calls: { method: string; path: string; params?: Record<string, unknown> }[] = [];
    const wsCalls: Record<string, unknown>[] = [];
    const svcCalls: { domain: string; service: string; data?: Record<string, unknown> }[] = [];
    const liveStates: Record<string, { state: string; attributes: Record<string, unknown> }> = {
      "light.living": { state: "on", attributes: { brightness: 128, color_mode: "color_temp", color_temp_kelvin: 2500 } },
    };
    const hass: SceneEditorHass = {
      user: { is_admin: true },
      states: liveStates,
      callService: vi.fn(async (domain, service, data) => { svcCalls.push({ domain, service, data }); }),
      callApi: vi.fn(async (method, path, params) => {
        calls.push({ method, path, params });
        if (method === "GET" && path === "config/scene/config/fp_ev") {
          return { name: "Evening", entities: { "light.living": { state: "on", brightness: 204, color_temp_kelvin: 2700 } } };
        }
        if (method === "GET" && path === "config/script/config/fp_dyn_1") {
          return haDynamicScriptPayload("Flow", [{ items: [{ entity: "light.living", on: true, brightness: 50 }], duration: 10 }], false, customCalls);
        }
        return {};
      }) as SceneEditorHass["callApi"],
      callWS: vi.fn(async (msg) => {
        wsCalls.push(msg);
        if (msg.type === "config/label_registry/list") return [{ label_id: "lbl-1", name: "floorplan-studio" }];
        if (msg.type === "config/entity_registry/list") return [];
        return {};
      }) as SceneEditorHass["callWS"],
    };

    const s = await loadHaScene(hass, "fp_ev");
    expect(s.name).toBe("Evening");
    expect(s.items[0]).toMatchObject({ entity: "light.living", brightness: 80, kelvin: 2700 });

    const dyn = await loadHaDynamicScene(hass, "fp_dyn_1");
    expect(dyn.name).toBe("Flow");
    expect(dyn.steps[0]!.items[0]).toMatchObject({ entity: "light.living", brightness: 50 });

    // Hue migrate helper (0 ms settle for unit test)
    const captured = await migrateHueScene(hass, "scene.hue_relax", TARGETS, 0);
    expect(svcCalls[0]).toEqual({ domain: "scene", service: "turn_on", data: { entity_id: "scene.hue_relax" } });
    expect(captured.get("light.living")).toMatchObject({ on: true, brightness: 50, kelvin: 2500 });

    // Card handler save with replaceHueEntity + disableHueOnSave disconnects Hue entity
    const draft = createSceneDraft("living", 0, null, "Relax", [...captured.values()]);
    draft.replaceHueEntity = "scene.hue_relax";
    draft.disableHueOnSave = true;
    const closed = vi.fn();
    const h = makeCardSceneHandlers(
      { html: (() => "") as never, nothing: null, renderFloor: () => "", customCalls },
      draft,
      hass,
      { area: "living" },
      TARGETS,
      () => undefined,
      closed,
    );
    await h.save();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.method === "POST" && c.path.startsWith("config/scene/config/"))).toBe(true);
    expect(wsCalls).toContainEqual({
      type: "config/entity_registry/update",
      entity_id: "scene.hue_relax",
      disabled_by: "user",
    });
  });
});

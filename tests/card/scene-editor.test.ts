import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import { customCalls, validate, type Floor, type Layout, type SceneItem } from "../../src/core";
import {
  captureRoomItems,
  haScenePayload,
  roomCropBox,
  saveHaScene,
  scenePreviewStates,
  sceneTargets,
  SCENE_EDITOR_CHUNK,
  type SceneEditorHass,
} from "../../src/card/scene";

const ground = demo.floors.ground as unknown as Floor;

describe("S50: SceneItem new fields (transition, tilt, fan_mode)", () => {
  const layoutWith = (items: unknown[]) => {
    const l = structuredClone(demo) as unknown as Layout;
    l.floors.ground.rooms[0]!.scenes = [{ id: "s1", name: "Evening", items: items as SceneItem[] }];
    return l;
  };

  it("validates transition (0..300), tilt (0..100), and fan_mode (1..80)", () => {
    const good = layoutWith([
      { entity: "light.demo_living", on: true, brightness: 50, kelvin: 2700, transition: 2.5 },
      { entity: "cover.demo_garage_door", on: true, position: 80, tilt: 45 },
      { entity: "climate.living", on: true, hvac: "cool", temperature: 22, fan_mode: "auto" },
    ]);
    expect(validate(good).ok).toBe(true);

    expect(validate(layoutWith([{ entity: "light.a", on: true, transition: 301 }])).ok).toBe(false);
    expect(validate(layoutWith([{ entity: "light.a", on: true, transition: -1 }])).ok).toBe(false);
    expect(validate(layoutWith([{ entity: "cover.a", on: true, tilt: 120 }])).ok).toBe(false);
    expect(validate(layoutWith([{ entity: "climate.a", on: true, fan_mode: "" }])).ok).toBe(false);
  });

  it("customCalls emits transition, set_cover_tilt_position, and set_fan_mode", () => {
    const calls = customCalls({
      id: "s1",
      name: "Evening",
      items: [
        { entity: "light.a", on: true, brightness: 40, transition: 3 },
        { entity: "light.b", on: false, transition: 2 },
        { entity: "cover.c", on: true, position: 60, tilt: 30 },
        { entity: "cover.d", on: true, tilt: 50 },
        { entity: "climate.e", on: true, hvac: "cool", temperature: 21, fan_mode: "low" },
      ],
    });
    expect(calls).toEqual([
      { domain: "light", service: "turn_on", data: { entity_id: "light.a", brightness_pct: 40, transition: 3 } },
      { domain: "light", service: "turn_off", data: { entity_id: "light.b", transition: 2 } },
      { domain: "cover", service: "set_cover_position", data: { entity_id: "cover.c", position: 60 } },
      { domain: "cover", service: "set_cover_tilt_position", data: { entity_id: "cover.c", tilt_position: 30 } },
      { domain: "cover", service: "set_cover_tilt_position", data: { entity_id: "cover.d", tilt_position: 50 } },
      { domain: "climate", service: "set_hvac_mode", data: { entity_id: "climate.e", hvac_mode: "cool" } },
      { domain: "climate", service: "set_temperature", data: { entity_id: "climate.e", temperature: 21 } },
      { domain: "climate", service: "set_fan_mode", data: { entity_id: "climate.e", fan_mode: "low" } },
    ]);
  });
});

describe("S50: shared lazy scene editor helpers", () => {
  it("exports chunk marker, computes padded room crop box, and finds room targets including climate and door covers", () => {
    expect(SCENE_EDITOR_CHUNK).toBe("fp-scene-v1");
    const box = roomCropBox(ground, 0, 40);
    expect(box.w).toBeGreaterThan(80);
    expect(box.h).toBeGreaterThan(80);
    expect(roomCropBox(ground, 99)).toEqual({ x: 0, y: 0, w: 400, h: 300 });

    const f = structuredClone(ground);
    f.devices.push({ id: "ac-1", type: "climate", entity: "climate.living_ac", name: "Living AC", x: 100, y: 100 } as Floor["devices"][number]);
    const targets = sceneTargets(f, 0);
    expect(targets.map((t) => t.entity)).toContain("light.demo_living");
    expect(targets.map((t) => t.entity)).toContain("climate.living_ac");
    const hallTargets = sceneTargets(f, 2);
    expect(hallTargets.map((t) => t.entity)).toContain("cover.demo_garage_door");
  });

  it("synthesizes WYSIWYG preview states without mutating live states, and captures live states", () => {
    const live = {
      "light.demo_living": { state: "off", attributes: {}, last_changed: "" },
      "cover.demo_garage_door": { state: "open", attributes: { current_position: 75, current_tilt_position: 20 }, last_changed: "" },
      "climate.living_ac": { state: "cool", attributes: { temperature: 22, fan_mode: "medium" }, last_changed: "" },
      "light.unknown": { state: "unavailable", attributes: {}, last_changed: "" },
    };
    const preview = scenePreviewStates(
      [
        { entity: "light.demo_living", on: true, brightness: 50, hs: [0, 100] },
        { entity: "cover.demo_garage_door", on: true, position: 30, tilt: 15 },
      ],
      live,
    );
    expect(live["light.demo_living"].state).toBe("off");
    expect(preview["light.demo_living"]?.state).toBe("on");
    expect(preview["light.demo_living"]?.attributes.rgb_color).toEqual([255, 0, 0]);
    expect(preview["cover.demo_garage_door"]?.attributes.current_tilt_position).toBe(15);

    const captured = captureRoomItems(
      [
        { entity: "light.demo_living", name: "Living", domain: "light" },
        { entity: "cover.demo_garage_door", name: "Garage", domain: "cover" },
        { entity: "climate.living_ac", name: "AC", domain: "climate" },
        { entity: "light.unknown", name: "Gone", domain: "light" },
      ],
      live,
    );
    expect(captured.get("light.demo_living")).toEqual({ entity: "light.demo_living", on: false });
    expect(captured.get("cover.demo_garage_door")).toEqual({ entity: "cover.demo_garage_door", on: true, position: 75, tilt: 20 });
    expect(captured.get("climate.living_ac")).toEqual({ entity: "climate.living_ac", on: true, hvac: "cool", temperature: 22, fan_mode: "medium" });
    expect(captured.has("light.unknown")).toBe(false);
  });

  it("haScenePayload builds HA scenes.yaml entity config", () => {
    const payload = haScenePayload("fp_movie", "Movie", [
      { entity: "light.demo_living", on: true, brightness: 50, kelvin: 2700, transition: 2 },
      { entity: "cover.demo_garage_door", on: true, position: 0, tilt: 10 },
      { entity: "switch.demo_hall", on: false },
    ]);
    expect(payload).toEqual({
      id: "fp_movie",
      name: "Movie",
      entities: {
        "light.demo_living": { state: "on", brightness: 128, color_temp_kelvin: 2700, transition: 2 },
        "cover.demo_garage_door": { state: "closed", current_position: 0, current_tilt_position: 10 },
        "switch.demo_hall": { state: "off" },
      },
    });
  });

  it("saveHaScene writes config/scene/config/<id>, assigns area + label, blocks non-admins, and explains missing scenes.yaml", async () => {
    const apiCalls: [string, string, unknown][] = [];
    const wsCalls: Record<string, unknown>[] = [];
    const hass: SceneEditorHass = {
      user: { is_admin: true },
      callApi: vi.fn(async (m, p, body) => { apiCalls.push([m, p, body]); return { result: "ok" }; }) as never,
      callWS: vi.fn(async (msg) => {
        wsCalls.push(msg);
        if (msg.type === "config/label_registry/list") return [{ label_id: "lbl_fp", name: "floorplan-studio" }];
        if (msg.type === "config/entity_registry/list") return [{ entity_id: "scene.movie", unique_id: "fp_movie", labels: [] }];
        return {};
      }) as never,
    };
    const res = await saveHaScene(hass, {
      id: "fp_movie",
      name: "Movie",
      areaId: "living",
      items: [{ entity: "light.demo_living", on: true, brightness: 40 }],
      tries: 2,
      retryMs: 1,
    });
    expect(res).toEqual({ id: "fp_movie", entityId: "scene.movie" });
    expect(apiCalls[0]?.[0]).toBe("POST");
    expect(apiCalls[0]?.[1]).toBe("config/scene/config/fp_movie");
    expect(wsCalls).toContainEqual({
      type: "config/entity_registry/update",
      entity_id: "scene.movie",
      area_id: "living",
      labels: ["lbl_fp"],
    });

    await expect(
      saveHaScene({ user: { is_admin: false }, callApi: vi.fn() }, { name: "No", items: [{ entity: "light.a", on: true }] }),
    ).rejects.toThrow(/administrator/);

    await expect(
      saveHaScene(
        { user: { is_admin: true }, callApi: vi.fn(async () => { throw { status_code: 404, message: "Not Found" }; }) },
        { name: "NoYaml", items: [{ entity: "light.a", on: true }] },
      ),
    ).rejects.toThrow(/scene: !include scenes\.yaml/);
  });
});

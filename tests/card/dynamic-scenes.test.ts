import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import { customCalls, haScenesFor, validate, type Floor, type Layout, type SceneItem } from "../../src/core";
import {
  checkDynamicBudget,
  haDynamicScriptPayload,
  lightEffectsFor,
  MAX_CALLS_PER_MIN,
  MIN_LOOP_SEC_PER_LIGHT,
  saveHaDynamicScene,
  type DynamicStepData,
  type SceneEditorHass,
} from "../../src/card/scene";

const ground = demo.floors.ground as unknown as Floor;

describe("S51: native light effects and Zigbee traffic budget", () => {
  it("lightEffectsFor collects unique native effect_list options from room lights and skips none/off", () => {
    const effects = lightEffectsFor(
      [
        { entity: "light.a", name: "A", domain: "light" },
        { entity: "light.b", name: "B", domain: "light" },
        { entity: "switch.c", name: "C", domain: "switch" },
      ],
      {
        "light.a": { attributes: { effect_list: ["none", "candle", "fire"] } },
        "light.b": { attributes: { effect_list: ["off", "candle", "colorloop"] } },
        "switch.c": { attributes: { effect_list: ["bogus"] } },
      },
    );
    expect(effects).toEqual([
      { effect: "candle", entities: ["light.a", "light.b"] },
      { effect: "colorloop", entities: ["light.b"] },
      { effect: "fire", entities: ["light.a"] },
    ]);
  });

  it("checkDynamicBudget allows safe scenes and refuses fast loops (< 2 s/light) or > 30 calls/min", () => {
    const okLoop: DynamicStepData[] = [
      { items: [{ entity: "light.a", on: true, brightness: 20 }, { entity: "light.b", on: true, brightness: 80 }], duration: 6, transition: 3 },
      { items: [{ entity: "light.a", on: true, brightness: 80 }, { entity: "light.b", on: true, brightness: 20 }], duration: 6, transition: 3 },
    ];
    const ok = checkDynamicBudget(okLoop, true, customCalls);
    expect(ok).toEqual({ ok: true, callsPerMin: 20, totalCalls: 4 });

    // 2 lights in a loop step with 3 s duration (< 2 * 2 = 4 s) must be refused.
    const fastLoop: DynamicStepData[] = [
      { items: [{ entity: "light.a", on: true }, { entity: "light.b", on: true }], duration: 3 },
    ];
    const badFast = checkDynamicBudget(fastLoop, true, customCalls);
    expect(badFast.ok).toBe(false);
    if (!badFast.ok) expect(badFast.reason).toContain(`${MIN_LOOP_SEC_PER_LIGHT} s per light`);

    // 10 lights every 15 s = 40 calls/min (> 30/min limit) — passes 2 s/light (20 s vs 15 s? use 1 light every 1.5 s? no, use 5 switches every 5 s = 60 calls/min).
    const flood: DynamicStepData[] = [
      { items: Array.from({ length: 5 }, (_, i) => ({ entity: `switch.s${i}`, on: true })), duration: 5 },
    ];
    const badFlood = checkDynamicBudget(flood, true, customCalls);
    expect(badFlood.ok).toBe(false);
    if (!badFlood.ok) expect(badFlood.reason).toContain(`${MAX_CALLS_PER_MIN}/min`);
  });

  it("haDynamicScriptPayload builds play-once and looping HA script sequences with transitions and delays", () => {
    const steps: DynamicStepData[] = [
      { items: [{ entity: "light.a", on: true, brightness: 30 }], duration: 10, transition: 4 },
      { items: [{ entity: "light.a", on: true, effect: "candle" }], duration: 0 },
    ];
    const once = haDynamicScriptPayload("Evening dim", steps, false, customCalls);
    expect(once).toEqual({
      alias: "Evening dim",
      mode: "restart",
      sequence: [
        { action: "light.turn_on", target: { entity_id: "light.a" }, data: { brightness_pct: 30, transition: 4 } },
        { delay: { seconds: 10 } },
        { action: "light.turn_on", target: { entity_id: "light.a" }, data: { effect: "candle" } },
      ],
    });

    const looped = haDynamicScriptPayload("Cycle", [steps[0]!], true, customCalls);
    expect(looped.sequence).toHaveLength(1);
    expect((looped.sequence[0] as { repeat?: unknown }).repeat).toBeDefined();
  });

  it("saveHaDynamicScene writes config/script/config/<id>, assigns area + label, refuses over-budget, and explains missing scripts.yaml", async () => {
    const apiCalls: [string, string, unknown][] = [];
    const wsCalls: Record<string, unknown>[] = [];
    const hass: SceneEditorHass = {
      user: { is_admin: true },
      callApi: vi.fn(async (m, p, body) => { apiCalls.push([m, p, body]); return { result: "ok" }; }) as never,
      callWS: vi.fn(async (msg) => {
        wsCalls.push(msg);
        if (msg.type === "config/label_registry/list") return [{ label_id: "lbl_fp", name: "floorplan-studio" }];
        if (msg.type === "config/entity_registry/list") return [{ entity_id: "script.fp_dyn_wakeup", unique_id: "fp_dyn_wakeup", labels: [] }];
        return {};
      }) as never,
    };

    const res = await saveHaDynamicScene(hass, {
      id: "fp_dyn_wakeup",
      name: "Wake up",
      areaId: "living",
      steps: [{ items: [{ entity: "light.a", on: true, brightness: 50 }], duration: 10, transition: 5 }],
      loop: false,
      customCalls,
      tries: 2,
      retryMs: 1,
    });
    expect(res).toEqual({ id: "fp_dyn_wakeup", entityId: "script.fp_dyn_wakeup" });
    expect(apiCalls[0]?.[0]).toBe("POST");
    expect(apiCalls[0]?.[1]).toBe("config/script/config/fp_dyn_wakeup");
    expect(wsCalls).toContainEqual({
      type: "config/entity_registry/update",
      entity_id: "script.fp_dyn_wakeup",
      area_id: "living",
      labels: ["lbl_fp"],
    });

    const apiSpy = vi.fn();
    await expect(
      saveHaDynamicScene(
        { user: { is_admin: true }, callApi: apiSpy as never },
        { name: "Too fast", steps: [{ items: [{ entity: "light.a", on: true }], duration: 1 }], loop: true, customCalls },
      ),
    ).rejects.toThrow(/2 s per light/);
    expect(apiSpy).not.toHaveBeenCalled();

    await expect(
      saveHaDynamicScene(
        { user: { is_admin: true }, callApi: vi.fn(async () => { throw { status_code: 404, message: "Not Found" }; }) as never },
        { name: "NoYaml", steps: [{ items: [{ entity: "light.a", on: true }], duration: 5 }], loop: false, customCalls },
      ),
    ).rejects.toThrow(/script: !include scripts\.yaml/);
  });

  it("haScenesFor lists script.fp_dyn_* in the room's area with playing state, and validate accepts light effect", () => {
    const rows = haScenesFor(ground.rooms[0], {
      states: {
        "scene.living_relax": { state: "unknown", attributes: { friendly_name: "Relax" } },
        "script.fp_dyn_party": { state: "on", attributes: { friendly_name: "Party" } },
        "script.fp_dyn_wakeup": { state: "off", attributes: { friendly_name: "Wake up" } },
        "script.unrelated": { state: "on", attributes: { friendly_name: "Other" } },
      },
      entities: {
        "scene.living_relax": { area_id: "living" },
        "script.fp_dyn_party": { area_id: "living" },
        "script.fp_dyn_wakeup": { area_id: "living" },
        "script.unrelated": { area_id: "living" },
      },
    });
    expect(rows).toEqual([
      { entity: "script.fp_dyn_party", name: "Party", playing: true },
      { entity: "scene.living_relax", name: "Relax" },
      { entity: "script.fp_dyn_wakeup", name: "Wake up" },
    ]);

    const l = structuredClone(demo) as unknown as Layout;
    l.floors.ground.rooms[0]!.scenes = [{ id: "e1", name: "Candle", items: [{ entity: "light.demo_living", on: true, effect: "candle" } as SceneItem] }];
    expect(validate(l).ok).toBe(true);
    expect(customCalls(l.floors.ground.rooms[0]!.scenes[0])).toEqual([
      { domain: "light", service: "turn_on", data: { entity_id: "light.demo_living", effect: "candle" } },
    ]);
  });
});

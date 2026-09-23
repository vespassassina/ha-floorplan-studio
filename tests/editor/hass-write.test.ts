import { describe, it, expect, vi } from "vitest";
import { LABEL_NAME, createArea, createAutomation, createHelper, ensureLabel, listLabelled, makeWriter, openAutomation, removeLabelled, setDeviceArea, setEntityArea, type AutomationConfig, type WriteHass } from "../../src/editor/hass-write";
import { confirm, NO_UNDO } from "../../src/editor/confirm";

type Msg = { type: string; [k: string]: unknown };
function stub(ws: (m: Msg) => unknown = () => ({}), api: (method: string, path: string, body?: Record<string, unknown>) => unknown = () => ({})) {
  return { callWS: vi.fn(async (m: Msg) => ws(m)), callApi: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => api(method, path, body)) } as unknown as WriteHass & { callWS: ReturnType<typeof vi.fn>; callApi: ReturnType<typeof vi.fn> };
}
const types = (h: { callWS: ReturnType<typeof vi.fn> }) => h.callWS.mock.calls.map((c) => c[0].type);

describe("ensureLabel", () => {
  it("creates the label once when missing, and reuses it when it exists", async () => {
    const h = stub((m) => (m.type === "config/label_registry/list" ? [] : { label_id: "fs", name: LABEL_NAME }));
    expect(await ensureLabel(h)).toBe("fs");
    expect(h.callWS).toHaveBeenCalledWith({ type: "config/label_registry/create", name: "floorplan-studio" });
    const g = stub(() => [{ label_id: "there", name: LABEL_NAME }, { label_id: "other", name: "x" }]);
    expect(await ensureLabel(g)).toBe("there");
    expect(types(g)).toEqual(["config/label_registry/list"]); // no create
  });
});

describe("area writes", () => {
  it("sends the documented registry messages", async () => {
    const h = stub();
    await setDeviceArea(h, "dev1", "living");
    await setEntityArea(h, "light.a", "kitchen");
    await setEntityArea(h, "light.a", null);
    expect(h.callWS.mock.calls.map((c) => c[0])).toEqual([
      { type: "config/device_registry/update", device_id: "dev1", area_id: "living" },
      { type: "config/entity_registry/update", entity_id: "light.a", area_id: "kitchen" },
      { type: "config/entity_registry/update", entity_id: "light.a", area_id: null },
    ]);
  });
});

describe("S4.2: createArea", () => {
  it("creates the area with the floorplan-studio label and returns HA's id and name", async () => {
    const h = stub((m) => (m.type === "config/label_registry/list" ? [{ label_id: "fs", name: LABEL_NAME }] : { area_id: "garage_2", name: "Garage" }));
    expect(await createArea(h, "Garage")).toEqual({ id: "garage_2", name: "Garage" });
    expect(h.callWS).toHaveBeenLastCalledWith({ type: "config/area_registry/create", name: "Garage", labels: ["fs"] });
  });
  it("an empty name is refused before anything is sent", async () => {
    const h = stub();
    await expect(createArea(h, "  ")).rejects.toThrow(/name/);
    expect(h.callWS).not.toHaveBeenCalled();
  });
  it("makeWriter exposes it", async () => {
    const h = stub((m) => (m.type === "config/label_registry/list" ? [{ label_id: "fs", name: LABEL_NAME }] : { area_id: "a", name: "A" }));
    expect(await makeWriter(h).createArea("A")).toEqual({ id: "a", name: "A" });
  });
});

describe("createHelper", () => {
  const flowStart = { type: "form", flow_id: "F1" };
  const done = { type: "create_entry", result: { entry_id: "E1" } };
  const happy = () => stub((m) => {
    if (m.type === "config/label_registry/list") return [{ label_id: "fs", name: LABEL_NAME }];
    if (m.type === "config/entity_registry/list") return [{ entity_id: "light.hall_switch", config_entry_id: "E1", labels: ["mine"] }, { entity_id: "light.old", config_entry_id: "E0" }];
    return {};
  }, (_m, path) => (path.endsWith("/flow") ? flowStart : done));

  it("runs the flow step by step, finds the new entity by its config entry, and labels it (keeping its other labels)", async () => {
    const h = happy();
    const r = await createHelper(h, "switch_as_x", [{ entity_id: "switch.hall", target_domain: "light" }], { retryMs: 0 });
    expect(r).toEqual({ entity_id: "light.hall_switch" });
    expect(h.callApi.mock.calls).toEqual([
      ["POST", "config/config_entries/flow", { handler: "switch_as_x", show_advanced_options: false }],
      ["POST", "config/config_entries/flow/F1", { entity_id: "switch.hall", target_domain: "light" }],
    ]);
    expect(h.callWS).toHaveBeenCalledWith({ type: "config/entity_registry/update", entity_id: "light.hall_switch", labels: ["mine", "fs"] });
  });

  it("a step that comes back with errors throws with HA's text and creates nothing", async () => {
    const h = stub(() => [{ label_id: "fs", name: LABEL_NAME }], (_m, path) => (path.endsWith("/flow") ? flowStart : { type: "form", flow_id: "F1", errors: { base: "entity_not_found" } }));
    await expect(createHelper(h, "switch_as_x", [{ entity_id: "switch.nope", target_domain: "light" }])).rejects.toThrow(/entity_not_found/);
    expect(types(h)).not.toContain("config/entity_registry/update");
  });

  it("an aborted flow says why", async () => {
    const h = stub(() => [{ label_id: "fs", name: LABEL_NAME }], (_m, path) => (path.endsWith("/flow") ? flowStart : { type: "abort", reason: "already_configured" }));
    await expect(createHelper(h, "switch_as_x", [{}])).rejects.toThrow(/already_configured/);
  });

  it("when the entity never shows in the registry it rejects after the tries, not forever", async () => {
    const h = stub((m) => (m.type === "config/label_registry/list" ? [{ label_id: "fs", name: LABEL_NAME }] : []), (_m, path) => (path.endsWith("/flow") ? flowStart : done));
    await expect(createHelper(h, "switch_as_x", [{}], { retryMs: 0, tries: 3 })).rejects.toThrow(/did not appear/);
    expect(h.callWS.mock.calls.filter((c) => c[0].type === "config/entity_registry/list")).toHaveLength(3);
  });

  it("makeWriter binds hass to each function", async () => {
    const h = stub();
    await makeWriter(h).setDeviceArea("d", "a");
    expect(h.callWS).toHaveBeenCalledWith({ type: "config/device_registry/update", device_id: "d", area_id: "a" });
  });
});

describe("S4.10: listLabelled / removeLabelled", () => {
  const registries = (entities: unknown[], areas: unknown[] = []) => (m: Msg) => {
    if (m.type === "config/label_registry/list") return [{ label_id: "fs", name: LABEL_NAME }];
    if (m.type === "config/entity_registry/list") return entities;
    if (m.type === "config/area_registry/list") return areas;
    return {};
  };

  it("lists a labelled helper by its config entry id, an automation by its own id, and a labelled area", async () => {
    const h = stub(registries([
      { entity_id: "light.hall_switch", config_entry_id: "E1", labels: ["fs"], name: "Hall switch light" },
      { entity_id: "automation.close_at_night", unique_id: "A1", labels: ["fs"], original_name: "Close at night" },
      { entity_id: "sensor.unrelated", config_entry_id: "E9", labels: [] }, // no label: left out
    ], [
      { area_id: "attic", name: "Attic", labels: ["fs"] },
      { area_id: "kitchen", name: "Kitchen", labels: [] }, // no label: left out
    ]));
    expect(await listLabelled(h)).toEqual([
      { kind: "helper", id: "E1", name: "Hall switch light", entityId: "light.hall_switch" },
      { kind: "automation", id: "A1", name: "Close at night", entityId: "automation.close_at_night" },
      { kind: "area", id: "attic", name: "Attic" },
    ]);
  });

  it("an unlabelled instance (nothing floorplan-studio made) lists nothing", async () => {
    const h = stub(registries([{ entity_id: "light.x", config_entry_id: "E1" }], [{ area_id: "a", name: "A" }]));
    expect(await listLabelled(h)).toEqual([]);
  });

  it("removeLabelled sends the call documented for each kind", async () => {
    const h = stub();
    await removeLabelled(h, { kind: "helper", id: "E1", name: "x" });
    await removeLabelled(h, { kind: "automation", id: "A1", name: "y", entityId: "automation.y" });
    await removeLabelled(h, { kind: "area", id: "attic", name: "z" });
    expect(h.callApi.mock.calls).toEqual([
      ["DELETE", "config/config_entries/entry/E1"],
      ["DELETE", "config/automation/config/A1"],
    ]);
    expect(h.callWS).toHaveBeenCalledWith({ type: "config/area_registry/delete", area_id: "attic" });
  });
});

describe("S4.6: createAutomation / openAutomation", () => {
  const CFG: AutomationConfig = { alias: "x", trigger: [], action: [] };

  it("posts the config to a fresh fp_<id>, then finds and labels the automation entity by its unique_id", async () => {
    let postedId = "";
    const h = stub((m) => {
      if (m.type === "config/label_registry/list") return [{ label_id: "fs", name: LABEL_NAME }];
      if (m.type === "config/entity_registry/list") return [{ entity_id: "automation.x", unique_id: postedId, labels: ["other"] }];
      return {};
    }, (_m, path) => { postedId = path.split("/").pop()!; return {}; });
    const id = await createAutomation(h, CFG, { retryMs: 0 });
    expect(h.callApi).toHaveBeenCalledWith("POST", `config/automation/config/${id}`, CFG);
    expect(id).toMatch(/^fp_/);
    expect(id).toBe(postedId);
    expect(h.callWS).toHaveBeenCalledWith({ type: "config/entity_registry/update", entity_id: "automation.x", labels: ["other", "fs"] });
  });

  it("when the automation never shows in the registry it rejects after the tries, not forever", async () => {
    const h = stub((m) => (m.type === "config/label_registry/list" ? [{ label_id: "fs", name: LABEL_NAME }] : []));
    await expect(createAutomation(h, CFG, { retryMs: 0, tries: 3 })).rejects.toThrow(/did not appear/);
    expect(h.callWS.mock.calls.filter((c) => c[0].type === "config/entity_registry/list")).toHaveLength(3);
  });

  it("makeWriter exposes createAutomation", async () => {
    let postedId = "";
    const h = stub((m) => {
      if (m.type === "config/label_registry/list") return [{ label_id: "fs", name: LABEL_NAME }];
      if (m.type === "config/entity_registry/list") return [{ entity_id: "automation.x", unique_id: postedId }];
      return {};
    }, (_m, path) => { postedId = path.split("/").pop()!; return {}; });
    expect(await makeWriter(h).createAutomation(CFG)).toMatch(/^fp_/);
  });

  it("openAutomation pushes the edit URL and fires a bubbling, composed location-changed event", () => {
    const seen: Event[] = [];
    const onEvent = (e: Event) => seen.push(e);
    window.addEventListener("location-changed", onEvent);
    const before = history.length;
    openAutomation("fp_abc123");
    window.removeEventListener("location-changed", onEvent);
    expect(location.pathname).toBe("/config/automation/edit/fp_abc123");
    expect(history.length).toBe(before + 1);
    expect(seen).toHaveLength(1);
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].composed).toBe(true);
  });
});

describe("confirm", () => {
  const open = () => { const host = document.createElement("div"); document.body.append(host); return { host, p: confirm(host, "Create a light", ["From switch.hall"]) }; };
  const q = (host: HTMLElement, sel: string) => host.querySelector(sel) as HTMLElement;

  it("names what will happen, ends with the no-undo warning, and OK resolves true", async () => {
    const { host, p } = open();
    const lines = [...host.querySelectorAll("#fp-confirm p")].map((e) => e.textContent);
    expect(lines).toEqual(["From switch.hall", NO_UNDO]);
    q(host, "#fp-confirm-yes").click();
    expect(await p).toBe(true);
    expect(host.querySelector("#fp-confirm")).toBeNull();
  });
  it("Cancel, Escape and a click outside all resolve false", async () => {
    for (const how of ["cancel", "esc", "outside"]) {
      const { host, p } = open();
      if (how === "cancel") q(host, "#fp-confirm-no").click();
      else if (how === "esc") q(host, "#fp-confirm").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else q(host, "#fp-confirm").click();
      expect(await p, how).toBe(false);
    }
  });
  it("focus starts on Cancel, so Enter cannot create by accident", () => {
    const { host } = open();
    expect(document.activeElement === q(host, "#fp-confirm-no")).toBe(true);
    q(host, "#fp-confirm-no").click();
  });
});

import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioPanel } from "../../src/editor/panel";
import type { FloorplanStudioEditor } from "../../src/editor/editor-app";

// S26.14: the Inspector mode is the editor's, so a `hass` update from Home Assistant (several a second) must leave the Place
// mode, its ticks and the Add mode's search as they were. Stub shapes are those of panel.test.ts (the registry replies are
// what `haData` reads: area_registry, entity_registry).
const L = demo as unknown as Layout;
const settle = async (el: FloorplanStudioPanel) => { for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
function hassWith(states: Record<string, unknown> = {}) {
  const ws = (m: { type: string }) => {
    if (m.type === "floorplan_studio/load") return { layout: L };
    if (m.type === "config/area_registry/list") return [{ area_id: "living", name: "Living" }];
    if (m.type === "config/entity_registry/list") return [{ entity_id: "light.lamp", area_id: "living" }, { entity_id: "light.spot", area_id: "living" }];
    throw new Error("no");
  };
  return { callWS: vi.fn(async (m) => ws(m)), callService: vi.fn(async () => undefined), themes: { darkMode: false },
    states: { "light.lamp": { state: "off", attributes: { friendly_name: "Lamp" } }, "light.spot": { state: "off", attributes: { friendly_name: "Spot" } }, ...states } };
}

describe("Inspector modes in the panel", () => {
  it("Place mode, its ticks and the Add mode's search survive a hass update", async () => {
    const hass = hassWith();
    const el = new FloorplanStudioPanel();
    document.body.appendChild(el);
    el.hass = hass as never;
    await settle(el);
    const ed = el.shadowRoot!.querySelector("floorplan-studio-editor") as FloorplanStudioEditor;
    const h = ed as unknown as { st: { sel: unknown }; openPlace(i: number): void; openAddDev(): void; placeOn: Set<string>; addDevQuery: string };
    const living = L.floors.ground.rooms.findIndex((r) => r.name === "Living");
    h.st.sel = { t: "room", i: living };
    h.openPlace(living);
    await settle(el);
    const root = ed.shadowRoot!;
    expect(root.querySelector('aside [role=tab][data-mode="place"]')?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".fpanel")).toBeNull();
    h.placeOn.add("light.lamp");
    for (let i = 0; i < 3; i++) { el.hass = { ...hass, states: { ...hass.states, "sensor.x": { state: String(i), attributes: {} } } } as never; await settle(el); }
    expect(root.querySelector('aside [role=tab][data-mode="place"]')?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector("aside #placePanel")).not.toBeNull();
    expect([...h.placeOn]).toEqual(["light.lamp"]);
    // Add mode: the search text stays too
    h.openAddDev();
    h.addDevQuery = "spot";
    await settle(el);
    for (let i = 0; i < 3; i++) { el.hass = { ...hass, states: { ...hass.states, "sensor.y": { state: String(i), attributes: {} } } } as never; await settle(el); }
    expect(root.querySelector('aside [role=tab][data-mode="add"]')?.getAttribute("aria-selected")).toBe("true");
    expect(h.addDevQuery).toBe("spot");
    expect((root.querySelector("#addDevSearch") as HTMLInputElement).value).toBe("spot");
  });
});

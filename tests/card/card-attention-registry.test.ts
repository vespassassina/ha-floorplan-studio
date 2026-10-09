import { afterEach, describe, expect, it } from "vitest";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";
import type { Layout } from "../../src/core/schema";

// S25 fix: the plan's dots and the room badge read the same attention result as the Overview, registry included.
// Shape of hass.entities: the frontend's display entries ({ device_id, entity_category }), as attention.ts documents.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-09T10:00:00Z", last_updated: "2026-10-09T10:00:00Z", entity_id: "" });
const layout = {
  version: 2, floors: { g: {
    title: "G", outline: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], owk: ["external", "external", "external", "external"], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [],
    rooms: [{ id: "hall", name: "Hall", area: "", kind: "room", pts: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], wk: ["wall", "wall", "wall", "wall"] }],
    devices: [{ id: "c", type: "contact", entity: "binary_sensor.z2m", x: 500, y: 500 }],
  } },
} as unknown as Layout;

afterEach(() => { document.body.innerHTML = ""; });

describe("the plan and the Overview agree on a Zigbee2MQTT contact with a separate diagnostic battery", () => {
  it("dot drawn and Hall badge counts 1, as the Overview lists 1", async () => {
    const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
    document.body.appendChild(el);
    el.setConfig({ layout, detail: "minimal" } as FloorplanStudioCardConfig);
    el.hass = {
      states: { "binary_sensor.z2m": st("off"), "sensor.z2m_battery": st("2", { device_class: "battery", unit_of_measurement: "%" }) },
      entities: { "binary_sensor.z2m": { device_id: "dev1" }, "sensor.z2m_battery": { device_id: "dev1", entity_category: "diagnostic" } },
      themes: { darkMode: false },
    } as never;
    await el.updateComplete;
    const r = el.shadowRoot!;
    expect(r.querySelector('svg g[data-x="0"]')!.getAttribute("class")).toContain("needs-attention");
    expect(r.querySelector('svg g[data-rb="0"] .rb-t')!.textContent).toBe("1");
  });
});

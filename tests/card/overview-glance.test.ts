import { describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";
import { make } from "../../src/card/overview/panel";

const L = demo as unknown as Layout;

describe("S74: Overview Home Glance KPI strip", () => {
  it("renders lights, open count, temperature, power with cost, water and gas tiles", async () => {
    const el = new FloorplanStudioCard();
    document.body.appendChild(el);
    const lay = structuredClone(L);
    lay.floors.ground.rooms[0].temps = ["sensor.t1"];
    lay.floors.ground.rooms[0].power = ["sensor.p1"];
    lay.floors.ground.rooms[0].water = ["sensor.w1"];
    el.setConfig({ layout: lay, active_list: true });
    el.hass = {
      states: {
        "light.demo_living": { state: "on", attributes: {}, last_changed: "2026-11-25T10:00:00Z" },
        "light.demo_kitchen": { state: "off", attributes: {}, last_changed: "2026-11-25T10:00:00Z" },
        "binary_sensor.demo_front_door": { state: "on", attributes: { device_class: "door" }, last_changed: "2026-11-25T10:00:00Z" },
        "sensor.t1": { state: "21.5", attributes: { unit_of_measurement: "°C", device_class: "temperature" }, last_changed: "2026-11-25T10:00:00Z" },
        "sensor.p1": { state: "1500", attributes: { unit_of_measurement: "W", device_class: "power" }, last_changed: "2026-11-25T10:00:00Z" },
        "sensor.w1": { state: "0.4", attributes: { unit_of_measurement: "m³/h" }, last_changed: "2026-11-25T10:00:00Z" },
        "sensor.house_gas": { state: "1.2", attributes: { unit_of_measurement: "m³", device_class: "gas" }, last_changed: "2026-11-25T10:00:00Z" },
        "sensor.energy_cost": { state: "3.45", attributes: { unit_of_measurement: "€", device_class: "monetary" }, last_changed: "2026-11-25T10:00:00Z" },
      },
      themes: { darkMode: false },
    } as never;
    // Wait for lazy overview chunk to render
    for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 10)); }
    const glance = el.shadowRoot!.querySelector(".fp-glance");
    expect(glance, "glance strip renders").toBeTruthy();
    const text = glance!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("1/2"); // lights
    expect(text).toContain("1.5 kW"); // power
    expect(text).toContain("€3.45"); // cost
    expect(text).toContain("21.5°C"); // temperature
    expect(text).toContain("0.4 m³/h"); // water
    expect(text).toContain("1.2 m³"); // gas
    expect(el.shadowRoot!.querySelector(".fp-ov-hint")).toBeNull();
    expect(typeof make).toBe("function");
    el.remove();
  });
});

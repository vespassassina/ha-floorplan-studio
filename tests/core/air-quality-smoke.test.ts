import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, classOf, isAirQualityBad, isSmokeDetected, renderFloor, roomHazards, roomAt, typeForEntity, validate, type Floor, type Layout } from "../../src/core";

function makeFloor(extra?: Partial<Floor>): Floor {
  return {
    title: "Basement",
    outline: [[0, 0], [500, 0], [500, 400], [0, 400]],
    rooms: [{
      id: "r1", name: "Basement", area: "basement", kind: "room",
      pts: [[0, 0], [500, 0], [500, 400], [0, 400]],
      wk: ["external", "external", "external", "external"],
      airQuality: ["sensor.basement_co2", "sensor.basement_voc"],
      smoke: ["binary_sensor.basement_smoke"],
    }],
    walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
    ...extra,
  };
}

describe("S94: Air quality sensor and smoke detector + room warning signs", () => {
  it("validates air_quality and smoke device types and room-attached lists", () => {
    expect(DEVICE_TYPES).toContain("air_quality");
    expect(DEVICE_TYPES).toContain("smoke");
    const f = makeFloor({
      devices: [
        { id: "aq1", type: "air_quality", entity: "sensor.living_co2", airSensors: ["sensor.living_pm25", "sensor.living_hcho", "binary_sensor.living_gas"], x: 100, y: 100 },
        { id: "sm1", type: "smoke", entity: "binary_sensor.living_smoke", x: 200, y: 100 },
      ],
    });
    const layout: Layout = { version: 2, unit: "cm", north: 0, floors: { basement: f }, catalog: [] };
    expect(validate(layout).ok).toBe(true);
  });

  it("detects bad air quality across CO2, PM2.5, PM5, PM10, VOC, formaldehyde, CO, gas, and enum states", () => {
    expect(isAirQualityBad({ state: "800", attributes: { device_class: "carbon_dioxide" }, last_changed: "" }, "sensor.co2")).toBe(false);
    expect(isAirQualityBad({ state: "1800", attributes: { device_class: "carbon_dioxide" }, last_changed: "" }, "sensor.co2")).toBe(true);
    expect(isAirQualityBad({ state: "65", attributes: { device_class: "pm25" }, last_changed: "" }, "sensor.pm25")).toBe(true);
    expect(isAirQualityBad({ state: "120", attributes: {}, last_changed: "" }, "sensor.basement_pm5")).toBe(true);
    expect(isAirQualityBad({ state: "160", attributes: { device_class: "pm10" }, last_changed: "" }, "sensor.pm10")).toBe(true);
    expect(isAirQualityBad({ state: "600", attributes: { device_class: "volatile_organic_compounds_parts" }, last_changed: "" }, "sensor.voc")).toBe(true);
    expect(isAirQualityBad({ state: "0.15", attributes: { unit_of_measurement: "mg/m³" }, last_changed: "" }, "sensor.formaldehyde")).toBe(true);
    expect(isAirQualityBad({ state: "40", attributes: { device_class: "carbon_monoxide" }, last_changed: "" }, "sensor.co")).toBe(true);
    expect(isAirQualityBad({ state: "on", attributes: { device_class: "gas" }, last_changed: "" }, "binary_sensor.basement_gas")).toBe(true);
    expect(isAirQualityBad({ state: "very_poor", attributes: {}, last_changed: "" }, "sensor.air_quality")).toBe(true);

    expect(isSmokeDetected({ state: "off", attributes: {}, last_changed: "" })).toBe(false);
    expect(isSmokeDetected({ state: "on", attributes: {}, last_changed: "" })).toBe(true);
    expect(isSmokeDetected({ state: "detected", attributes: {}, last_changed: "" })).toBe(true);
  });

  it("renders a small yellow warning sign for bad air quality and a bigger red warning sign for smoke on the room", () => {
    const f = makeFloor();
    const okSvg = renderFloor(f, {
      scale: 1,
      state: {
        "sensor.basement_co2": { state: "650", attributes: { device_class: "carbon_dioxide" }, last_changed: "" },
        "binary_sensor.basement_smoke": { state: "off", attributes: { device_class: "smoke" }, last_changed: "" },
      },
    });
    expect(okSvg).not.toContain("room-warn-air");
    expect(okSvg).not.toContain("room-warn-smoke");

    const badSvg = renderFloor(f, {
      scale: 1,
      state: {
        "sensor.basement_co2": { state: "2100", attributes: { device_class: "carbon_dioxide" }, last_changed: "" },
        "binary_sensor.basement_smoke": { state: "on", attributes: { device_class: "smoke" }, last_changed: "" },
      },
    });
    expect(badSvg).toContain('class="room-warn-air"');
    expect(badSvg).toContain('class="room-warn-smoke"');
    // Smoke warning sign is bigger than the air-quality warning sign (1.25 vs 0.72)
    expect(badSvg).toContain("scale(0.72)");
    expect(badSvg).toContain("scale(1.25)");

    const hz = roomHazards(f, {
      "sensor.basement_co2": { state: "2100", attributes: { device_class: "carbon_dioxide" }, last_changed: "" },
      "binary_sensor.basement_smoke": { state: "off", attributes: { device_class: "smoke" }, last_changed: "" },
    }, roomAt);
    expect(hz.get(0)).toEqual({ airBad: true, smoke: false });
  });

  it("auto-detects air_quality and smoke entities from HA device classes and sets classOf", () => {
    expect(typeForEntity({ id: "sensor.b_co2", domain: "sensor", dc: "carbon_dioxide", name: "CO2" })).toBe("air_quality");
    expect(typeForEntity({ id: "sensor.b_pm25", domain: "sensor", dc: "pm25", name: "PM2.5" })).toBe("air_quality");
    expect(typeForEntity({ id: "binary_sensor.b_smoke", domain: "binary_sensor", dc: "smoke", name: "Smoke" })).toBe("smoke");
    expect(classOf({ id: "sm", type: "smoke", entity: "binary_sensor.b_smoke", x: 10, y: 10 }, {
      scale: 1,
      state: { "binary_sensor.b_smoke": { state: "on", attributes: { device_class: "smoke" }, last_changed: "" } },
    })).toBe("danger");
  });
});

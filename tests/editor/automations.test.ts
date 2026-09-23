import { describe, it, expect } from "vitest";
import { motionLights, schedule, switchControls } from "../../src/editor/automations";

describe("switchControls", () => {
  it("builds one automation: the switch on/off drives turn_on/turn_off on every target", () => {
    const cfg = switchControls("switch.demo_hall", ["light.a", "light.b"]);
    expect(cfg.trigger).toEqual([
      { platform: "state", entity_id: "switch.demo_hall", to: "on", id: "on" },
      { platform: "state", entity_id: "switch.demo_hall", to: "off", id: "off" },
    ]);
    expect(cfg.action).toEqual([{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: ["light.a", "light.b"] } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: ["light.a", "light.b"] } }] },
    ] }]);
    expect(cfg.alias).toContain("switch.demo_hall");
  });

  it("break it: refuses a switch that targets itself, and an empty target list", () => {
    expect(() => switchControls("switch.demo_hall", ["switch.demo_hall"])).toThrow("A switch cannot control itself.");
    expect(() => switchControls("switch.demo_hall", ["light.a", "switch.demo_hall"])).toThrow("A switch cannot control itself.");
    expect(() => switchControls("switch.demo_hall", [])).toThrow(/at least one/);
  });
});

describe("motionLights", () => {
  it("turns the light group on with motion, off after the given seconds with none", () => {
    const cfg = motionLights("binary_sensor.hall_motion_group", "light.hall_group", 300);
    expect(cfg.trigger).toEqual([
      { platform: "state", entity_id: "binary_sensor.hall_motion_group", to: "on", id: "on" },
      { platform: "state", entity_id: "binary_sensor.hall_motion_group", to: "off", for: { seconds: 300 }, id: "off" },
    ]);
    expect(cfg.action).toEqual([{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: "light.hall_group" } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: "light.hall_group" } }] },
    ] }]);
  });

  it("break it: refuses a zero or negative delay", () => {
    expect(() => motionLights("binary_sensor.m", "light.g", 0)).toThrow(/positive/);
    expect(() => motionLights("binary_sensor.m", "light.g", -5)).toThrow(/positive/);
  });
});

describe("schedule", () => {
  it("turns the entity on and off at the given times", () => {
    const cfg = schedule("light.demo_living", "07:30", "23:00");
    expect(cfg.trigger).toEqual([
      { platform: "time", at: "07:30", id: "on" },
      { platform: "time", at: "23:00", id: "off" },
    ]);
    expect(cfg.action).toEqual([{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: "light.demo_living" } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: "light.demo_living" } }] },
    ] }]);
  });

  it("break it: rejects a malformed time", () => {
    expect(() => schedule("light.a", "7:30", "23:00")).toThrow(/HH:MM/);
    expect(() => schedule("light.a", "07:30", "tomorrow")).toThrow(/HH:MM/);
    expect(() => schedule("light.a", "25:00", "23:00")).toThrow(/HH:MM/);
  });
});

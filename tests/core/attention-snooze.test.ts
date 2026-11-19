import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attention, attentionSnoozeKey, type Layout } from "../../src/core";
import { attentionDevices } from "../../src/core/attention";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;

describe("attention snooze (S47)", () => {
  it("suppresses a snoozed item across items, floor counts, and attentionDevices until its state changes", () => {
    const layout = structuredClone(demo);
    layout.floors.ground.devices.push({
      id: "front_door_contact",
      name: "Front door",
      type: "contact",
      entity: "binary_sensor.front_door",
      x: 200,
      y: 200,
    });

    const state1 = {
      "binary_sensor.front_door": { state: "on", attributes: {}, last_changed: "2026-11-18T10:00:00Z" },
    };
    const a1 = attention(layout, state1);
    const it1 = a1.items.find((x) => x.entity === "binary_sensor.front_door");
    expect(it1).toBeDefined();
    const countBefore = a1.floors.ground.count;

    const snooze = { [attentionSnoozeKey(it1!)]: it1!.state };
    const a2 = attention(layout, state1, undefined, undefined, snooze);
    expect(a2.items.find((x) => x.entity === "binary_sensor.front_door")).toBeUndefined();
    expect(a2.floors.ground.count).toBe(countBefore - 1);

    // Render helper reads the same attention() result
    const devs = attentionDevices(layout.floors.ground, state1, { floor: "ground", result: a2 });
    expect(devs.has(layout.floors.ground.devices.length - 1)).toBe(false);

    // State changes -> snooze no longer matches
    layout.floors.ground.devices.push({
      id: "alarm_panel",
      name: "Alarm",
      type: "alarm",
      entity: "alarm_control_panel.home",
      x: 220,
      y: 220,
    });
    const stateArmed = {
      "alarm_control_panel.home": { state: "armed_away", attributes: {}, last_changed: "2026-11-18T10:00:00Z" },
    };
    const armedItem = attention(layout, stateArmed).items.find((x) => x.entity === "alarm_control_panel.home")!;
    const snoozeArmed = { [attentionSnoozeKey(armedItem)]: "armed_away" };

    expect(attention(layout, stateArmed, undefined, undefined, snoozeArmed).items.some((x) => x.entity === "alarm_control_panel.home")).toBe(false);

    const stateTriggered = {
      "alarm_control_panel.home": { state: "triggered", attributes: {}, last_changed: "2026-11-18T10:01:00Z" },
    };
    const a3 = attention(layout, stateTriggered, undefined, undefined, snoozeArmed);
    expect(a3.items.some((x) => x.entity === "alarm_control_panel.home" && x.kind === "alarm-triggered")).toBe(true);
    expect(a3.floors.ground.alarm).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEVICE_ICONS, renderFloor, validate, VALUE_ICON, type Layout } from "../../src/core";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;

describe("other value icon (S48)", () => {
  it("validates icon: 'value' only on type 'other'", () => {
    const okLayout = structuredClone(demo);
    okLayout.floors.ground.devices.push({
      id: "co2_living",
      name: "CO2",
      type: "other",
      icon: "value",
      entity: "sensor.living_co2",
      x: 200,
      y: 200,
    });
    expect(validate(okLayout).ok).toBe(true);

    const wrongType = structuredClone(okLayout);
    const dev = wrongType.floors.ground.devices.at(-1)!;
    dev.type = "light";
    expect(validate(wrongType).ok).toBe(false);

    const badIcon = structuredClone(okLayout);
    (badIcon.floors.ground.devices.at(-1)! as unknown as Record<string, unknown>).icon = "bogus";
    expect(validate(badIcon).ok).toBe(false);

    const throwingGetter = structuredClone(okLayout);
    Object.defineProperty(throwingGetter.floors.ground.devices.at(-1)!, "icon", {
      enumerable: true,
      get() { throw new Error("boom"); },
    });
    expect(validate(throwingGetter).ok).toBe(false);
  });

  it("draws VALUE_ICON and formatted live readings on type 'other' with icon: 'value'", () => {
    const f = structuredClone(demo.floors.ground);
    f.devices = [
      { id: "v_num", name: "CO2", type: "other", icon: "value", entity: "sensor.co2", x: 180, y: 180 },
      { id: "v_txt", name: "Mode", type: "other", icon: "value", entity: "sensor.mode", x: 260, y: 180 },
      { id: "v_miss", name: "Offline", type: "other", icon: "value", entity: "sensor.offline", x: 340, y: 180 },
      { id: "v_def", name: "Default", type: "other", entity: "sensor.def", x: 420, y: 180 },
    ];
    const svg = renderFloor(f, {
      scale: 1,
      state: {
        "sensor.co2": { state: "640", attributes: { unit_of_measurement: "ppm" }, last_changed: "" },
        "sensor.mode": { state: "VeryLongModeStateName", attributes: {}, last_changed: "" },
        "sensor.offline": { state: "unavailable", attributes: {}, last_changed: "" },
        "sensor.def": { state: "42", attributes: { unit_of_measurement: "W" }, last_changed: "" },
      },
      labels: true,
    });
    expect(svg).toContain(VALUE_ICON);
    expect(svg).toContain(DEVICE_ICONS.other);
    expect(svg).toContain("640\u202Fppm");
    expect(svg).toContain("VeryLongModeS…");
    expect(svg).toContain(">–</text>");
    expect(svg).not.toContain("42\u202FW");
  });
});

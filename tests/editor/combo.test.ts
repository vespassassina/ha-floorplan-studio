import { describe, it, expect } from "vitest";
import { filterCombo, type ComboOption } from "../../src/editor/combo";

const opts: ComboOption[] = [
  { value: "light.kitchen_lamp", label: "Kitchen lamp", group: "Kitchen" },
  { value: "light.living_lamp", label: "Living lamp", group: "Living room" },
  { value: "switch.kitchen_fan", label: "Fan", group: "Kitchen" },
  { value: "sensor.pond_temp", label: "Pond temperature", group: "Garden" },
];

describe("filterCombo", () => {
  it("returns everything for an empty query", () => {
    expect(filterCombo(opts, "")).toHaveLength(4);
    expect(filterCombo(opts, "   ")).toHaveLength(4);
  });

  it("matches by label, case-insensitively", () => {
    expect(filterCombo(opts, "LAMP").map((o) => o.value)).toEqual(["light.kitchen_lamp", "light.living_lamp"]);
  });

  it("matches by value (entity id), not only the label", () => {
    expect(filterCombo(opts, "pond_temp").map((o) => o.value)).toEqual(["sensor.pond_temp"]);
  });

  it("matches by group label", () => {
    expect(filterCombo(opts, "kitchen").map((o) => o.value)).toEqual(["light.kitchen_lamp", "switch.kitchen_fan"]);
  });

  it("requires every space-separated word to match somewhere (label, value or group), a multi-word AND filter", () => {
    expect(filterCombo(opts, "kitchen lamp").map((o) => o.value)).toEqual(["light.kitchen_lamp"]);
    // "kitchen" matches the group, "fan" matches this row's own label: still every word satisfied, on the same option
    expect(filterCombo(opts, "kitchen fan").map((o) => o.value)).toEqual(["switch.kitchen_fan"]);
  });

  it("returns nothing when a word matches no option", () => {
    expect(filterCombo(opts, "nonexistent")).toHaveLength(0);
    expect(filterCombo(opts, "kitchen nonexistent")).toHaveLength(0);
  });

  it("an option with no group is still matched by label and value only", () => {
    const ungrouped: ComboOption[] = [{ value: "light.hall", label: "Hall light" }];
    expect(filterCombo(ungrouped, "hall")).toHaveLength(1);
    expect(filterCombo(ungrouped, "nogroup")).toHaveLength(0);
  });
});

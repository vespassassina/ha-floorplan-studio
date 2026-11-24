import { describe, it, expect, vi } from "vitest";
import { actionIconPath, createActionRegistry, MAX_CUSTOM_ACTIONS } from "../../src/editor/custom-actions";

describe("GitHub Issue #1: declarative custom action registry", () => {
  it("registers, updates by id, unregisters, and notifies subscribers", () => {
    const reg = createActionRegistry();
    const spy = vi.fn();
    const unsub = reg.subscribe(spy);

    const off = reg.register({ id: "ramses.seed", label: "Add devices", icon: "light", title: "Seed devices" });
    expect(reg.list()).toEqual([{ id: "ramses.seed", label: "Add devices", icon: "light", title: "Seed devices" }]);
    expect(spy).toHaveBeenCalledTimes(1);

    // Updating same id replaces in place
    reg.register({ id: "ramses.seed", label: "Seed missing" });
    expect(reg.list()).toEqual([{ id: "ramses.seed", label: "Seed missing" }]);

    off();
    expect(reg.list()).toEqual([]);
    unsub();
  });

  it("rejects empty id/label, ignores hostile icon paths, and enforces MAX_CUSTOM_ACTIONS", () => {
    const reg = createActionRegistry();
    expect(() => reg.register({ id: "", label: "Bad" })).toThrow();
    expect(() => reg.register({ id: "x", label: "   " })).toThrow();

    // Unknown or hostile icon strings are stripped (never injected as SVG/HTML)
    reg.register({ id: "a", label: "Safe", icon: "<script>alert(1)</script>" });
    expect(reg.list()[0]!.icon).toBeUndefined();
    expect(actionIconPath("<svg>")).toBeNull();
    expect(actionIconPath("light")).toMatch(/^M/);

    for (let i = 1; i < MAX_CUSTOM_ACTIONS; i++) reg.register({ id: `k${i}`, label: `Act ${i}` });
    expect(() => reg.register({ id: "overflow", label: "Too many" })).toThrow(/maximum/i);
  });
});

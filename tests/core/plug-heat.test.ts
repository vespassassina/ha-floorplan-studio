import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, type Device, type Layout } from "../../src/core/schema";
import { deviceMarkup, renderFloor, FLOORPLAN_CSS, type StateOverlay } from "../../src/core/render";
import { HEAT_FROM, HEAT_TO, heatRange, powerHeat } from "../../src/core/power";

// S14.8 (spec item 24): a plug is tinted from idle to hot by its draw. The fraction lives in `--fp-heat` on the icon group,
// the one source the plan (2D, 2.5D) and the 3D overlay both read; the stylesheet turns it into a colour.

const ground = (demo as unknown as Layout).floors.ground;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-03T10:00:00Z" });
const W = (n: string, unit = "W") => st(n, { unit_of_measurement: unit });
const plug = (extra: Partial<Device> = {}): Device => ({ id: "p", type: "plug", entity: "switch.p", name: "P", x: 50, y: 50, power: "sensor.p", ...extra }) as Device;
const heatOf = (d: Device, state: StateOverlay, o: object = { plugHeat: [0, 2000] }) => {
  const style = deviceMarkup(ground, d, { scale: 1, state, ...o }, 0, [50, 50]).style.find((s) => s.startsWith("--fp-heat:"));
  return style ? Number(style.slice("--fp-heat:".length)) : null;
};

describe("powerHeat: where a draw sits between the two thresholds", () => {
  it("is 0 at or under the low end, 1 at or over the high end, linear between (asymmetric: 300 of 1200 is 0.25)", () => {
    expect(powerHeat(0, 0, 2000)).toBe(0);
    expect(powerHeat(-5, 0, 2000)).toBe(0);
    expect(powerHeat(2000, 0, 2000)).toBe(1);
    expect(powerHeat(9999, 0, 2000)).toBe(1);
    expect(powerHeat(500, 0, 2000)).toBe(0.25);
    expect(powerHeat(300, 100, 900)).toBe(0.25);
    expect(powerHeat(100, 100, 900)).toBe(0);
  });
});

describe("heatRange: untrusted card options", () => {
  it("defaults to 0 and 2000 W", () => {
    expect([HEAT_FROM, HEAT_TO]).toEqual([0, 2000]);
    expect(heatRange(undefined)).toEqual([0, 2000]);
  });
  it("takes two finite numbers with from < to; anything else is the default", () => {
    expect(heatRange([10, 500])).toEqual([10, 500]);
    for (const v of [[5, 5], [9, 3], [NaN, 5], [0, Infinity], ["1", "2"], [1], [1, 2, 3], null, "x", {}])
      expect(heatRange(v), JSON.stringify(v)).toEqual([0, 2000]);
  });
});

describe("a plug's --fp-heat on the plan", () => {
  it("two draws give two different fractions (100 W and 1500 W)", () => {
    const low = heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("100") });
    const high = heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("1500") });
    expect(low).toBe(0.05);
    expect(high).toBe(0.75);
  });
  it("follows the card's range, and kW is converted", () => {
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("300") }, { plugHeat: [100, 900] })).toBe(0.25);
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("1.5", "kW") })).toBe(0.75);
  });
  it("an own power sensor and a runtime link both work", () => {
    const s = { "switch.p": st("on"), "sensor.link": W("1000") };
    expect(heatOf(plug({ power: undefined }), s, { plugHeat: [0, 2000], powerLinks: { "switch.p": "sensor.link" } })).toBe(0.5);
  });
  it("no sensor, an unreadable one, a plug that is off, or no option: no --fp-heat at all (today's markup)", () => {
    expect(heatOf(plug({ power: undefined }), { "switch.p": st("on") })).toBeNull();
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("unavailable") })).toBeNull();
    expect(heatOf(plug(), { "switch.p": st("off"), "sensor.p": W("900") })).toBeNull();
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("900") }, {})).toBeNull();
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("1", "A") })).toBeNull();
  });
  it("a plug under the active threshold is off, so it has no heat either", () => {
    expect(heatOf(plug(), { "switch.p": st("on"), "sensor.p": W("1") })).toBeNull();
  });
  it("only a plug has heat: every device type is a decision (iterates DEVICE_TYPES)", () => {
    for (const t of DEVICE_TYPES) {
      const d = { id: "x", type: t, entity: "x.y", x: 1, y: 1, ...(t === "plug" ? { power: "sensor.p" } : {}) } as Device;
      const h = heatOf(d, { "x.y": st("on"), "sensor.p": W("1000") });
      expect(h, t).toBe(t === "plug" ? 0.5 : null);
    }
  });
  it("renderFloor writes it on the plug's group, in 2D and 2.5D, and the tooltip carries the watts (colour is not the only signal)", () => {
    const f = { ...structuredClone(ground), devices: [plug()] } as never;
    for (const view of ["2d", "2.5d"] as const) {
      const svg = renderFloor(f, { scale: 1, view, state: { "switch.p": st("on"), "sensor.p": W("1500") }, plugHeat: [0, 2000] });
      expect(svg, view).toMatch(/<g data-x="0" class="dev dev-plug on"[^>]*style="--fp-heat:0\.75;--fp-dev-ink:var\(--fp-pure-[a-z]+\)"/); // S23.4: the heat colour carries its own glyph ink
      expect(svg, view).toContain("1500 W");
    }
  });
  it("without the option the output is byte for byte what it was", () => {
    const f = { ...structuredClone(ground), devices: [plug()] } as never;
    const state = { "switch.p": st("on"), "sensor.p": W("1500") };
    expect(renderFloor(f, { scale: 1, state })).toBe(renderFloor(f, { scale: 1, state, plugHeat: undefined }));
    expect(renderFloor(f, { scale: 1, state })).not.toContain("--fp-heat");
  });
});

describe("the stylesheet reads --fp-heat from tokens only", () => {
  it("a .dev-plug.on rule mixes the three ramp tokens, which every theme inherits,", () => {
    const rule = FLOORPLAN_CSS.match(/\.dev-plug\.on\[style\*="--fp-heat"\]\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("--fp-heat");
    for (const t of ["--fp-heat-cool", "--fp-heat-mid", "--fp-heat-hot"]) expect(rule).toContain(t);
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

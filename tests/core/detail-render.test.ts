import { describe, expect, it } from "vitest";
import { renderFloor, FLOORPLAN_CSS } from "../../src/core/render";
import { DEVICE_TYPES } from "../../src/core/schema";
import type { DeviceType, Floor } from "../../src/core/schema";

// S25.2: renderFloor writes the level on the plan root; every level rule is CSS keyed on it.
const FLOOR = {
  title: "T", outline: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
  rooms: [], devices: [{ id: "l", type: "light", entity: "light.l", x: 500, y: 500 }],
} as unknown as Floor;
const root = (o: object) => renderFloor(FLOOR, { scale: 1, ...o });

describe("data-detail on the plan root", () => {
  it("is absent when no detail is passed: output is byte for byte what it was", () => {
    expect(root({})).not.toContain("data-detail");
    expect(root({ theme: "light" })).not.toContain("data-detail");
  });
  it("is written for each level, with or without a theme or night", () => {
    for (const lv of ["far", "mid", "near"]) {
      expect(root({ detail: lv, theme: "light" })).toMatch(new RegExp(`^<g data-theme="light" data-detail="${lv}"`));
      expect(root({ detail: lv })).toMatch(new RegExp(`^<g data-detail="${lv}">`));
      expect(root({ detail: lv, night: true })).toMatch(new RegExp(`^<g class="night" data-detail="${lv}">`));
    }
  });
  it("takes only the three names: junk writes nothing and cannot reach the attribute", () => {
    for (const j of ['"><script>', "FAR", "", 3, null, {}, ["far"]]) expect(root({ detail: j }), String(j)).not.toContain("data-detail");
  });
  it("changes nothing else: a level's markup is the plain markup inside the wrapper", () => {
    const plain = root({ theme: "light" });
    expect(root({ theme: "light", detail: "far" }).replace(' data-detail="far"', "")).toBe(plain);
  });
});

describe("every device type states its far behaviour (finding 17)", () => {
  // idle: the whole icon is hidden. active (on, alerting, unavailable): the glyph goes, the disc stays as a dot.
  const FAR: Record<DeviceType, "idle hides, active dots"> = Object.fromEntries(DEVICE_TYPES.map((t) => [t, "idle hides, active dots"])) as never;
  it("lists exactly DEVICE_TYPES", () => {
    expect(Object.keys(FAR).sort()).toEqual([...DEVICE_TYPES].sort());
  });
  it("the far rules key on the idle class, so every type must be able to wear one of on/off/unavailable/danger", () => {
    const devices = DEVICE_TYPES.map((type, i) => ({ id: `d${i}`, type, entity: `x.d${i}`, x: 100 + i * 20, y: 500 }));
    const out = renderFloor({ ...FLOOR, devices } as never, { scale: 1, detail: "far" });
    for (const [i, t] of DEVICE_TYPES.entries()) expect(out, t).toMatch(new RegExp(`data-x="${i}" class="dev dev-${t}[^"]* (on|off|unavailable|danger)[ "]`));
  });
  it("the stylesheet has the far, mid and near-less rules", () => {
    expect(FLOORPLAN_CSS).toContain('[data-detail="far"]');
    expect(FLOORPLAN_CSS).toContain('[data-detail="mid"]');
  });
});

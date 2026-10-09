import { describe, expect, it } from "vitest";
import { renderFloor, FLOORPLAN_CSS } from "../../src/core/render";
import { DEVICE_TYPES } from "../../src/core/schema";
import { ATTENTION_RULE } from "../../src/core/attention";
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
  // S25 fix B: idle devices are hidden at far; a device `attention()` reports on wears `needs-attention` and stays a dot,
  // whatever its on/off class says (an unlocked lock reads `off`). This table must list exactly DEVICE_TYPES; a state that
  // makes the type alert is the proof that the class follows the attention rule, not a copy of it.
  const ALERT: Partial<Record<DeviceType, { state: string; attributes?: Record<string, unknown> }>> = {
    alarm: { state: "triggered" }, contact: { state: "on" }, cover: { state: "open", attributes: { device_class: "garage" } }, lock: { state: "unlocked" },
    other: { state: "on", attributes: { device_class: "smoke" } },
  };
  const FAR: Record<DeviceType, "idle hides; attention keeps" | "idle hides"> = Object.fromEntries(DEVICE_TYPES.map((t) => [t, ATTENTION_RULE[t] === "none" ? "idle hides" : "idle hides; attention keeps"])) as never;
  const ent = (t: DeviceType) => (t === "other" ? "binary_sensor.x" : t === "alarm" ? "alarm_control_panel.x" : t === "cover" ? "cover.x" : t === "lock" ? "lock.x" : t === "contact" ? "binary_sensor.x" : `sensor.x`);
  const one = (type: DeviceType, s: { state: string; attributes?: Record<string, unknown> } | undefined, extra = {}) => {
    const d = { id: "d", type, entity: ent(type), x: 500, y: 500, ...extra };
    const state = s ? { [d.entity]: { state: s.state, attributes: s.attributes ?? {}, last_changed: "2026-10-09T10:00:00Z" } } : undefined;
    return renderFloor({ ...FLOOR, devices: [d] } as never, { scale: 1, detail: "far", state });
  };
  it("lists exactly DEVICE_TYPES, and the alert states cover exactly the types the attention rule watches", () => {
    expect(Object.keys(FAR).sort()).toEqual([...DEVICE_TYPES].sort());
    expect(Object.keys(ALERT).sort()).toEqual(DEVICE_TYPES.filter((t) => FAR[t] === "idle hides; attention keeps").sort());
  });
  it("per type: an alerting device wears needs-attention, an idle or fine one does not", () => {
    for (const t of DEVICE_TYPES) {
      const alert = ALERT[t];
      if (alert) expect(one(t, alert), `${t} alerting`).toMatch(/data-x="0" class="[^"]*\bneeds-attention\b/);
      for (const fine of [{ state: "off" }, { state: "locked" }, { state: "closed" }, { state: "idle" }, undefined]) expect(one(t, fine), `${t} ${fine?.state}`).not.toContain("needs-attention");
    }
  });
  it("a low battery makes any placed device needs-attention (battery_level 3), not at 80", () => {
    expect(one("contact", { state: "off", attributes: { battery_level: 3 } })).toContain("needs-attention");
    expect(one("contact", { state: "off", attributes: { battery_level: 80 } })).not.toContain("needs-attention");
    expect(one("light", { state: "off", attributes: { battery_level: 3 } })).toContain("needs-attention");
  });
  it("a battery sensor at 4 % is needs-attention; the home battery type never is", () => {
    const sensor = { state: "4", attributes: { device_class: "battery", unit_of_measurement: "%" } };
    expect(one("temp", sensor)).toContain("needs-attention");
    expect(one("battery", sensor)).not.toContain("needs-attention");
  });
  it("the far rule spares needs-attention in the stylesheet", () => {
    expect(FLOORPLAN_CSS).toMatch(/\[data-detail="far"\] \.dev:not\(\.on\)[^{]*:not\(\.needs-attention\)/);
  });
  it("the stylesheet has the far, mid and near-less rules", () => {
    expect(FLOORPLAN_CSS).toContain('[data-detail="far"]');
    expect(FLOORPLAN_CSS).toContain('[data-detail="mid"]');
  });
});

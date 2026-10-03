import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, type Device, type Layout } from "../../src/core/schema";
import { activeDevices } from "../../src/core/active";
import { classOf, FLOORPLAN_CSS, renderFloor, type StateOverlay } from "../../src/core/render";
import { COVER_CLASSES, coverActive } from "../../src/core/cover";

// Diego, 2026-10-03: "curtains should NOT show active (they are covers but not the same as a garage door)".
// A cover is active (open, opening, closing) only when HA says its device_class is a garage door, a gate or a door.
// HA's CoverDeviceClass members (homeassistant.components.cover): awning, blind, curtain, damper, door, garage, gate,
// shade, shutter, window. Each is a decision in COVER_CLASSES; this test walks the union (finding 17).
const WANT: Record<string, boolean> = { awning: false, blind: false, curtain: false, damper: false, door: true, garage: true, gate: true, shade: false, shutter: false, window: false };
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-09-19T10:00:00Z" });
const cover: Device = { id: "c", type: "cover", entity: "cover.c", x: 50, y: 50 } as Device;
const ground = (demo as unknown as Layout).floors.ground;

describe("a cover is active only when it is a garage door, a gate or a door", () => {
  it("the table covers every HA cover device class, no more, no fewer", () => {
    expect(Object.keys(COVER_CLASSES).sort()).toEqual(Object.keys(WANT).sort());
  });
  it("every device_class x every state", () => {
    for (const [cls, active] of Object.entries(WANT)) {
      for (const s of ["open", "opening", "closing", "closed", "stopped"]) {
        const live = s === "open" || s === "opening" || s === "closing";
        const state = { "cover.c": st(s, { device_class: cls }) };
        expect(classOf(cover, { scale: 1, state }), `${cls} ${s}`).toBe(active && live ? "on" : "off");
        expect(coverActive(state["cover.c"]), `${cls} ${s}`).toBe(active && live);
      }
      expect(classOf(cover, { scale: 1, state: { "cover.c": st("unavailable", { device_class: cls }) } }), `${cls} unavailable`).toBe("unavailable");
      expect(classOf(cover, { scale: 1, state: { "cover.c": st("unknown", { device_class: cls }) } }), `${cls} unknown`).toBe("unavailable");
    }
  });
  it("no device class, or junk, is a curtain: never active (hostile attributes included)", () => {
    for (const attrs of [{}, { device_class: null }, { device_class: 5 }, { device_class: "" }, { device_class: "GARAGE " }, { device_class: "__proto__" }, { device_class: "constructor" }, { device_class: ["garage"] }, { device_class: { a: 1 } }]) {
      expect(classOf(cover, { scale: 1, state: { "cover.c": st("open", attrs) } }), JSON.stringify(attrs)).toBe("off");
    }
    expect(coverActive(undefined)).toBe(false);
    expect(coverActive({ state: "open" } as never)).toBe(false);
    expect(coverActive({ state: "open", attributes: null } as never)).toBe(false);
  });
  it("the Active list agrees with the plan: a gate is listed while open, a curtain beside it is not", () => {
    const gate = { ...cover, id: "g", entity: "cover.gate" } as Device;
    const l = { version: 2, unit: "cm", north: 0, catalog: [], floors: { f: { ...ground, rooms: [], doors: [], devices: [cover, gate] } } } as unknown as Layout;
    const state = { "cover.c": st("open", { device_class: "curtain" }), "cover.gate": st("open", { device_class: "gate" }) };
    expect(activeDevices(l, state).map((a) => a.entity)).toEqual(["cover.gate"]);
    expect(activeDevices(l, { ...state, "cover.gate": st("closed", { device_class: "gate" }) })).toEqual([]);
    expect(activeDevices(l, { ...state, "cover.gate": st("unavailable", { device_class: "gate" }) })).toEqual([]);
  });
  it("a garage cover draws on, in the cover colour; a curtain draws idle, with no halo tint", () => {
    const draw = (state: StateOverlay) => renderFloor({ ...ground, rooms: [], devices: [cover], doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [] } as typeof ground, { scale: 0.5, state });
    expect(draw({ "cover.c": st("open", { device_class: "garage" }) })).toMatch(/<g data-x="0" class="[^"]*\bon\b/);
    expect(draw({ "cover.c": st("open", { device_class: "curtain" }) })).not.toMatch(/<g data-x="0" class="[^"]*\bon\b/);
    expect(FLOORPLAN_CSS).toContain(".dev-cover.on{--fp-dev:var(--fp-dev-cover)}");
  });
  it("a room that shows a cover entity follows the same rule", () => {
    const room = { name: "Garage", kind: "room", pts: [[0, 0], [200, 0], [200, 200], [0, 200]], entity: "cover.c" };
    const draw = (state: StateOverlay) => renderFloor({ ...ground, rooms: [room], devices: [], doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [] } as unknown as typeof ground, { scale: 0.5, state, roomGlow: true });
    expect(draw({ "cover.c": st("open", { device_class: "garage" }) })).toMatch(/class="room[^"]*\bon\b/);
    expect(draw({ "cover.c": st("open", { device_class: "curtain" }) })).not.toMatch(/class="room[^"]*\bon\b/);
  });
  it("DEVICE_TYPES still holds cover", () => expect(DEVICE_TYPES).toContain("cover"));
});

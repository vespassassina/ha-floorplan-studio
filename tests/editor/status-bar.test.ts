import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { statusFacts } from "../../src/editor/status-bar";

// S26.22: the status bar's text is a pure function of the editor state and two facts the host knows (Alt, drawing).
const fresh = () => structuredClone(demo) as unknown as Layout;
const make = () => { const st = new EditorState(fresh()); st.snapGrid = 10; return st; };
const idle = { alt: false, drawing: false };

describe("statusFacts", () => {
  beforeEach(() => localStorage.clear());

  it("with nothing selected: snap, floor and zoom only", () => {
    const st = make();
    const s = statusFacts(st, idle);
    expect(s.text).toBe("Snap 10 cm · Ground · 100 %");
    expect(s.locked).toBe(false);
  });

  it("with one device: its name and the room it stands in", () => {
    const st = make();
    st.sel = { t: "dev", i: 0 };
    const d = st.f.devices[0], s = statusFacts(st, idle);
    expect(s.text.startsWith(`${d.name} · `)).toBe(true);
    expect(s.text).toContain("Living");
    expect(s.text).not.toContain("selected");
  });

  it("with a room selected: the room once", () => {
    const st = make();
    const i = st.f.rooms.findIndex((r) => r.name === "Living");
    st.sel = { t: "room", i };
    const s = statusFacts(st, idle);
    expect(s.text.match(/Living/g)).toHaveLength(1);
  });

  it("with several devices: a count, and the room when they share one", () => {
    const st = make();
    // devices 0 (Living) and 1 (Kitchen) span two rooms: no room is named
    st.sel = { t: "devs", is: [0, 1] };
    expect(statusFacts(st, idle).text).toBe("2 selected · Snap 10 cm · Ground · 100 %");
    // bring device 1 into the Living room: now they share it
    const d1 = st.f.devices[1] as { x: number; y: number };
    d1.x = 260; d1.y = 210;
    expect(statusFacts(st, idle).text).toBe("2 selected · Living · Snap 10 cm · Ground · 100 %");
  });

  it("junk indices in a selection never throw", () => {
    const st = make();
    st.sel = { t: "devs", is: [999, -1, NaN] };
    expect(() => statusFacts(st, idle)).not.toThrow();
    st.sel = { t: "dev", i: 999 };
    expect(() => statusFacts(st, idle)).not.toThrow();
  });

  it("a turned view says so, normalised to 0-359", () => {
    const st = make();
    st.viewRot = 45;
    expect(statusFacts(st, idle).text).toContain("Turned 45°");
    st.viewRot = -90;
    expect(statusFacts(st, idle).text).toContain("Turned 270°");
  });

  it("Alt turns the snap off; the 15° step shows only while drawing and not with Alt", () => {
    const st = make();
    expect(statusFacts(st, idle).text).not.toContain("15°");
    expect(statusFacts(st, { alt: false, drawing: true }).text).toContain("Snap 10 cm · 15°");
    const alt = statusFacts(st, { alt: true, drawing: true }).text;
    expect(alt).toContain("Snap off");
    expect(alt).not.toContain("15°");
    expect(alt).not.toContain("10 cm");
  });

  it("a grid of 0 reads Snap off", () => {
    const st = make();
    st.snapGrid = 0;
    expect(statusFacts(st, idle).text).toContain("Snap off");
  });

  it("zoom is a percentage of the whole floor in view", () => {
    const st = make();
    const v = { ...st.view };
    st.views[st.floor] = { x: v.x, y: v.y, w: v.w / 2, h: v.h / 2 };
    expect(statusFacts(st, idle).text.endsWith("200 %")).toBe(true);
  });

  it("a locked plan says so and sets locked", () => {
    const st = make();
    st.planLocked = true;
    const s = statusFacts(st, idle);
    expect(s.locked).toBe(true);
    expect(s.text.endsWith("Plan locked")).toBe(true);
  });

  it("names are text, never markup", () => {
    const st = make();
    st.f.devices[0].name = '"><script>';
    st.sel = { t: "dev", i: 0 };
    expect(statusFacts(st, idle).text.startsWith('"><script> · ')).toBe(true);
  });
});

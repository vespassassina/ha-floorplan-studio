import { describe, it, expect, beforeEach } from "vitest";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "room-ground-1", name: "Hall", area: "hall", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [{ id: "sw-1", name: "Hall switch", type: "switch", entity: "switch.hall", x: 100, y: 120 }, { id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 200, y: 200 }] } },
  catalog: [{ id: "sw-1", floor: "ground", room: "Hall", type: "switch", name: "Hall switch", entity: "switch.hall" }, { id: "l-1", floor: "ground", room: "Hall", type: "light", name: "Lamp", entity: "light.lamp" }],
} as unknown as Layout);

describe("lightFromSwitch (S4.4)", () => {
  beforeEach(() => localStorage.clear());

  it("replaces the switch with the new light 30 cm to its right, bound to the switch, and lists the light in the catalog", () => {
    const st = new EditorState(layout());
    expect(st.lightFromSwitch(0, "light.hall_switch", "Hall switch")).toBe(true);
    const devs = st.f.devices;
    expect(devs.find((d) => d.entity === "switch.hall")).toBeUndefined();
    const l = devs.find((d) => d.entity === "light.hall_switch")!;
    expect(l).toMatchObject({ type: "light", name: "Hall switch", x: 130, y: 120, bound: "switch.hall" });
    expect(st.layout.catalog.find((c) => c.entity === "light.hall_switch")).toMatchObject({ type: "light", floor: "ground", room: "Hall", id: l.id });
    expect(st.sel).toEqual({ t: "dev", i: devs.indexOf(l) });
  });

  it("is one undo step, and undo brings the switch back and drops the light", () => {
    const st = new EditorState(layout());
    st.lightFromSwitch(0, "light.hall_switch", "Hall switch");
    expect(st.undo()).toBe(true);
    expect(st.f.devices.map((d) => d.entity)).toEqual(["switch.hall", "light.lamp"]);
    expect(st.layout.catalog).toHaveLength(2);
    expect(st.canUndo).toBe(false);
  });

  it("refuses a device that is not a switch or plug, or an entity already on the plan", () => {
    const st = new EditorState(layout());
    expect(st.lightFromSwitch(1, "light.x", "x")).toBe(false);
    expect(st.lightFromSwitch(0, "light.lamp", "x")).toBe(false);
    expect(st.lightFromSwitch(9, "light.x", "x")).toBe(false);
    expect(st.canUndo).toBe(false);
  });

  it("canMakeLight: a switch or plug no light is bound to", () => {
    const st = new EditorState(layout());
    expect(st.canMakeLight(0)).toBe(true);
    expect(st.canMakeLight(1)).toBe(false);
    st.f.devices[1].bound = "switch.hall";
    expect(st.canMakeLight(0)).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "room-ground-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [{ id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 200, y: 200 }] } },
  catalog: [{ id: "l-1", floor: "ground", room: "Kitchen", type: "light", name: "Lamp", entity: "light.lamp" }],
} as unknown as Layout);

describe("addFromArea (S4.18): placing an HA area entity onto the plan from the context menu", () => {
  beforeEach(() => localStorage.clear());

  it("adds a catalog entry and a device at the room's centre, guessing the type, selected, one undo step", () => {
    const st = new EditorState(layout());
    expect(st.addFromArea(0, { id: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature" })).toBe(true);
    const d = st.f.devices.find((x) => x.entity === "sensor.kitchen_temp")!;
    expect(d).toMatchObject({ type: "temp", name: "Kitchen temp", x: 200, y: 150 });
    expect(st.layout.catalog.find((c) => c.entity === "sensor.kitchen_temp")).toMatchObject({ type: "temp", floor: "ground", room: "Kitchen", id: d.id });
    expect(st.sel).toEqual({ t: "dev", i: st.f.devices.indexOf(d) });
    expect(st.canUndo).toBe(true);
    expect(st.undo()).toBe(true);
    expect(st.f.devices.some((x) => x.entity === "sensor.kitchen_temp")).toBe(false);
    expect(st.layout.catalog).toHaveLength(1);
  });

  it("refuses an unknown room, or an entity already on the plan or in the catalog", () => {
    const st = new EditorState(layout());
    expect(st.addFromArea(9, { id: "sensor.x", name: "x", domain: "sensor" })).toBe(false);
    expect(st.addFromArea(0, { id: "light.lamp", name: "Lamp", domain: "light" })).toBe(false);
    expect(st.canUndo).toBe(false);
  });
});

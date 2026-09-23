import { describe, it, expect } from "vitest";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "room-ground-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [{ id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 200, y: 200 }] } },
  catalog: [{ id: "l-1", floor: "ground", room: "Kitchen", type: "light", name: "Lamp", entity: "light.lamp" }],
} as unknown as Layout);

describe("addEntity (S4.14): the general palette's placement, click-to-place like every other device add", () => {
  it("an entity whose area matches a room on the current floor lands at that room's centre, and records the room in the catalog", () => {
    const st = new EditorState(layout());
    expect(st.addEntity({ id: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature", area: "kitchen" }, [999, 999])).toBe(true);
    const d = st.f.devices.find((x) => x.entity === "sensor.kitchen_temp")!;
    expect(d).toMatchObject({ type: "temp", name: "Kitchen temp", x: 200, y: 150 }); // the room's centroid, not the fallback point
    expect(st.layout.catalog.find((c) => c.entity === "sensor.kitchen_temp")).toMatchObject({ room: "Kitchen" });
    expect(st.sel).toEqual({ t: "dev", i: st.f.devices.indexOf(d) });
    expect(st.canUndo).toBe(true);
  });

  it("an entity with no matching room lands at the given fallback point, no room recorded", () => {
    const st = new EditorState(layout());
    expect(st.addEntity({ id: "light.spare", name: "Spare bulb", domain: "light" }, [500, 40])).toBe(true);
    const d = st.f.devices.find((x) => x.entity === "light.spare")!;
    expect(d).toMatchObject({ x: 500, y: 40 });
    expect(st.layout.catalog.find((c) => c.entity === "light.spare")?.room).toBeFalsy();
  });

  it("refuses an entity already on the plan or already in the catalog, one undo step total across two successful adds", () => {
    const st = new EditorState(layout());
    expect(st.addEntity({ id: "light.lamp", name: "Lamp", domain: "light" }, [0, 0])).toBe(false);
    expect(st.canUndo).toBe(false);
    st.addEntity({ id: "light.a", name: "A", domain: "light" }, [10, 10]);
    st.addEntity({ id: "light.b", name: "B", domain: "light" }, [20, 20]);
    expect(st.undo()).toBe(true);
    expect(st.f.devices.some((d) => d.entity === "light.b")).toBe(false);
    expect(st.f.devices.some((d) => d.entity === "light.a")).toBe(true);
    expect(st.undo()).toBe(true);
    expect(st.f.devices.some((d) => d.entity === "light.a")).toBe(false);
  });
});

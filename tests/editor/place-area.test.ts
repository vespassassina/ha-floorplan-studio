import { describe, it, expect, beforeEach } from "vitest";
import type { Layout } from "../../src/core/schema";
import type { HaData } from "../../src/core";
import { inside } from "../../src/core";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [
    { id: "room-ground-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] },
    { id: "room-ground-2", name: "Shed", area: "", label: "", kind: "room", pts: [[500, 0], [700, 0], [700, 200], [500, 200]], wk: ["wall", "wall", "wall", "wall"] },
  ], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [{ id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 200, y: 200 }] } },
  catalog: [
    { id: "l-1", floor: "ground", room: "Kitchen", type: "light", name: "Lamp", entity: "light.lamp" },
    { id: "c-1", floor: "ground", room: "Kitchen", type: "plug", name: "Kettle", entity: "switch.kettle" }, // catalogued, not drawn
  ],
} as unknown as Layout);

const ha = (): HaData => ({
  areas: [{ id: "kitchen", name: "Kitchen" }, { id: "hall", name: "Hall" }],
  entities: [
    { id: "light.lamp", name: "Lamp", domain: "light", area: "kitchen" },
    { id: "switch.kettle", name: "Kettle", domain: "switch", area: "kitchen" },
    { id: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature", area: "kitchen" },
    { id: "binary_sensor.kitchen_motion", name: "Kitchen motion", domain: "binary_sensor", dc: "motion", area: "kitchen" },
    { id: "light.ceiling", name: "Ceiling", domain: "light", area: "kitchen" },
    { id: "light.hall", name: "Hall light", domain: "light", area: "hall" },
  ],
} as unknown as HaData);

describe("placeArea (S4.15): every unplaced entity of a room's HA area, in one step", () => {
  beforeEach(() => localStorage.clear());

  it("places only the area's entities not yet on the plan or in the catalog, inside the room, apart, one undo step", () => {
    const st = new EditorState(layout());
    st.ha = ha();
    expect(st.areaToPlace(0).map((e) => e.id)).toEqual(["sensor.kitchen_temp", "binary_sensor.kitchen_motion", "light.ceiling"]);
    expect(st.placeArea(0)).toBe(3);
    const added = st.f.devices.filter((d) => ["sensor.kitchen_temp", "binary_sensor.kitchen_motion", "light.ceiling"].includes(d.entity));
    expect(added.map((d) => d.type)).toEqual(["temp", "motion", "light"]);
    const room = st.f.rooms[0].pts;
    for (const d of added) expect("x" in d && inside([d.x, d.y], room)).toBe(true);
    const spots = new Set(added.map((d) => ("x" in d ? `${d.x},${d.y}` : "")));
    expect(spots.size).toBe(3); // not stacked on one point
    expect(st.f.devices.some((d) => d.entity === "light.hall" || d.entity === "switch.kettle")).toBe(false);
    expect(st.layout.catalog.filter((c) => c.room === "Kitchen")).toHaveLength(5);
    expect(st.areaToPlace(0)).toEqual([]);
    expect(st.undo()).toBe(true);
    expect(st.f.devices).toHaveLength(1);
    expect(st.layout.catalog).toHaveLength(2);
    expect(st.canUndo).toBe(false);
  });

  it("places nothing, and records no step, for a room with no area, an unknown room, no Home Assistant, or nothing left", () => {
    const st = new EditorState(layout());
    expect(st.placeArea(0)).toBe(0); // no HA
    st.ha = ha();
    expect(st.placeArea(1)).toBe(0); // no area
    expect(st.placeArea(9)).toBe(0);
    expect(st.placeArea(-1)).toBe(0);
    expect(st.canUndo).toBe(false);
    expect(st.placeArea(0)).toBe(3);
    expect(st.placeArea(0)).toBe(0); // nothing left: no second step
    expect(st.undo()).toBe(true);
    expect(st.canUndo).toBe(false);
  });

  it("keeps clear of the room's label at its centre and of a device already there", () => {
    const l = layout();
    (l.floors.ground.devices[0] as { x: number; y: number }).x = 240; // the lamp sits one cell right of the centre (200,150)
    (l.floors.ground.devices[0] as { x: number; y: number }).y = 150;
    const st = new EditorState(l);
    st.ha = ha();
    st.placeArea(0);
    for (const d of st.f.devices.slice(1)) {
      if (!("x" in d)) throw new Error("point device expected");
      expect(Math.hypot(d.x - 200, d.y - 150)).toBeGreaterThanOrEqual(40);
      expect(Math.hypot(d.x - 240, d.y - 150)).toBeGreaterThanOrEqual(40);
    }
  });

  it("keeps a large area inside a small room", () => {
    const l = layout();
    l.floors.ground.rooms[0].pts = [[0, 0], [120, 0], [120, 90], [0, 90]];
    const st = new EditorState(l);
    st.ha = { areas: [{ id: "kitchen", name: "Kitchen" }], entities: Array.from({ length: 12 }, (_, k) => ({ id: `sensor.s${k}`, name: `S${k}`, domain: "sensor", area: "kitchen" })) } as unknown as HaData;
    expect(st.placeArea(0)).toBe(12);
    for (const d of st.f.devices.slice(1)) expect("x" in d && inside([d.x, d.y], st.f.rooms[0].pts)).toBe(true);
  });
});

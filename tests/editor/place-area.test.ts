import { describe, it, expect, beforeEach } from "vitest";
import type { Layout } from "../../src/core/schema";
import type { HaData } from "../../src/core";
import { addCandidates, inside, validate } from "../../src/core";
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

  // Opus review of S8.1: `only` is the popup's ticked rows. Ids that are noise, already placed, or unknown place
  // nothing and record no undo step; a mixed set places just the valid ones.
  it("S8.1: placeArea(i, only) places only the ticked, placeable ids and records no step when none apply", () => {
    const st = new EditorState(layout());
    st.ha = ha();
    st.ha.entities.push({ id: "sensor.kitchen_power", name: "Power", domain: "sensor", dc: "power", area: "kitchen" } as HaData["entities"][number]);
    expect(st.placeArea(0, new Set(["sensor.kitchen_power", "light.lamp", "light.nope"]))).toBe(0);
    expect(st.canUndo).toBe(false);
    expect(st.f.devices).toHaveLength(1);
    expect(st.placeArea(0, new Set(["light.ceiling", "sensor.kitchen_power", "binary_sensor.kitchen_motion"]))).toBe(2);
    expect(st.canUndo).toBe(true);
    expect(st.f.devices.map((d) => d.entity).sort()).toEqual(["binary_sensor.kitchen_motion", "light.ceiling", "light.lamp"]);
  });

  // Opus review, S8.9 defect 1: S8.8 offers a catalogued-but-unplaced device (its entity grouped by an HA `dev` id)
  // through the Place popup, but `placeArea` always pushed a fresh catalog entry, duplicating it.
  it("S8.9 defect 1: placing a catalogued-but-unplaced device reuses its catalog entry instead of duplicating it", () => {
    const l = layout();
    l.catalog.push({ id: "bulb-1", floor: "ground", room: "Kitchen", type: "light", name: "Bulb", entity: "light.bulb" });
    const st = new EditorState(l);
    st.ha = ha();
    st.ha.devices = [{ id: "dev-bulb", name: "Bulb" }];
    st.ha.entities.push({ id: "light.bulb", name: "Bulb", domain: "light", area: "kitchen", dev: "dev-bulb" } as HaData["entities"][number]);

    const before = st.layout.catalog.length;
    expect(st.areaToPlace(0).map((e) => e.id)).toContain("light.bulb");
    expect(st.placeArea(0, new Set(["light.bulb"]))).toBe(1);

    expect(st.layout.catalog).toHaveLength(before); // no duplicate entry
    const placed = st.f.devices.find((d) => d.entity === "light.bulb");
    expect(placed?.id).toBe("bulb-1"); // reused the existing catalog entry's own id

    // Remove it from the plan again: Add shows exactly one row for it, not two.
    const idx = st.f.devices.findIndex((d) => d.entity === "light.bulb");
    st.snapshot();
    const f = structuredClone(st.f);
    f.devices.splice(idx, 1);
    st.replaceFloor(f);
    const rows = addCandidates(st.layout, st.ha).filter((c) => c.entity === "light.bulb");
    expect(rows).toHaveLength(1);
  });

  // Opus re-check of S8.9: newId only looked at the current floor's own objects, so a stale catalog entry (a
  // device deleted from the plan but still catalogued) could be handed out again to a different device.
  it("Opus re-check: a device deleted from the plan does not have its id recycled onto a different device", () => {
    const l = layout();
    l.floors.ground.outline = [[0, 0], [800, 0], [800, 400], [0, 400]]; // validate requires an outline; the room fixture leaves it empty
    const st = new EditorState(l);
    st.ha = ha();
    st.ha.devices = [{ id: "dev-bulb", name: "Bulb" }];
    st.ha.entities.push(
      { id: "light.bulb", name: "Bulb", domain: "light", area: "kitchen", dev: "dev-bulb" } as HaData["entities"][number],
      { id: "light.other", name: "Other", domain: "light", area: "kitchen" } as HaData["entities"][number],
    );

    // 1. Place light.bulb from the Place popup.
    expect(st.placeArea(0, new Set(["light.bulb"]))).toBe(1);
    const bulbId = st.f.devices.find((d) => d.entity === "light.bulb")!.id;

    // 2. Delete it from the plan. Its catalog entry stays.
    st.snapshot();
    const f = structuredClone(st.f);
    f.devices = f.devices.filter((d) => d.entity !== "light.bulb");
    st.replaceFloor(f);
    expect(st.layout.catalog.some((c) => c.entity === "light.bulb" && c.id === bulbId)).toBe(true);

    // 3. Place light.other from the Place popup.
    expect(st.placeArea(0, new Set(["light.other"]))).toBe(1);

    // 4. Place the bulb again.
    expect(st.areaToPlace(0).map((e) => e.id)).toContain("light.bulb");
    expect(st.placeArea(0, new Set(["light.bulb"]))).toBe(1);

    const ids = st.f.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length); // no two devices share an id
    const result = validate(st.layout);
    expect(result.ok).toBe(true);
  });

  it("keeps a large area inside a small room", () => {
    const l = layout();
    l.floors.ground.rooms[0].pts = [[0, 0], [120, 0], [120, 90], [0, 90]];
    const st = new EditorState(l);
    // S8.1: a sensor with no class is noise and is not placed, so the fixture uses lights.
    st.ha = { areas: [{ id: "kitchen", name: "Kitchen" }], entities: Array.from({ length: 12 }, (_, k) => ({ id: `light.s${k}`, name: `S${k}`, domain: "light", area: "kitchen" })) } as unknown as HaData;
    expect(st.placeArea(0)).toBe(12);
    for (const d of st.f.devices.slice(1)) expect("x" in d && inside([d.x, d.y], st.f.rooms[0].pts)).toBe(true);
  });
});

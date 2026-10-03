import { describe, it, expect, beforeEach } from "vitest";
import type { Layout } from "../../src/core/schema";
import { validate, type HaData } from "../../src/core";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], walls: [], rooms: [
    { id: "room-ground-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] },
  ], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [], devices: [] } },
  catalog: [],
} as unknown as Layout);

// Rows as hass-pickers.ts builds them: `dev` is the HA device id, `cat` the entity category, `dc` the device class.
const ha = (extra: HaData["entities"] = []): HaData => ({
  areas: [{ id: "kitchen", name: "Kitchen" }],
  entities: [
    { id: "switch.kettle", name: "Kettle", domain: "switch", dc: "outlet", area: "kitchen", dev: "d1" },
    { id: "sensor.kettle_power", name: "Kettle power", domain: "sensor", dc: "power", area: "kitchen", dev: "d1" },
    { id: "sensor.kettle_energy", name: "Kettle energy", domain: "sensor", dc: "energy", area: "kitchen", dev: "d1" },
    { id: "sensor.kettle_signal", name: "Kettle signal", domain: "sensor", dc: "signal_strength", area: "kitchen", dev: "d1", cat: "diagnostic" },
    ...extra,
  ],
} as unknown as HaData);

describe("a plug placed from Home Assistant is linked to its device's one power sensor", () => {
  beforeEach(() => localStorage.clear());
  const kettle = (st: EditorState) => st.f.devices.find((d) => d.entity === "switch.kettle")!;

  it("addEntity writes power into the layout, in the same undo step", () => {
    const st = new EditorState(layout());
    st.ha = ha();
    expect(st.addEntity(st.ha.entities[0], [10, 10])).toBe(true);
    expect(kettle(st)).toMatchObject({ type: "plug", power: "sensor.kettle_power" });
    expect(validate(st.layout).ok).toBe(true);
    st.undo();
    expect(st.f.devices).toHaveLength(0);
  });

  it("placeArea does the same", () => {
    const st = new EditorState(layout());
    st.ha = ha();
    expect(st.placeArea(0)).toBeGreaterThan(0);
    expect(kettle(st)).toMatchObject({ type: "plug", power: "sensor.kettle_power" });
  });

  it("two power sensors on the device, or none, link nothing (a guess would paint a plug by another's draw)", () => {
    const two = new EditorState(layout());
    two.ha = ha([{ id: "sensor.kettle_power_b", name: "B", domain: "sensor", dc: "power", dev: "d1" }]);
    two.addEntity(two.ha.entities[0], [10, 10]);
    expect("power" in kettle(two)).toBe(false);
    const none = new EditorState(layout());
    none.ha = { ...ha(), entities: [ha().entities[0]] };
    none.addEntity(none.ha.entities[0], [10, 10]);
    expect("power" in kettle(none)).toBe(false);
  });

  it("a switch that is not a plug (no outlet class) gets no power field", () => {
    const st = new EditorState(layout());
    st.ha = ha();
    const sw = { ...st.ha.entities[0], dc: undefined };
    st.ha.entities[0] = sw;
    st.addEntity(sw, [10, 10]);
    expect(kettle(st)).toMatchObject({ type: "switch" });
    expect("power" in kettle(st)).toBe(false);
  });
});

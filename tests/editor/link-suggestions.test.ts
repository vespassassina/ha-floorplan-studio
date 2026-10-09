import { describe, it, expect } from "vitest";
import { validate } from "../../src/core";
import type { Layout } from "../../src/core";
import { EditorState } from "../../src/editor/state";
import { applyLinks, linkScopeFor, linkSuggestions } from "../../src/editor/bulk";

// S26.23: the pairs (light, suggested switch) the Link mode previews. The HA shape is that of state.test.ts (autoLinkLights).
const room = (id: string, name: string, area: string, x: number) => ({ id, name, area, kind: "room" as const, pts: [[x, 0], [x + 400, 0], [x + 400, 400], [x, 400]] as [number, number][], wk: ["wall", "wall", "wall", "wall"] as never });
const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: {
    title: "Ground", outline: [[0, 0], [1000, 0], [1000, 400], [0, 400]], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    rooms: [room("r1", "Kitchen", "kitchen", 0), room("r2", "Bedroom", "bedroom", 500)],
    devices: [
      { id: "d0", type: "light", entity: "light.kitchen_lamp", name: "Kitchen lamp", x: 50, y: 50 },
      { id: "d1", type: "light", entity: "light.kitchen_spot", name: "Kitchen spot", x: 100, y: 50 },
      { id: "d2", type: "light", entity: "light.bedroom_lamp", name: "Bedroom lamp", x: 600, y: 50 },
      { id: "d3", type: "light", entity: "light.bedroom_bound", name: "Bedroom bound", x: 650, y: 50, bound: "switch.old" },
      { id: "d4", type: "temp", entity: "sensor.kitchen_temp", name: "Kitchen temp", x: 150, y: 50 },
      { id: "d5", type: "light", entity: "light.kitchen_wrap", name: "Kitchen wrap", x: 200, y: 50 },
    ],
  } },
  catalog: [],
});
const ha = {
  floors: [{ id: "fg", name: "Ground" }], areas: [{ id: "kitchen", name: "Kitchen", floor_id: "fg" }, { id: "bedroom", name: "Bedroom", floor_id: "fg" }],
  entities: [
    { id: "light.kitchen_lamp", name: "Kitchen lamp", domain: "light", area: "kitchen" },
    { id: "light.kitchen_spot", name: "Kitchen spot", domain: "light", area: "kitchen" },
    { id: "light.bedroom_lamp", name: "Bedroom lamp", domain: "light", area: "bedroom" },
    { id: "light.bedroom_bound", name: "Bedroom bound", domain: "light", area: "bedroom" },
    { id: "light.kitchen_wrap", name: "Kitchen wrap", domain: "light", area: "kitchen", platform: "switch_as_x" },
    { id: "switch.kitchen_lamp_sw", name: "Kitchen lamp switch", domain: "switch", area: "kitchen" },
    { id: "switch.kitchen_spot_sw", name: "Kitchen spot switch", domain: "switch", area: "kitchen" },
    { id: "switch.bedroom_lamp_sw", name: "Bedroom lamp switch", domain: "switch", area: "bedroom" },
  ],
};
const make = () => { const st = new EditorState(layout(), "ground"); st.ha = ha; return st; };
const pairs = (st: EditorState, scope: Parameters<typeof linkSuggestions>[1]) => linkSuggestions(st, scope).map((p) => [p.i, p.entity]);

describe("linkSuggestions", () => {
  it("floor scope: every unbound, non-wrapped light with a clear switch; bound, wrapped and non-lights are left out", () => {
    expect(pairs(make(), { t: "floor" })).toEqual([[0, "switch.kitchen_lamp_sw"], [1, "switch.kitchen_spot_sw"], [2, "switch.bedroom_lamp_sw"]]);
  });
  it("room scope: only the lights standing in that room", () => {
    expect(pairs(make(), { t: "room", i: 1 })).toEqual([[2, "switch.bedroom_lamp_sw"]]);
    expect(pairs(make(), { t: "room", i: 0 })).toEqual([[0, "switch.kitchen_lamp_sw"], [1, "switch.kitchen_spot_sw"]]);
  });
  it("devs scope: only the selected ones; junk and non-lights are ignored", () => {
    expect(pairs(make(), { t: "devs", is: [1, 2, 4, 3, 99, -1, 1.5] })).toEqual([[1, "switch.kitchen_spot_sw"], [2, "switch.bedroom_lamp_sw"]]);
  });
  it("each pair names its light and switch, and the room the light stands in", () => {
    const [p] = linkSuggestions(make(), { t: "devs", is: [0] });
    expect(p).toMatchObject({ i: 0, name: "Kitchen lamp", entity: "switch.kitchen_lamp_sw", switchName: "Kitchen lamp switch", room: "Kitchen" });
  });
  it("no Home Assistant data, a room out of range, a bad scope: nothing, never a throw", () => {
    const st = make(); st.ha = undefined;
    expect(linkSuggestions(st, { t: "floor" })).toEqual([]);
    expect(pairs(make(), { t: "room", i: 9 })).toEqual([]);
    expect(pairs(make(), { t: "devs", is: "x" as never })).toEqual([]);
    expect(pairs(make(), null as never)).toEqual([]);
  });
});

describe("linkScopeFor", () => {
  it("a selection of devices, else the selected room, else the floor", () => {
    expect(linkScopeFor({ t: "devs", is: [1, 2] })).toEqual({ t: "devs", is: [1, 2] });
    expect(linkScopeFor({ t: "dev", i: 3 })).toEqual({ t: "devs", is: [3] });
    expect(linkScopeFor({ t: "room", i: 1 })).toEqual({ t: "room", i: 1 });
    expect(linkScopeFor(null)).toEqual({ t: "floor" });
    expect(linkScopeFor({ t: "wall", i: 0 })).toEqual({ t: "floor" });
  });
});

describe("applyLinks", () => {
  it("binds the listed lights in one undo step and the result validates", () => {
    const st = make();
    const links = linkSuggestions(st, { t: "floor" }).filter((p) => p.i !== 1);
    expect(st.edit((f) => applyLinks(f, links))).toBe(true);
    expect(st.f.devices.map((d) => d.bound)).toEqual(["switch.kitchen_lamp_sw", undefined, "switch.bedroom_lamp_sw", "switch.old", undefined, undefined]);
    const v = validate(st.layout); expect(v.ok ? [] : v.errors).toEqual([]);
    expect(st.undo()).toBe(true);
    expect(st.f.devices.filter((d) => d.bound).map((d) => d.entity)).toEqual(["light.bedroom_bound"]); // one step undid both
  });
  it("nothing to link records no step; a light already bound keeps its switch; junk is ignored", () => {
    const st = make();
    expect(st.edit((f) => applyLinks(f, []))).toBe(false);
    expect(st.edit((f) => applyLinks(f, [{ i: 3, entity: "switch.new" }, { i: 99, entity: "switch.x" }, { i: 4, entity: "switch.x" }, { i: 0, entity: "nope" }] as never))).toBe(false);
    expect(st.canUndo).toBe(false);
  });
});

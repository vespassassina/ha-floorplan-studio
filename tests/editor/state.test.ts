import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import v1 from "../../demo/layout.v1.json";
import type { Layout } from "../../src/core/schema";
import { stairsAt } from "../../src/editor/ops";
import { EditorState, STORAGE_KEY, loadLayout, newId, restoreLayout } from "../../src/editor/state";

const fresh = () => structuredClone(demo) as unknown as Layout;

describe("EditorState", () => {
  beforeEach(() => localStorage.clear());

  it("undoes and redoes an edit", () => {
    const st = new EditorState(fresh());
    st.edit((f) => { f.rooms[0].name = "Changed"; });
    expect(st.f.rooms[0].name).toBe("Changed");
    expect(st.undo()).toBe(true);
    expect(st.f.rooms[0].name).toBe("Living");
    expect(st.redo()).toBe(true);
    expect(st.f.rooms[0].name).toBe("Changed");
    expect(new EditorState(fresh()).undo()).toBe(false);
  });

  it("does not record an undo step when an edit changes nothing", () => {
    const st = new EditorState(fresh());
    st.edit((f) => { f.rooms[0].name = "Living"; });
    st.edit(() => {});
    expect(st.canUndo).toBe(false);
    st.edit((f) => { f.rooms[0].name = "Changed"; });
    expect(st.canUndo).toBe(true);
    st.undo();
    expect(st.f.rooms[0].name).toBe("Living");
    expect(st.canUndo).toBe(false);
  });

  it("lists catalog devices that are not on any floor, and lists one again after removal", () => {
    const st = new EditorState(fresh());
    // the demo catalog keeps one contact sensor off the plan, for the door picker.
    // TODO(editor task): unplaced() should use unplacedCatalog (core/bind.ts) so the bound relay leaves the list with its light.
    expect(st.unplaced().map((c) => c.id)).toEqual(["contact-garage", "switch-living-relay"]);
    st.edit((f) => { f.devices.shift(); });
    expect(st.unplaced().map((c) => c.id)).toEqual(["light-living", "contact-garage", "switch-living-relay"]);
  });

  it("offers only contact sensors no other door uses", () => {
    const l = fresh();
    l.catalog.push({ id: "contact-front", floor: "ground", room: "Hall", type: "contact", name: "Front door", entity: "binary_sensor.demo_front_door" });
    const st = new EditorState(l);
    // the front door itself may keep its own sensor; another door may not take it
    expect(st.sensorChoices("door-ground-1").map((c) => c.entity)).toContain("binary_sensor.demo_front_door");
    expect(st.sensorChoices("other-door").map((c) => c.entity)).not.toContain("binary_sensor.demo_front_door");
    // the demo's garage contact is free for any door
    expect(st.sensorChoices("door-ground-3").map((c) => c.entity)).toContain("binary_sensor.demo_garage_door");
  });

  it("autosaves under the documented key and restores it", () => {
    const st = new EditorState(fresh());
    st.edit((f) => { f.rooms[0].name = "Saved"; });
    st.persist();
    expect(localStorage.getItem(STORAGE_KEY)).toContain("Saved");
    expect(restoreLayout()?.floors.ground.rooms[0].name).toBe("Saved");
  });

  it("ignores an autosave that is not a valid layout", () => {
    localStorage.setItem(STORAGE_KEY, '{"version":2}');
    expect(restoreLayout()).toBeNull();
    localStorage.setItem(STORAGE_KEY, "not json");
    expect(restoreLayout()).toBeNull();
  });

  it("gives ids that are free on the floor", () => {
    const l = fresh();
    expect(newId(l.floors.ground, "ground", "furniture")).toBe("furniture-ground-3");
  });
});

describe("loadLayout", () => {
  it("migrates a v1 file", () => {
    const r = loadLayout(v1);
    expect(r.ok).toBe(true);
  });
  it("never throws and lists the errors", () => {
    for (const bad of [null, 5, "x", [], { version: 3 }, { version: 2, floors: {} }]) {
      const r = loadLayout(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("stairs add and remove", () => {
  const add = (st: EditorState) => st.edit((f) => { f.stairs.push({ id: newId(f, st.floor, "stairs"), ...stairsAt([500, 400]) }); });

  it("makes a 100 x 300 cm rectangle on the 5 cm grid, centred", () => {
    const t = stairsAt([503, 397]);
    expect(t.name).toBe("Stairs");
    expect(t.pts).toEqual([[455, 245], [555, 245], [555, 545], [455, 545]]);
  });

  it("adds on a floor with no stairs, and undo removes it", () => {
    const st = new EditorState(fresh(), "first");
    expect(st.f.stairs).toEqual([]);
    expect(add(st)).toBe(true);
    expect(st.f.stairs.map((s) => s.id)).toEqual(["stairs-first-1"]);
    st.undo();
    expect(st.f.stairs).toEqual([]);
  });

  it("removes and undoes to the same index and id", () => {
    const st = new EditorState(fresh());
    add(st); add(st);
    const all = structuredClone(st.f.stairs);
    st.edit((f) => { f.stairs.splice(1, 1); });
    expect(st.f.stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-3"]);
    st.undo();
    expect(st.f.stairs).toEqual(all);
  });

  it("gives distinct ids after a delete and another add", () => {
    const st = new EditorState(fresh());
    add(st);
    st.edit((f) => { f.stairs.splice(0, 1); });
    add(st);
    const ids = st.f.stairs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("removing nothing records no undo step", () => {
    const st = new EditorState(fresh());
    expect(st.edit((f) => { f.stairs.splice(5, 1); })).toBe(false);
    expect(st.canUndo).toBe(false);
  });
});

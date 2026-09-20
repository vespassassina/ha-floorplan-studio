import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import v1 from "../../demo/layout.v1.json";
import type { Layout } from "../../src/core/schema";
import { movePointAll, setSecondEnd, stairsAt } from "../../src/editor/ops";
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
    // the bound relay leaves the list together with its light.
    expect(st.unplaced().map((c) => c.id)).toEqual(["contact-garage"]);
    // removing the light frees its relay too.
    st.edit((f) => { f.devices.shift(); });
    expect(st.unplaced().map((c) => c.id)).toEqual(["light-living", "contact-garage", "switch-living-relay"]);
  });

  it("offers a light only free switches and plugs, plus the one it has", () => {
    const l = fresh();
    l.catalog.push({ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" });
    l.catalog.push({ id: "plug-taken", floor: "ground", room: "Hall", type: "plug", name: "Taken plug", entity: "switch.taken" });
    l.floors.ground.devices[1].bound = "switch.taken"; // kitchen light
    const st = new EditorState(l);
    // switch-hall and plug-living are placed devices, so they are not offered
    expect(st.bindChoices(0).map((c) => c.entity)).toEqual(["switch.demo_living_relay", "switch.free_plug"]);
    // the kitchen light is offered its own switch, not the living light's relay
    expect(st.bindChoices(1).map((c) => c.entity)).toEqual(["switch.free_plug", "switch.taken"]);
    expect(st.bindChoices(2)).toEqual([]); // not a light
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

  it("restores an autosave whose stairs and extras have no name", () => {
    const l: any = structuredClone(demo);
    const g = l.floors.ground;
    g.stairs = [{ id: "s1", pts: [[10, 10], [40, 10], [40, 40]] }];
    g.extras = [{ id: "e1", a: [0, 0], b: [10, 0] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
    expect(restoreLayout()?.floors.ground.stairs[0].name).toBe("");
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

describe("floors", () => {
  const keys = (st: EditorState) => Object.keys(st.layout.floors);
  const empty = { outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [] };

  describe("addFloor", () => {
    it("adds an empty floor last, keyed by the slug of its title, and selects it", () => {
      const st = new EditorState(fresh());
      expect(st.addFloor("Attic")).toBe("attic");
      expect(keys(st)).toEqual(["ground", "first", "attic"]);
      expect(st.floor).toBe("attic");
      expect(st.f).toEqual({ title: "Attic", ...empty });
      expect(st.sel).toBeNull();
    });
    it("is one undo step: undo removes it and the selection falls back to a floor that exists", () => {
      const st = new EditorState(fresh());
      const before = JSON.stringify(st.layout);
      st.addFloor("Attic");
      expect(st.undo()).toBe(true);
      expect(JSON.stringify(st.layout)).toBe(before);
      expect(st.floor).toBe("ground");
      expect(st.undo()).toBe(false);
      expect(st.redo()).toBe(true);
      expect(keys(st)).toEqual(["ground", "first", "attic"]);
    });
    it("break it: a title that slugs to an existing key gets -2, then -3, and the old floor is untouched", () => {
      const st = new EditorState(fresh());
      const ground = JSON.stringify(st.layout.floors.ground);
      expect(st.addFloor("Ground")).toBe("ground-2");
      expect(st.addFloor("  GROUND!  ")).toBe("ground-3");
      expect(st.addFloor("Ground 2")).toBe("ground-2-2"); // slug "ground-2" is taken too
      expect(JSON.stringify(st.layout.floors.ground)).toBe(ground);
      expect(st.layout.floors["ground-2"].title).toBe("Ground");
      expect(keys(st)).toEqual(["ground", "first", "ground-2", "ground-3", "ground-2-2"]);
    });
    it("trims the title and gives a title with no letters or digits the key floor", () => {
      const st = new EditorState(fresh());
      expect(st.addFloor("  Cellar  ")).toBe("cellar");
      expect(st.f.title).toBe("Cellar");
      expect(st.addFloor("???")).toBe("floor");
      expect(st.addFloor("---")).toBe("floor-2");
    });
    it("rejects an empty or whitespace title: returns \"\", changes nothing, records no step", () => {
      const st = new EditorState(fresh());
      for (const t of ["", "   ", "\t\n"]) expect(st.addFloor(t)).toBe("");
      expect(keys(st)).toEqual(["ground", "first"]);
      expect(st.canUndo).toBe(false);
    });
    it("is safe with keys that exist on every object: constructor, toString, __proto__", () => {
      const st = new EditorState(fresh());
      expect(st.addFloor("constructor")).toBe("constructor"); // not a clash: it is not an own key
      expect(st.addFloor("toString")).toBe("tostring");
      expect(Object.hasOwn(st.layout.floors, "constructor")).toBe(true);
      expect(st.f.title).toBe("toString");
      st.setFloor("constructor");
      expect(st.floor).toBe("constructor");
      expect(st.addFloor("__proto__")).toBe("proto");
      expect(Object.getPrototypeOf(st.layout.floors)).not.toBe(st.layout.floors.proto);
    });
    it("keeps the selection state honest: the new floor has no selection or view left from the old one", () => {
      const st = new EditorState(fresh());
      st.sel = { t: "room", i: 0 };
      st.addFloor("Attic");
      expect(st.sel).toBeNull();
      expect(st.view.w).toBeGreaterThan(0);
    });
  });

  describe("renameFloor", () => {
    it("changes the title only: the key, the order and the content stay", () => {
      const st = new EditorState(fresh());
      const rooms = JSON.stringify(st.layout.floors.ground.rooms);
      expect(st.renameFloor("ground", "  Main level ")).toBe(true);
      expect(keys(st)).toEqual(["ground", "first"]);
      expect(st.layout.floors.ground.title).toBe("Main level");
      expect(JSON.stringify(st.layout.floors.ground.rooms)).toBe(rooms);
      expect(st.floor).toBe("ground");
    });
    it("is one undo step, and undo puts the old title back", () => {
      const st = new EditorState(fresh());
      st.renameFloor("first", "Upstairs");
      st.undo();
      expect(st.layout.floors.first.title).toBe("First");
      expect(st.canUndo).toBe(false);
    });
    it("returns false and records no step for an empty title, the same title, or an unknown key", () => {
      const st = new EditorState(fresh());
      expect(st.renameFloor("ground", "")).toBe(false);
      expect(st.renameFloor("ground", "   ")).toBe(false);
      expect(st.renameFloor("ground", "Ground")).toBe(false);
      expect(st.renameFloor("ground", " Ground ")).toBe(false);
      expect(st.renameFloor("nope", "X")).toBe(false);
      expect(st.renameFloor("constructor", "X")).toBe(false);
      expect(st.canUndo).toBe(false);
      expect(st.layout.floors.ground.title).toBe("Ground");
    });
  });

  describe("deleteFloor", () => {
    it("refuses the last floor and an unknown key: false, no step", () => {
      const st = new EditorState(fresh());
      expect(st.deleteFloor("nope")).toBe(false);
      expect(st.deleteFloor("constructor")).toBe(false);
      expect(st.deleteFloor("first")).toBe(true);
      expect(st.canUndo).toBe(true);
      st.undo();
      st.undo(); // nothing left
      const one = new EditorState(fresh());
      one.deleteFloor("first");
      const steps = one.canUndo;
      expect(one.deleteFloor("ground")).toBe(false);
      expect(keys(one)).toEqual(["ground"]);
      expect(steps).toBe(true);
      one.undo();
      expect(one.canUndo).toBe(false); // the refusal added no step
    });
    it("moves the selection to the next floor, or to the previous one when the last is deleted", () => {
      const st = new EditorState(fresh());
      st.addFloor("Attic"); // ground, first, attic; on attic
      st.setFloor("first");
      expect(st.deleteFloor("first")).toBe(true);
      expect(keys(st)).toEqual(["ground", "attic"]);
      expect(st.floor).toBe("attic");
      expect(st.deleteFloor("attic")).toBe(true);
      expect(st.floor).toBe("ground");
      expect(st.sel).toBeNull();
      expect(st.f.title).toBe("Ground");
    });
    it("keeps the current floor when another one is deleted", () => {
      const st = new EditorState(fresh());
      st.addFloor("Attic");
      st.setFloor("ground");
      st.sel = { t: "room", i: 1 };
      st.deleteFloor("attic");
      expect(st.floor).toBe("ground");
    });
    it("undo brings the floor back with its content and its place in the order", () => {
      const st = new EditorState(fresh());
      const before = JSON.stringify(st.layout);
      st.deleteFloor("ground");
      expect(keys(st)).toEqual(["first"]);
      expect(st.floor).toBe("first");
      expect(st.undo()).toBe(true);
      expect(JSON.stringify(st.layout)).toBe(before);
      expect(keys(st)).toEqual(["ground", "first"]);
      expect(st.layout.floors.ground.rooms).toHaveLength(7);
    });
    it("leaves the catalog alone: devices that were on the deleted floor become unplaced and stay listed", () => {
      const st = new EditorState(fresh());
      const catalog = JSON.stringify(st.layout.catalog);
      const onFirst = st.layout.floors.first.devices.map((d) => d.id);
      expect(onFirst.length).toBeGreaterThan(0);
      const listed = st.unplaced().length;
      st.deleteFloor("first");
      expect(JSON.stringify(st.layout.catalog)).toBe(catalog);
      const ids = st.unplaced().map((c) => c.id);
      for (const id of onFirst) expect(ids).toContain(id);
      expect(ids.length).toBeGreaterThan(listed);
      expect(st.layout.catalog.some((c) => c.floor === "first")).toBe(true);
    });
  });

  describe("moveFloor", () => {
    const three = () => { const st = new EditorState(fresh()); st.addFloor("Attic"); return st; };
    it("rebuilds the key order: delta -1 up the list, +1 down, content and titles intact", () => {
      const st = three();
      const g = JSON.stringify(st.layout.floors.ground);
      expect(st.moveFloor("attic", -1)).toBe(true);
      expect(keys(st)).toEqual(["ground", "attic", "first"]);
      expect(st.moveFloor("attic", -1)).toBe(true);
      expect(keys(st)).toEqual(["attic", "ground", "first"]);
      expect(st.moveFloor("ground", 1)).toBe(true);
      expect(keys(st)).toEqual(["attic", "first", "ground"]);
      expect(JSON.stringify(st.layout.floors.ground)).toBe(g);
      expect(st.floor).toBe("attic"); // the selection does not follow a move of another floor
    });
    it("the selected floor stays selected when it is the one that moves", () => {
      const st = three();
      st.moveFloor("attic", -2);
      expect(st.floor).toBe("attic");
      expect(keys(st)).toEqual(["attic", "ground", "first"]);
    });
    it("returns false and records no step at either end, for delta 0, and for an unknown key", () => {
      const st = three();
      expect(st.moveFloor("ground", -1)).toBe(false);
      expect(st.moveFloor("attic", 1)).toBe(false);
      expect(st.moveFloor("first", 0)).toBe(false);
      expect(st.moveFloor("nope", 1)).toBe(false);
      expect(st.moveFloor("ground", -5)).toBe(false);
      st.undo(); // only the addFloor step exists
      expect(st.canUndo).toBe(false);
    });
    it("is one undo step and undo restores the order", () => {
      const st = three();
      st.moveFloor("attic", -1);
      st.undo();
      expect(keys(st)).toEqual(["ground", "first", "attic"]);
    });
    it("a floor named __proto__ survives rename, move, add, delete and undo as an own floor", () => {
      const l = loadLayout(JSON.parse(JSON.stringify(fresh()).replace('"first":{', '"__proto__":{')));
      if (!l.ok) throw new Error(l.errors.join());
      const st = new EditorState(l.layout);
      expect(keys(st)).toEqual(["ground", "__proto__"]);
      expect(st.renameFloor("__proto__", "Roof")).toBe(true);
      expect(st.layout.floors["__proto__"].title).toBe("Roof");
      expect(st.moveFloor("__proto__", -1)).toBe(true);
      expect(keys(st)).toEqual(["__proto__", "ground"]);
      expect(Object.getPrototypeOf(st.layout.floors)).toBeNull();
      st.setFloor("__proto__");
      expect(st.floor).toBe("__proto__");
      expect(st.addFloor("Cellar")).toBe("cellar");
      expect(keys(st)).toEqual(["__proto__", "ground", "cellar"]);
      expect(st.deleteFloor("cellar")).toBe(true);
      expect(st.floor).toBe("ground");
      st.undo(); // delete
      st.undo(); // add
      st.undo(); // move
      expect(keys(st)).toEqual(["ground", "__proto__"]);
      expect(Object.hasOwn(st.layout.floors, "__proto__")).toBe(true);
      expect(st.layout.floors["__proto__"].title).toBe("Roof");
      expect(({} as any).title).toBeUndefined();
    });
  });
});

describe("a zone corner and a room corner at one spot move apart (review S1.5, finding 2)", () => {
  // zone z has its corner on the shared corner (100, 0) of rooms a and b; the corner is (100, 0) in the demo-free floor below
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const mk = (id: string, pts: [number, number][], kind: "room" | "zone") => ({ id, name: id, area: id, label: "", kind, pts, w: pts.map(() => kind === "room") });
  const floor = () => {
    const f = structuredClone(demo.floors.ground) as any;
    f.outline = rect(0, 0, 200, 100);
    f.rooms = [mk("a", rect(0, 0, 100, 100), "room"), mk("b", rect(100, 0, 200, 100), "room"), mk("z", rect(100, 0, 150, 50), "zone")];
    f.stairs = []; f.doors = []; f.walls = []; f.openings = []; f.extras = []; f.devices = []; f.furniture = [];
    return f;
  };
  it("setSecondEnd on a room edge (length, then axis) leaves the zone corner where it is", () => {
    const f = floor();
    for (const how of [{ length: 0.8 }, { axis: "v" as const }]) {
      // edge 0 of room a: (0,0)-(100,0); its second end (100,0) is shared with b and the zone corner
      const g = setSecondEnd(f, [0, 0], [100, 0], how, { poly: "r0", j: 1 });
      expect(g.rooms[0].pts[1]).not.toEqual([100, 0]);
      expect(g.rooms[1].pts[0]).toEqual(g.rooms[0].pts[1]);
      expect(g.rooms[2].pts[0]).toEqual([100, 0]);
    }
  });
  it("setSecondEnd on a zone edge moves the zone corner and no room corner", () => {
    const f = floor();
    const g = setSecondEnd(f, [150, 50], [100, 0], { length: 0.3 }, { poly: "r2", j: 0 });
    expect(g.rooms[2].pts[0]).not.toEqual([100, 0]);
    expect(g.rooms[0].pts[1]).toEqual([100, 0]);
    expect(g.rooms[1].pts[0]).toEqual([100, 0]);
  });
  it("a free wall end on that spot moves the room corners and not the zone corner", () => {
    const f = floor();
    f.walls = [{ id: "w", a: [100, 0], b: [100, -50], kind: "wall" }];
    const g = setSecondEnd(f, [100, -50], [100, 0], { length: 0.3 }, { k: "walls", i: 0, end: "b" });
    expect(g.rooms[2].pts[0]).toEqual([100, 0]);
    expect(g.rooms[0].pts[1]).toEqual(g.walls[0].a);
  });
  it("movePointAll with a zone corner as owner leaves the room corners", () => {
    const g = movePointAll(floor(), [100, 0], [90, 10], false, { poly: "r2", j: 0 });
    expect(g.rooms[2].pts[0]).toEqual([90, 10]);
    expect(g.rooms[0].pts[1]).toEqual([100, 0]);
  });
});

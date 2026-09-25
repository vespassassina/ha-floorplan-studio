import { describe, it, expect, beforeEach, vi } from "vitest";
import demo from "../../demo/layout.json";
import v1 from "../../demo/layout.v1.json";
import type { Layout, WallKind } from "../../src/core/schema";
import { movePointAll, setSecondEnd, stairsAt } from "../../src/editor/ops";
import { contentPoints, rotateAbout } from "../../src/core";
import { EditorState, GRID_KEY, MEASURE_KEY, STORAGE_KEY, THEME_KEY, emptyLayout, isBlank, loadLayout, newId, restoreLayout } from "../../src/editor/state";

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
    // the relay is bound to a light but has no icon, so it is on the list (S1.32).
    expect(st.unplaced().map((c) => c.id)).toEqual(["contact-garage", "switch-living-relay"]);
    st.edit((f) => { f.devices.shift(); });
    expect(st.unplaced().map((c) => c.id)).toEqual(["light-living", "contact-garage", "switch-living-relay"]);
  });

  it("offers a light every switch and plug but its own entity, placed or bound elsewhere (S1.32)", () => {
    const l = fresh();
    l.catalog.push({ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" });
    l.catalog.push({ id: "plug-taken", floor: "ground", room: "Hall", type: "plug", name: "Taken plug", entity: "switch.taken" });
    l.floors.ground.devices[1].bound = "switch.taken"; // kitchen light
    l.floors.ground.devices[1].entity = "switch.demo_hall"; // a light whose own entity is a catalog switch: never offered to itself
    const st = new EditorState(l);
    expect(st.bindChoices(0).map((c) => c.entity)).toEqual(["switch.demo_hall", "switch.demo_tv_plug", "switch.demo_living_relay", "switch.free_plug", "switch.taken"]);
    expect(st.bindChoices(1).map((c) => c.entity)).toEqual(["switch.demo_tv_plug", "switch.demo_living_relay", "switch.free_plug", "switch.taken"]);
    expect(st.bindChoices(2)).toEqual([]); // not a light
  });

  it("offers only contact sensors no other door uses (S4.24: doorAttachChoices)", () => {
    const l = fresh();
    l.catalog.push({ id: "contact-front", floor: "ground", room: "Hall", type: "contact", name: "Front door", entity: "binary_sensor.demo_front_door" });
    const st = new EditorState(l);
    // the front door itself may keep its own sensor; another door may not take it
    expect(st.doorAttachChoices("door-ground-1", "sensors").map((c) => c.entity)).toContain("binary_sensor.demo_front_door");
    expect(st.doorAttachChoices("other-door", "sensors").map((c) => c.entity)).not.toContain("binary_sensor.demo_front_door");
    // the demo's garage contact is free for any door
    expect(st.doorAttachChoices("door-ground-3", "sensors").map((c) => c.entity)).toContain("binary_sensor.demo_garage_door");
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

  it("makes a 100 x 300 cm rectangle on the grid (10 cm by default; it was 5 before S1.34), centred", () => {
    const t = stairsAt([503, 397]);
    expect(t.name).toBe("Stairs");
    expect(t.pts).toEqual([[450, 250], [550, 250], [550, 550], [450, 550]]);
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
  const empty = { outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] };

  describe("addFloor", () => {
    it("adds an empty floor last, keyed by the slug of its title, and selects it", () => {
      const st = new EditorState(fresh());
      expect(st.addFloor("Attic")).toBe("attic");
      expect(keys(st)).toEqual(["ground", "first", "test", "attic"]);
      expect(st.floor).toBe("attic");
      expect(st.f).toEqual({ title: "Attic", ...empty, outline: st.layout.floors.ground.outline, owk: st.layout.floors.ground.owk, stairs: [{ ...st.layout.floors.ground.stairs[0], id: "stairs-attic-1" }] }); // S1.27, owk added Opus review
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
      expect(keys(st)).toEqual(["ground", "first", "test", "attic"]);
    });
    it("break it: a title that slugs to an existing key gets -2, then -3, and the old floor is untouched", () => {
      const st = new EditorState(fresh());
      const ground = JSON.stringify(st.layout.floors.ground);
      expect(st.addFloor("Ground")).toBe("ground-2");
      expect(st.addFloor("  GROUND!  ")).toBe("ground-3");
      expect(st.addFloor("Ground 2")).toBe("ground-2-2"); // slug "ground-2" is taken too
      expect(JSON.stringify(st.layout.floors.ground)).toBe(ground);
      expect(st.layout.floors["ground-2"].title).toBe("Ground");
      expect(keys(st)).toEqual(["ground", "first", "test", "ground-2", "ground-3", "ground-2-2"]);
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
      expect(keys(st)).toEqual(["ground", "first", "test"]);
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
      expect(keys(st)).toEqual(["ground", "first", "test"]);
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
      one.deleteFloor("test");
      const steps = one.canUndo;
      expect(one.deleteFloor("ground")).toBe(false);
      expect(keys(one)).toEqual(["ground"]);
      expect(steps).toBe(true);
      one.undo();
      one.undo();
      expect(one.canUndo).toBe(false); // the refusal added no step
    });
    it("moves the selection to the next floor, or to the previous one when the last is deleted", () => {
      const st = new EditorState(fresh());
      st.addFloor("Attic"); // ground, first, test, attic; on attic
      st.setFloor("first");
      expect(st.deleteFloor("first")).toBe(true);
      expect(keys(st)).toEqual(["ground", "test", "attic"]);
      expect(st.floor).toBe("test");
      st.setFloor("attic");
      expect(st.deleteFloor("attic")).toBe(true);
      expect(st.floor).toBe("test");
      expect(st.sel).toBeNull();
      expect(st.f.title).toBe("Test");
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
      expect(keys(st)).toEqual(["first", "test"]);
      expect(st.floor).toBe("first");
      expect(st.undo()).toBe(true);
      expect(JSON.stringify(st.layout)).toBe(before);
      expect(keys(st)).toEqual(["ground", "first", "test"]);
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
      expect(keys(st)).toEqual(["ground", "first", "attic", "test"]);
      expect(st.moveFloor("attic", -1)).toBe(true);
      expect(keys(st)).toEqual(["ground", "attic", "first", "test"]);
      expect(st.moveFloor("ground", 1)).toBe(true);
      expect(keys(st)).toEqual(["attic", "ground", "first", "test"]);
      expect(JSON.stringify(st.layout.floors.ground)).toBe(g);
      expect(st.floor).toBe("attic"); // the selection does not follow a move of another floor
    });
    it("the selected floor stays selected when it is the one that moves", () => {
      const st = three();
      st.moveFloor("attic", -2);
      expect(st.floor).toBe("attic");
      expect(keys(st)).toEqual(["ground", "attic", "first", "test"]);
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
      expect(keys(st)).toEqual(["ground", "first", "test", "attic"]);
    });
    it("a floor named __proto__ survives rename, move, add, delete and undo as an own floor", () => {
      const l = loadLayout(JSON.parse(JSON.stringify(fresh()).replace('"first":{', '"__proto__":{')));
      if (!l.ok) throw new Error(l.errors.join());
      const st = new EditorState(l.layout);
      expect(keys(st)).toEqual(["ground", "__proto__", "test"]);
      expect(st.renameFloor("__proto__", "Roof")).toBe(true);
      expect(st.layout.floors["__proto__"].title).toBe("Roof");
      expect(st.moveFloor("__proto__", -1)).toBe(true);
      expect(keys(st)).toEqual(["__proto__", "ground", "test"]);
      expect(Object.getPrototypeOf(st.layout.floors)).toBeNull();
      st.setFloor("__proto__");
      expect(st.floor).toBe("__proto__");
      expect(st.addFloor("Cellar")).toBe("cellar");
      expect(keys(st)).toEqual(["__proto__", "ground", "test", "cellar"]);
      expect(st.deleteFloor("cellar")).toBe(true);
      expect(st.floor).toBe("test");
      st.undo(); // delete
      st.undo(); // add
      st.undo(); // move
      expect(keys(st)).toEqual(["ground", "__proto__", "test"]);
      expect(Object.hasOwn(st.layout.floors, "__proto__")).toBe(true);
      expect(st.layout.floors["__proto__"].title).toBe("Roof");
      expect(({} as any).title).toBeUndefined();
    });
  });
});

describe("a zone corner and a room corner at one spot move apart (review S1.5, finding 2)", () => {
  // zone z has its corner on the shared corner (100, 0) of rooms a and b; the corner is (100, 0) in the demo-free floor below
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const mk = (id: string, pts: [number, number][], kind: "room" | "zone") => ({ id, name: id, area: id, label: "", kind, pts, wk: pts.map((): WallKind => (kind === "room" ? "wall" : "boundary")) });
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

describe("addStairsEverywhere (S1.26)", () => {
  const three = () => {
    const l = fresh();
    l.floors.attic = structuredClone(l.floors.first);
    l.floors.attic.title = "Attic";
    return l;
  };
  const t = () => ({ name: "Stairs", pts: [[10, 20], [110, 20], [110, 320], [10, 320]] as [number, number][], shape: "straight" as const, steps: 12, rot: 0 });

  it("puts one copy on every floor, same pts, ids of their own, in one undo step", () => {
    const st = new EditorState(three());
    const before = Object.values(st.layout.floors).map((f) => f.stairs.length);
    st.addStairsEverywhere(t());
    const floors = Object.entries(st.layout.floors);
    expect(floors).toHaveLength(4);
    floors.forEach(([k, f], i) => {
      expect(f.stairs).toHaveLength(before[i] + 1);
      const added = f.stairs[f.stairs.length - 1];
      expect(added.pts).toEqual(t().pts);
      expect(added.id).toBe(`stairs-${k}-${before[i] + 1}`);
    });
    // deep copies: moving one floor's corner moves no other floor's
    st.layout.floors.ground.stairs[st.layout.floors.ground.stairs.length - 1].pts[0][0] = 999;
    expect(st.layout.floors.first.stairs[0].pts[0][0]).toBe(10);
    st.layout.floors.ground.stairs[st.layout.floors.ground.stairs.length - 1].pts[0][0] = 10;
    expect(st.undo()).toBe(true);
    expect(Object.values(st.layout.floors).map((f) => f.stairs.length)).toEqual(before);
    expect(st.canUndo).toBe(false);
  });

  it("selects the new stairs on the current floor", () => {
    const st = new EditorState(three(), "first");
    st.addStairsEverywhere(t());
    expect(st.sel).toEqual({ t: "stairs", i: 0 });
    const g = new EditorState(three(), "ground");
    g.addStairsEverywhere(t());
    expect(g.sel).toEqual({ t: "stairs", i: 1 });
  });

  it("break it: a floor that already has stairs gets the new ones too", () => {
    const st = new EditorState(three());
    expect(st.layout.floors.ground.stairs).toHaveLength(1);
    st.addStairsEverywhere(t());
    expect(st.layout.floors.ground.stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-2"]);
  });

  it("keeps a round stair's diameters, and redo puts them back", () => {
    const st = new EditorState(three());
    st.addStairsEverywhere({ name: "Stairs", pts: t().pts, shape: "round", steps: 9, rot: 30, dia: 200, inner: 60 });
    for (const f of Object.values(st.layout.floors)) expect(f.stairs[f.stairs.length - 1]).toMatchObject({ shape: "round", steps: 9, rot: 30, dia: 200, inner: 60 });
    st.undo(); st.redo();
    expect(st.layout.floors.first.stairs).toHaveLength(1);
  });
});

describe("addFloor inherits the outline and the stairs of the first floor (S1.27)", () => {
  const sq = (n: number): [number, number][] => [[0, 0], [n, 0], [n, n], [0, n]];
  const stair = (id: string, dia?: number) => ({ id, name: "Stairs", pts: sq(50), shape: "straight" as const, steps: 12, rot: 0, ...(dia ? { shape: "round" as const, dia, inner: 20 } : {}) });
  const layout = () => {
    const l = structuredClone(demo) as unknown as Layout;
    const g = l.floors.ground;
    g.outline = sq(400); g.stairs = [stair("stairs-ground-1"), stair("stairs-ground-2", 120)];
    l.floors.first.outline = sq(999); l.floors.first.stairs = [];
    return l;
  };

  it("copies the outline and the stairs, with new ids, and leaves every other array empty", () => {
    const st = new EditorState(layout());
    st.addFloor("Attic");
    const f = st.f;
    expect(f.outline).toEqual(sq(400));
    expect(f.stairs.map((s) => s.id)).toEqual(["stairs-attic-1", "stairs-attic-2"]);
    expect(f.stairs[1]).toMatchObject({ shape: "round", dia: 120, inner: 20 });
    for (const k of ["rooms", "walls", "doors", "openings", "extras", "devices", "furniture"] as const) expect(f[k], k).toEqual([]);
  });
  it("copies from the first floor in the key order, not from the floor before it", () => {
    const st = new EditorState(layout());
    st.addFloor("Attic");
    st.addFloor("Roof");
    expect(st.layout.floors.roof.outline).toEqual(sq(400)); // ground's, not first's 999 and not the attic's
    expect(st.layout.floors.roof.stairs).toHaveLength(2);
  });
  it("copies deeply: editing the attic leaves the ground floor alone", () => {
    const st = new EditorState(layout());
    st.addFloor("Attic");
    st.f.outline[0][0] = 77; st.f.stairs[0].pts[0][0] = 77;
    expect(st.layout.floors.ground.outline[0][0]).toBe(0);
    expect(st.layout.floors.ground.stairs[0].pts[0][0]).toBe(0);
  });
  it("is one undo step", () => {
    const st = new EditorState(layout());
    const before = JSON.stringify(st.layout);
    st.addFloor("Attic");
    st.undo();
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.canUndo).toBe(false);
  });
  it("break it: an empty first floor gives an empty floor and nothing throws", () => {
    const l = layout();
    l.floors = { only: { ...structuredClone(l.floors.ground), outline: [], stairs: [], rooms: [] } };
    const st = new EditorState(l);
    expect(() => st.addFloor("Attic")).not.toThrow();
    expect(st.f.outline).toEqual([]);
    expect(st.f.stairs).toEqual([]);
  });

  describe("plan rotation (S1.33)", () => {
    it("setRotate steps in 45s, wraps, takes one undo step each and none when nothing changes", () => {
      const st = new EditorState(fresh());
      expect(st.setRotate(0)).toBe(false);
      expect(st.canUndo).toBe(false);
      expect(st.setRotate(45)).toBe(true);
      expect(st.setRotate(-45 + 0)).toBe(true); // to 315
      expect(st.layout.rotate).toBe(315);
      expect(st.setRotate(360 + 315)).toBe(false); // the same angle
      st.undo();
      expect(st.layout.rotate).toBe(45);
      st.undo();
      expect(st.layout.rotate).toBe(0);
      expect(st.canUndo).toBe(false);
    });

    it("rotating right and back leaves every coordinate byte-identical and rotate at 0", () => {
      const st = new EditorState(fresh()), before = JSON.stringify(st.layout);
      st.setRotate(90); st.setRotate(0);
      expect(st.layout.rotate).toBe(0);
      expect(JSON.stringify(st.layout).replace(/"rotate":0,?/, "")).toBe(before.replace(/"rotate":0,?/, ""));
      expect(st.rotation).toBeUndefined();
    });

    it("fit at 90 gives a view of the turned outline, kept in plan coordinates: its centre is the outline's centre", () => {
      const st = new EditorState(fresh());
      st.fit();
      const flat = st.view;
      st.setRotate(90);
      const v = st.view; // dropped and fitted again
      expect(v.w).toBeCloseTo(flat.h); expect(v.h).toBeCloseTo(flat.w);
      expect(v.x + v.w / 2).toBeCloseTo(flat.x + flat.w / 2); expect(v.y + v.h / 2).toBeCloseTo(flat.y + flat.h / 2); // turned about the outline's own centre
      expect(st.rotation).toEqual({ deg: 90, pivot: [400, 300] });
    });
  });
});

describe("the grid setting (S1.34)", () => {
  beforeEach(() => localStorage.clear());
  it("is 10 cm by default and not part of the layout", () => {
    const st = new EditorState(fresh());
    expect(st.snapGrid).toBe(10);
    st.setGrid(50);
    expect(JSON.stringify(st.layout)).not.toContain("grid");
  });
  it.each([0, 5, 10, 50] as const)("keeps %i under its own key and the next state reads it", (g) => {
    new EditorState(fresh()).setGrid(g);
    expect(localStorage.getItem(GRID_KEY)).toBe(String(g));
    expect(new EditorState(fresh()).snapGrid).toBe(g);
  });
  it.each(["7", "x", "", "-5", "10.5", "null"])("a stored %j falls back to 10", (v) => {
    localStorage.setItem(GRID_KEY, v);
    expect(new EditorState(fresh()).snapGrid).toBe(10);
  });
  it("setGrid refuses a value that is not one of the four", () => {
    const st = new EditorState(fresh());
    st.setGrid(7 as never);
    expect(st.snapGrid).toBe(10);
  });
  it("still works when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const st = new EditorState(fresh());
    expect(st.snapGrid).toBe(10);
    st.setGrid(50);
    expect(st.snapGrid).toBe(50);
    get.mockRestore(); set.mockRestore();
  });
});

describe("the measure grid preference (S1.50)", () => {
  beforeEach(() => localStorage.clear());
  it("is true by default and not part of the layout", () => {
    const st = new EditorState(fresh());
    expect(st.measure).toBe(true);
    st.setMeasure(false);
    expect(JSON.stringify(st.layout)).not.toContain("measure");
  });
  it("keeps the choice under its own key and the next state reads it", () => {
    new EditorState(fresh()).setMeasure(false);
    expect(localStorage.getItem(MEASURE_KEY)).toBe("false");
    expect(new EditorState(fresh()).measure).toBe(false);
    new EditorState(fresh()).setMeasure(true);
    expect(localStorage.getItem(MEASURE_KEY)).toBe("true");
    expect(new EditorState(fresh()).measure).toBe(true);
  });
  it.each(["", "x", "null", "0", "undefined"])("a stored %j falls back to true", (v) => {
    localStorage.setItem(MEASURE_KEY, v);
    expect(new EditorState(fresh()).measure).toBe(true);
  });
  it("a missing value gives true", () => {
    expect(new EditorState(fresh()).measure).toBe(true);
  });
  it("toggling it is not an undo step", () => {
    const st = new EditorState(fresh());
    st.setMeasure(false);
    expect(st.canUndo).toBe(false);
  });
  it("still works when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const st = new EditorState(fresh());
    expect(st.measure).toBe(true);
    st.setMeasure(false);
    expect(st.measure).toBe(false); // the in-memory choice still changes; only the write is lost
    get.mockRestore(); set.mockRestore();
  });
});

describe("the theme choice (S2.12)", () => {
  beforeEach(() => localStorage.clear());
  it("is blueprint by default and not part of the layout", () => {
    const st = new EditorState(fresh());
    expect(st.theme).toBe("blueprint");
    st.setTheme("light");
    expect(JSON.stringify(st.layout)).not.toContain("theme");
  });
  it.each(["blueprint", "light", "ha"] as const)("keeps %s under its own key and the next state reads it", (t) => {
    new EditorState(fresh()).setTheme(t);
    expect(localStorage.getItem(THEME_KEY)).toBe(t);
    expect(new EditorState(fresh()).theme).toBe(t);
  });
  it.each(["", "x", "null", "Dark", "system", "auto", "dark"])("a stored %j (unknown, or a retired choice) falls back to blueprint", (v) => {
    localStorage.setItem(THEME_KEY, v);
    expect(new EditorState(fresh()).theme).toBe("blueprint");
  });
  it("setTheme refuses a value that is not one of the three", () => {
    const st = new EditorState(fresh());
    st.setTheme("Light" as never);
    expect(st.theme).toBe("blueprint");
  });
  it("toggling it is not an undo step", () => {
    const st = new EditorState(fresh());
    st.setTheme("light");
    expect(st.canUndo).toBe(false);
  });
  it("a blocked storage falls back to blueprint: the in-memory choice still changes, only the write is lost", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const st = new EditorState(fresh());
    expect(st.theme).toBe("blueprint");
    st.setTheme("light");
    expect(st.theme).toBe("light");
    get.mockRestore(); set.mockRestore();
  });

});

describe("device colours (S1.36)", () => {
  beforeEach(() => localStorage.clear());
  it("setColour writes layout.colors, one undo step; the same colour again is no step", () => {
    const st = new EditorState(fresh());
    expect(st.layout.colors).toBeUndefined();
    expect(st.setColour("light", "#aabbcc")).toBe(true);
    expect(st.layout.colors).toEqual({ light: "#aabbcc" });
    expect(st.setColour("light", "#aabbcc")).toBe(false);
    expect(st.undo()).toBe(true);
    expect(st.layout.colors).toBeUndefined(); // not {}: an untouched layout stays as it was
    expect(st.canUndo).toBe(false);
  });
  it("a reset removes the key, and the last one removes colors", () => {
    const st = new EditorState(fresh());
    st.setColour("light", "#aabbcc"); st.setColour("tv", "#112233");
    expect(st.setColour("light", null)).toBe(true);
    expect(st.layout.colors).toEqual({ tv: "#112233" });
    expect(st.setColour("light", null)).toBe(false); // nothing to reset
    expect(st.resetColours()).toBe(true);
    expect(st.layout.colors).toBeUndefined();
    expect(st.resetColours()).toBe(false);
  });
  it("refuses a colour that is not #rrggbb or a type that is not a device type", () => {
    const st = new EditorState(fresh());
    expect(st.setColour("light", "red")).toBe(false);
    expect(st.setColour("fridge" as never, "#aabbcc")).toBe(false);
    expect(st.layout.colors).toBeUndefined();
  });
});

describe("recenter (S1.49)", () => {
  const boxOf = (st: EditorState) => st.view;
  const contains = (v: { x: number; y: number; w: number; h: number }, p: [number, number]) => p[0] >= v.x && p[0] <= v.x + v.w && p[1] >= v.y && p[1] <= v.y + v.h;
  it("shows every point of the floor, also one outside the outline, and after a zoom and a pan", () => {
    const l = fresh();
    l.floors.ground.devices.push({ id: "far", type: "temp", entity: "sensor.far", x: 1700, y: -400 } as any);
    const st = new EditorState(l);
    st.views[st.floor] = { x: 10, y: 10, w: 50, h: 40 }; // zoomed in, off to a corner
    st.recenter();
    const v = boxOf(st);
    expect(contains(v, [1700, -400])).toBe(true);
    for (const p of contentPoints(st.f)) expect(contains(v, p), String(p)).toBe(true);
  });
  it("writes nothing to the layout and is no undo step", () => {
    const st = new EditorState(fresh()), before = JSON.stringify(st.layout);
    st.recenter();
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.canUndo).toBe(false);
  });
  it("with the plan turned 45 degrees the turned points fit", () => {
    const st = new EditorState(fresh());
    st.setRotate(45);
    st.views[st.floor] = { x: 0, y: 0, w: 20, h: 20 };
    st.recenter();
    const r = st.rotation!, v = st.view;
    // in the turned frame: the view's centre is the plan point in the screen middle, so turn each point to screen space about the pivot
    const c = rotateAbout([v.x + v.w / 2, v.y + v.h / 2], 45, r.pivot);
    for (const p of contentPoints(st.f)) {
      const q = rotateAbout(p, 45, r.pivot);
      expect(Math.abs(q[0] - c[0])).toBeLessThanOrEqual(v.w / 2 + 0.5);
      expect(Math.abs(q[1] - c[1])).toBeLessThanOrEqual(v.h / 2 + 0.5);
    }
  });
  it("an empty floor does not throw and gets a sensible box", () => {
    const l = fresh();
    Object.assign(l.floors.ground, { outline: [], rooms: [], walls: [], doors: [], openings: [], extras: [], stairs: [], furniture: [], devices: [], unlinked: [] });
    const st = new EditorState(l);
    expect(() => st.recenter()).not.toThrow();
    expect(st.view.w).toBeGreaterThan(0); expect(st.view.h).toBeGreaterThan(0);
  });
});

// Load demo may only run when there is nothing to overwrite; isBlank is that question.
describe("isBlank", () => {
  const demoLayout = fresh();
  it("an empty layout is blank, and so is one with an extra empty floor or a catalog", () => {
    const l = emptyLayout();
    expect(isBlank(l)).toBe(true);
    l.floors.first = { ...emptyLayout().floors.ground, title: "First" };
    l.catalog = [{ id: "x", type: "light", entity: "light.x", name: "X" } as never];
    expect(isBlank(l)).toBe(true);
  });
  it("the demo is not blank", () => expect(isBlank(demoLayout)).toBe(false));
  it.each(["outline", "rooms", "walls", "stairs", "doors", "openings", "extras", "devices", "furniture"] as const)("one %s is enough to not be blank", (k) => {
    const l = emptyLayout();
    (l.floors.ground[k] as unknown[]).push(k === "outline" ? [0, 0] : {});
    expect(isBlank(l)).toBe(false);
  });
});

describe("EditorState.setTrace (S7.11)", () => {
  beforeEach(() => localStorage.clear());
  const SRC = "data:image/png;base64,iVBORw0KGgo=";
  const T = { src: SRC, x: 5, y: 6, w: 300, rot: 0, alpha: 0.5, on: true };

  it("sets, changes and removes the current floor's trace, one undo step each, none when unchanged", () => {
    const st = new EditorState(fresh());
    expect(st.setTrace(T)).toBe(true);
    expect(st.f.trace).toEqual(T);
    expect(st.setTrace({ ...T })).toBe(false); // same value: no step
    expect(st.setTrace({ ...T, alpha: 0.3 })).toBe(true);
    expect(st.setTrace(null)).toBe(true);
    expect(st.f.trace).toBeUndefined();
    expect(st.setTrace(null)).toBe(false);
    st.undo(); expect(st.f.trace?.alpha).toBe(0.3);
    st.undo(); expect(st.f.trace?.alpha).toBe(0.5);
    st.undo(); expect(st.f.trace).toBeUndefined();
    expect(st.canUndo).toBe(false);
    st.redo(); st.redo(); expect(st.f.trace).toEqual({ ...T, alpha: 0.3 });
    expect(st.layout.floors.first.trace).toBeUndefined(); // only the current floor
  });

  it("keeps the image out of each undo step: the history holds it once, not once per step", () => {
    const st = new EditorState(fresh());
    const big = "data:image/jpeg;base64," + "A".repeat(200_000);
    st.setTrace({ ...T, src: big });
    for (let i = 0; i < 20; i++) st.edit((f) => { f.rooms[0].name = `n${i}`; });
    const hist = (st as unknown as { hist: string[] }).hist;
    expect(hist.length).toBe(21);
    expect(hist.reduce((n, s) => n + s.length, 0)).toBeLessThan(big.length);
    for (let i = 0; i < 20; i++) st.undo();
    expect(st.f.trace?.src).toBe(big);
    st.redo();
    expect(st.f.trace?.src).toBe(big);
  });

  it("autosaves the plan without its image when the image does not fit in localStorage", () => {
    const st = new EditorState(fresh());
    st.setTrace(T);
    st.edit((f) => { f.rooms[0].name = "Kept"; });
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes(SRC)) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(st.persist()).toBe(false);
    spy.mockRestore();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.floors.ground.rooms[0].name).toBe("Kept");
    expect(saved.floors.ground.trace).toBeUndefined();
    expect(st.f.trace).toEqual(T); // the live plan keeps it
    expect(st.persist()).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).floors.ground.trace).toEqual(T);
  });
});

describe("EditorState.autoLinkLights (S8.7)", () => {
  /** One floor, one room in area_basement, an unbound light with a uniquely-named same-area switch and an unrelated switch on another floor. */
  const layoutWithTwoLights = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      basement: {
        title: "Basement", outline: [], rooms: [{ id: "r1", name: "Basement", area: "area_basement", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }],
        walls: [], stairs: [], doors: [], openings: [], extras: [],
        devices: [
          { id: "d1", type: "light", entity: "light.basement_dumb", name: "Basement dumb light", x: 10, y: 10 },
          { id: "d2", type: "light", entity: "light.basement_lamp", name: "Basement lamp", x: 20, y: 20 },
        ],
        furniture: [], unlinked: [],
      },
      attic: { title: "Attic", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] },
    },
    catalog: [],
  });
  const ha = {
    floors: [{ id: "floor_basement", name: "Basement" }],
    areas: [{ id: "area_basement", name: "Basement", floor_id: "floor_basement" }],
    entities: [
      { id: "light.basement_dumb", name: "Basement dumb light", domain: "light", area: "area_basement" },
      { id: "light.basement_lamp", name: "Basement lamp", domain: "light", area: "area_basement" },
      { id: "switch.basement_light_switch", name: "Basement light switch", domain: "switch", area: "area_basement" },
      { id: "switch.basement_lamp_switch", name: "Basement lamp switch", domain: "switch", area: "area_basement" },
      { id: "switch.attic_switch", name: "Attic switch", domain: "switch", area: "area_attic" }, // different floor: never a candidate
    ],
  };

  it("links every unbound light on the floor to its suggested switch, in one undo step covering both", () => {
    const st = new EditorState(layoutWithTwoLights(), "basement");
    st.ha = ha;
    expect(st.autoLinkLights("basement")).toBe(2);
    expect(st.f.devices[0].bound).toBe("switch.basement_light_switch");
    expect(st.f.devices[1].bound).toBe("switch.basement_lamp_switch");
    expect(st.undo()).toBe(true);
    expect(st.f.devices[0].bound).toBeUndefined();
    expect(st.f.devices[1].bound).toBeUndefined(); // one step reverted both
  });

  it("never touches a light that already has bound, returns 0 and takes no step when nothing changes", () => {
    const l = layoutWithTwoLights();
    l.floors.basement.devices[0].bound = "switch.already";
    l.floors.basement.devices[1].bound = "switch.already2";
    const st = new EditorState(l, "basement");
    st.ha = ha;
    expect(st.autoLinkLights("basement")).toBe(0);
    expect(st.canUndo).toBe(false);
  });

  it("switchChoicesForLight wraps the current floor and ha into the core function", () => {
    const st = new EditorState(layoutWithTwoLights(), "basement");
    st.ha = ha;
    const choices = st.switchChoicesForLight(0);
    expect(choices.map((c) => c.entity)).not.toContain("switch.attic_switch");
    expect(choices.find((c) => c.suggested)?.entity).toBe("switch.basement_light_switch");
  });

  it("Opus review finding 6: skips a light whose platform is switch_as_x — it is a wrapped switch, not a light to link", () => {
    const l = layoutWithTwoLights();
    const st = new EditorState(l, "basement");
    st.ha = {
      ...ha,
      entities: ha.entities.map((e) => (e.id === "light.basement_dumb" ? { ...e, platform: "switch_as_x" } : e)),
    };
    expect(st.autoLinkLights("basement")).toBe(1); // only the lamp links; the switch_as_x light is left alone
    expect(st.f.devices[0].bound).toBeUndefined();
    expect(st.f.devices[1].bound).toBe("switch.basement_lamp_switch");
  });

  it("Opus review: a living room with Ceiling light and TV plug auto-links nothing (finding 4, via autoLinkLights)", () => {
    const l: Layout = {
      version: 2, unit: "cm", north: 0,
      floors: { ground: { title: "Ground", outline: [], rooms: [{ id: "r1", name: "Living room", area: "area_living", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [{ id: "d1", type: "light", entity: "light.ceiling", name: "Ceiling light", x: 10, y: 10 }], furniture: [], unlinked: [] } },
      catalog: [],
    };
    const st = new EditorState(l, "ground");
    st.ha = {
      floors: [{ id: "floor_ground", name: "Ground" }],
      areas: [{ id: "area_living", name: "Living room", floor_id: "floor_ground" }],
      entities: [
        { id: "light.ceiling", name: "Ceiling light", domain: "light", area: "area_living" },
        { id: "switch.tv_plug", name: "TV plug", domain: "switch", area: "area_living" },
      ],
    };
    expect(st.autoLinkLights("ground")).toBe(0);
    expect(st.canUndo).toBe(false);
    expect(st.f.devices[0].bound).toBeUndefined();
  });
});

describe("EditorState.motionChoices (Opus review finding 12: scoped by HA floor like the switches, drawn rooms as fallback)", () => {
  /** One plan floor ("ground") with a room drawn only in area_kitchen. area_pantry is on the same HA floor as
   *  area_kitchen but has no room drawn on this plan floor at all. */
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      ground: {
        title: "Ground", outline: [], rooms: [{ id: "r1", name: "Kitchen", area: "area_kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }],
        walls: [], stairs: [], doors: [], openings: [], extras: [],
        devices: [{ id: "d1", type: "light", entity: "light.kitchen", name: "Kitchen light", x: 10, y: 10 }],
        furniture: [], unlinked: [],
      },
    },
    catalog: [],
  });
  const haWithFloorMapping = {
    floors: [{ id: "floor_ground", name: "Ground" }, { id: "floor_upstairs", name: "Upstairs" }],
    areas: [
      { id: "area_kitchen", name: "Kitchen", floor_id: "floor_ground" },
      { id: "area_pantry", name: "Pantry", floor_id: "floor_ground" }, // same HA floor, no room drawn for it
      { id: "area_bedroom", name: "Bedroom", floor_id: "floor_upstairs" },
    ],
    entities: [
      { id: "light.kitchen", name: "Kitchen light", domain: "light", area: "area_kitchen" },
      { id: "binary_sensor.kitchen_motion", name: "Kitchen motion", domain: "binary_sensor", dc: "motion", area: "area_kitchen" },
      { id: "binary_sensor.pantry_motion", name: "Pantry motion", domain: "binary_sensor", dc: "motion", area: "area_pantry" },
      { id: "binary_sensor.bedroom_motion", name: "Bedroom motion", domain: "binary_sensor", dc: "motion", area: "area_bedroom" },
    ],
  };

  it("counts an area on the mapped HA floor even with no room drawn for it (Pantry), excludes another HA floor (Bedroom)", () => {
    const st = new EditorState(layout(), "ground");
    st.ha = haWithFloorMapping;
    const names = st.motionChoices(0).map((c) => c.name);
    expect(names).toContain("Kitchen motion");
    expect(names).toContain("Pantry motion"); // same HA floor, no drawn room: still counts
    expect(names).not.toContain("Bedroom motion"); // a different HA floor
  });

  it("falls back to the drawn-room areas when the plan floor has no HA floor mapping at all", () => {
    const st = new EditorState(layout(), "ground");
    st.ha = {
      floors: [],
      areas: [{ id: "area_kitchen", name: "Kitchen" }, { id: "area_pantry", name: "Pantry" }], // no floor_id anywhere
      entities: [
        { id: "light.kitchen", name: "Kitchen light", domain: "light", area: "area_kitchen" },
        { id: "binary_sensor.kitchen_motion", name: "Kitchen motion", domain: "binary_sensor", dc: "motion", area: "area_kitchen" },
        { id: "binary_sensor.pantry_motion", name: "Pantry motion", domain: "binary_sensor", dc: "motion", area: "area_pantry" },
      ],
    };
    const names = st.motionChoices(0).map((c) => c.name);
    expect(names).toContain("Kitchen motion"); // its area has a drawn room on this floor
    expect(names).not.toContain("Pantry motion"); // no HA floor mapping and no drawn room either
  });

  it("a group entity counts when at least one member sensor is on this HA floor", () => {
    const st = new EditorState(layout(), "ground");
    st.ha = {
      ...haWithFloorMapping,
      entities: [
        ...haWithFloorMapping.entities,
        { id: "group.motion_kitchen_bedroom", name: "Kitchen + bedroom motion", domain: "group", members: ["binary_sensor.kitchen_motion", "binary_sensor.bedroom_motion"] },
        { id: "group.motion_bedroom_only", name: "Bedroom-only group", domain: "group", members: ["binary_sensor.bedroom_motion"] },
      ],
    };
    const names = st.motionChoices(0).map((c) => c.name);
    expect(names).toContain("Kitchen + bedroom motion"); // one member (kitchen) is on this HA floor
    expect(names).not.toContain("Bedroom-only group"); // no member is on this HA floor
  });
});

describe("EditorState.pendingMotion (Opus review finding 3: tied to the device id, cleared on selection change)", () => {
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      ground: {
        title: "Ground", outline: [], rooms: [],
        walls: [], stairs: [], doors: [], openings: [], extras: [],
        devices: [
          { id: "dA", type: "light", entity: "light.a", name: "Light A", x: 10, y: 10 },
          { id: "dB", type: "light", entity: "light.b", name: "Light B", x: 20, y: 20 },
        ],
        furniture: [], unlinked: [],
      },
    },
    catalog: [],
  });

  it("reads back empty once a different device is selected", () => {
    const st = new EditorState(layout(), "ground");
    st.sel = { t: "dev", i: 0 }; // light A
    st.pendingMotion = "binary_sensor.motion";
    expect(st.pendingMotion).toBe("binary_sensor.motion");
    st.sel = { t: "dev", i: 1 }; // light B
    expect(st.pendingMotion).toBe(""); // did not leak onto light B
    st.sel = { t: "dev", i: 0 }; // back to light A
    expect(st.pendingMotion).toBe(""); // selecting away cleared it, not just hid it
  });

  it("reads back empty once the selection is cleared entirely", () => {
    const st = new EditorState(layout(), "ground");
    st.sel = { t: "dev", i: 0 };
    st.pendingMotion = "binary_sensor.motion";
    st.sel = null;
    expect(st.pendingMotion).toBe("");
  });
});

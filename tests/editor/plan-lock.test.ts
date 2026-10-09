import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Floor } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { validate, TEXTURE_IDS } from "../../src/core";

// "Fix plan" (2026-10-06): while it is on, nothing of the plan changes, but devices (lights and the rest) still do.
const fresh = () => structuredClone(demo) as unknown as Layout;
const locked = () => { const st = new EditorState(fresh()); st.planLocked = true; return st; };

describe("EditorState: plan lock", () => {
  beforeEach(() => localStorage.clear());

  it("is off by default and does not touch the layout", () => {
    const st = new EditorState(fresh());
    expect(st.planLocked).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(JSON.stringify(fresh()));
  });

  it("refuses an edit to a room, wall, door, stair or furniture, and leaves no undo step", () => {
    const st = locked(), before = JSON.stringify(st.layout);
    expect(st.edit((f) => { f.rooms[0].pts[0] = [1, 1]; })).toBe(false);
    expect(st.edit((f) => { f.doors[0].a = [1, 1]; })).toBe(false);
    expect(st.edit((f) => { f.walls.push({ id: "w9", a: [0, 0], b: [50, 0], kind: "wall" }); })).toBe(false);
    expect(st.edit((f) => { f.rooms = []; })).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.canUndo).toBe(false);
    expect(st.planBlocked).toBe(true);
  });

  it("takes objects (heater, TV) like devices: add, move, remove; furniture stays locked", () => {
    const st = locked();
    expect(st.edit((f) => { f.unlinked.push({ id: "u9", type: "heater", x: 10, y: 10, rot: 0, scale: 1 } as never); })).toBe(true);
    const n = st.f.unlinked.length - 1;
    expect(st.edit((f) => { f.unlinked[n].x = 99; })).toBe(true);
    expect(st.edit((f) => { f.unlinked.splice(n, 1); })).toBe(true);
    expect(st.edit((f) => { f.furniture.push({ id: "m9", symbol: "tree", x: 1, y: 1, rot: 0, w: 50, h: 50 } as never); })).toBe(false);
    expect(st.planBlocked).toBe(true);
  });

  it("still takes an edit that touches devices only: move, rename, add, remove", () => {
    const st = locked(), n = st.f.devices.length;
    expect(st.edit((f) => { (f.devices[0] as any).x += 17; })).toBe(true);
    expect(st.edit((f) => { f.devices[0].name = "Lamp"; })).toBe(true);
    expect(st.edit((f) => { f.devices.pop(); })).toBe(true);
    expect(st.f.devices.length).toBe(n - 1);
    expect(st.f.devices[0].name).toBe("Lamp");
    expect(st.planBlocked).toBe(false);
  });

  it("refuses an edit that touches a device and the plan together", () => {
    const st = locked(), x = (st.f.devices[0] as any).x;
    const p0 = JSON.stringify(st.f.rooms[0].pts);
    expect(st.edit((f) => { (f.devices[0] as any).x += 5; f.rooms[0].pts[0] = [1, 1]; })).toBe(false);
    expect((st.f.devices[0] as any).x).toBe(x);
    expect(JSON.stringify(st.f.rooms[0].pts)).toBe(p0);
  });

  it("a live drag (replaceFloor) keeps the plan and takes the devices", () => {
    const st = locked(), room = st.f.rooms[0].name, x = (st.f.devices[0] as any).x;
    const g = structuredClone(st.f);
    g.rooms[0].name = "Changed"; g.rooms[0].pts[0] = [1, 1]; (g.devices[0] as any).x += 9;
    st.replaceFloor(g);
    expect(st.f.rooms[0].name).toBe(room);
    expect(st.f.rooms[0].pts[0]).not.toEqual([1, 1]);
    expect((st.f.devices[0] as any).x).toBe(x + 9);
  });

  it("refuses floor order, rotation, adding and deleting floors", () => {
    const st = locked(), before = JSON.stringify(st.layout);
    expect(st.setRotate(90)).toBe(false);
    expect(st.moveFloor(Object.keys(st.layout.floors)[0], 1)).toBe(false);
    expect(st.deleteFloor(Object.keys(st.layout.floors)[1])).toBe(false);
    expect(st.addFloor("Attic")).toBe("");
    expect(JSON.stringify(st.layout)).toBe(before);
  });

  it("everything works again once it is unlocked", () => {
    const st = locked();
    st.planLocked = false;
    expect(st.edit((f) => { f.rooms[0].pts[0] = [1, 1]; })).toBe(true);
  });
});

describe("EditorState: plan lock and scenes", () => {
  beforeEach(() => localStorage.clear());
  it("a room's scenes and offered Home Assistant scenes are not the plan: they save while it is fixed, and the room's shape still cannot change", () => {
    const st = locked();
    expect(st.edit((f) => { f.rooms[0].scenes = [{ id: "s1", name: "Movie", items: [{ entity: "light.demo_living", on: true }] }]; })).toBe(true);
    expect(st.planBlocked).toBe(false);
    expect(st.edit((f) => { f.rooms[0].haScenes = ["scene.x"]; })).toBe(true);
    expect(st.edit((f) => { delete f.rooms[0].scenes; })).toBe(true);
    expect(st.edit((f) => { f.rooms[0].pts[0] = [1, 1]; })).toBe(false);
    expect(st.planBlocked).toBe(true);
    expect(st.edit((f) => { f.rooms[0].scenes = [{ id: "s2", name: "X", items: [{ entity: "light.demo_living", on: true }] }]; f.rooms[0].pts[0] = [1, 1]; })).toBe(false); // both at once is still a plan change
  });
});

// Opus re-check of task/s22-fix: a writer that says no for its own reason (an empty or unchanged title, the last floor,
// the same angle) must not leave `planBlocked` from an earlier refusal, or the editor blames the lock for it.
describe("EditorState: planBlocked names only the lock's own refusals", () => {
  beforeEach(() => localStorage.clear());
  it("is cleared by a floor or rotate writer that refuses for its own reason, locked or not", () => {
    const st = locked();
    expect(st.moveFloor("ground", 1)).toBe(false);
    expect(st.planBlocked).toBe(true);
    for (const lock of [true, false]) {
      st.planLocked = lock;
      const refusals: [string, () => boolean][] = [
        ["empty title", () => st.renameFloor("ground", "   ")],
        ["same title", () => st.renameFloor("ground", " Ground ")],
        ["unknown floor", () => st.deleteFloor("nope")],
        ["off the list", () => st.moveFloor("ground", -1)],
        ["same angle", () => st.setRotate(st.layout.rotate ?? 0)],
        ["empty new floor", () => st.addFloor("  ") !== ""],
      ];
      for (const [why, run] of refusals) {
        st.setRotate(90); // locked: sets the flag; unlocked: turns, so put it back
        if (!lock) st.setRotate(0);
        expect(run(), why).toBe(false);
        expect(st.planBlocked, why).toBe(false);
      }
    }
  });
  it("deleting the only floor under the lock is the last floor's refusal, not the lock's", () => {
    const st = new EditorState(fresh());
    st.deleteFloor("test"); st.deleteFloor("first");
    st.planLocked = true;
    st.setRotate(90); // a lock refusal first, so a stale flag would show
    expect(st.deleteFloor("ground")).toBe(false);
    expect(st.planBlocked).toBe(false);
  });
});

// S26.3 (U3): the lock holds geometry only. Names, titles, colours, textures, area and entity links stay editable.
describe("EditorState: plan lock holds geometry only (S26.3)", () => {
  beforeEach(() => localStorage.clear());
  type Case = [string, (f: Floor) => void];
  const allowed: Case[] = [
    ["room name", (f) => { f.rooms[0].name = "Lounge"; }],
    ["room area", (f) => { f.rooms[0].area = "other_area"; }],
    ["room entity", (f) => { f.rooms[0].entity = "light.x"; }],
    ["room colour", (f) => { f.rooms[0].color = "#123456"; }],
    ["room texture", (f) => { f.rooms[0].texture = TEXTURE_IDS[0]; f.rooms[0].textureRot = 30; f.rooms[0].textureScale = 2; }],
    ["room sensors", (f) => { f.rooms[0].temps = ["sensor.t"]; f.rooms[0].humidity = ["sensor.h"]; f.rooms[0].motion = ["binary_sensor.m"]; }],
    ["door name", (f) => { f.doors[0].name = "Front"; }],
    ["door sensors and cover", (f) => { f.doors[0].sensors = ["binary_sensor.d"]; f.doors[0].vibration = ["binary_sensor.v"]; f.doors[0].locks = ["lock.l"]; f.doors[0].cover = "cover.c"; }],
    ["extra name", (f) => { f.extras[0].name = "Renamed"; }],
    ["stairs name", (f) => { f.stairs[0].name = "Main"; }],
    ["stairs colour", (f) => { f.stairs[0].color = "#abcdef"; }],
    ["furniture name", (f) => { f.furniture[0].name = "Couch"; }],
    ["furniture entity", (f) => { f.furniture[0].entity = "light.f"; }],
  ];
  const refused: Case[] = [
    ["room corner", (f) => { f.rooms[0].pts[0] = [1, 1]; }],
    ["room kind", (f) => { f.rooms[0].kind = f.rooms[0].kind === "garden" ? "room" : "garden"; }],
    ["room edge kind", (f) => { f.rooms[0].wk[0] = f.rooms[0].wk[0] === "none" ? "wall" : "none"; }],
    ["room height", (f) => { f.rooms[0].height = 111; }],
    ["wall added", (f) => { f.walls.push({ id: "w9", a: [0, 0], b: [50, 0], kind: "wall" }); }],
    ["wall end", (f) => { f.walls[0].b = [7, 7]; }],
    ["wall kind", (f) => { f.walls[0].kind = "fence"; }],
    ["wall height", (f) => { f.walls[0].height = 99; }],
    ["door position", (f) => { f.doors[0].a = [1, 1]; }],
    ["door kind", (f) => { f.doors[0].kind = f.doors[0].kind === "window" ? "door" : "window"; }],
    ["door height", (f) => { f.doors[0].height = 77; }],
    ["door sill", (f) => { f.doors[0].sill = 33; }],
    ["door removed", (f) => { f.doors.pop(); }],
    ["extra position", (f) => { f.extras[0].a = [3, 3]; }],
    ["stairs corner", (f) => { f.stairs[0].pts[0] = [1, 1]; }],
    ["stairs shape", (f) => { f.stairs[0].shape = f.stairs[0].shape === "round" ? "straight" : "round"; }],
    ["furniture position", (f) => { f.furniture[0].x += 9; }],
    ["furniture added", (f) => { f.furniture.push({ id: "m9", symbol: "tree", x: 1, y: 1, rot: 0, w: 50, h: 50 } as never); }],
    ["floor height", (f) => { f.height = 301; }],
    ["outline", (f) => { f.outline[0] = [1, 1]; }],
  ];
  /** The demo plus a wall and an extra, so every geometry list has a member; then locked. */
  const seeded = () => {
    const st = new EditorState(fresh());
    st.edit((f) => { f.walls.push({ id: "w0", a: [0, 0], b: [100, 0], kind: "wall" }); f.extras.push({ id: "x0", name: "n", a: [0, 0], b: [10, 10] }); });
    expect(st.f.stairs.length && st.f.furniture.length && st.f.doors.length && st.f.rooms.length).toBeTruthy();
    st.planLocked = true;
    return st;
  };

  for (const [what, change] of allowed) it(`allows ${what}: one undo step, and the result validates`, () => {
    const st = seeded(), before = JSON.stringify(st.layout);
    expect(st.edit(change), what).toBe(true);
    expect(st.planBlocked).toBe(false);
    expect(JSON.stringify(st.layout)).not.toBe(before);
    expect(validate(st.layout).ok, what).toBe(true);
    st.undo();
    expect(JSON.stringify(st.layout), what).toBe(before);
  });
  for (const [what, change] of refused) it(`refuses ${what}, with no undo step`, () => {
    const st = seeded(), before = JSON.stringify(st.layout), depth = st.canUndo;
    expect(st.edit(change), what).toBe(false);
    expect(st.planBlocked).toBe(true);
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.canUndo).toBe(depth);
  });
  it("a floor rename and a paint go through the lock, one undo step each", () => {
    const st = seeded(), key = st.floor, title = st.layout.floors[key].title, before = JSON.stringify(st.layout);
    expect(st.renameFloor(key, "Other")).toBe(true);
    expect(st.layout.floors[key].title).toBe("Other");
    expect(st.planBlocked).toBe(false);
    expect(st.paint("rooms", 0, { color: "#ff0000" })).toBe(true);
    expect(st.f.rooms[0].color).toBe("#ff0000");
    expect(st.paint("stairs", 0, { texture: TEXTURE_IDS[0] })).toBe(true);
    st.undo(); st.undo(); st.undo();
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.layout.floors[key].title).toBe(title);
  });
  it("a name and a corner together are refused whole", () => {
    const st = seeded(), n = st.f.rooms[0].name;
    expect(st.edit((f) => { f.rooms[0].name = "Lounge"; f.rooms[0].pts[0] = [1, 1]; })).toBe(false);
    expect(st.f.rooms[0].name).toBe(n);
  });
});

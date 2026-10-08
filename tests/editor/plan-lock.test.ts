import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

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
    expect(st.edit((f) => { f.rooms[0].name = "Changed"; })).toBe(false);
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
    expect(st.edit((f) => { (f.devices[0] as any).x += 5; f.rooms[0].name = "Changed"; })).toBe(false);
    expect((st.f.devices[0] as any).x).toBe(x);
    expect(st.f.rooms[0].name).not.toBe("Changed");
  });

  it("a live drag (replaceFloor) keeps the plan and takes the devices", () => {
    const st = locked(), room = st.f.rooms[0].name, x = (st.f.devices[0] as any).x;
    const g = structuredClone(st.f);
    g.rooms[0].name = "Changed"; (g.devices[0] as any).x += 9;
    st.replaceFloor(g);
    expect(st.f.rooms[0].name).toBe(room);
    expect((st.f.devices[0] as any).x).toBe(x + 9);
  });

  it("refuses floor, rotation and paint changes", () => {
    const st = locked(), before = JSON.stringify(st.layout);
    expect(st.paint("rooms", 0, { color: "#ff0000" })).toBe(false);
    expect(st.setRotate(90)).toBe(false);
    expect(st.renameFloor(Object.keys(st.layout.floors)[0], "Other")).toBe(false);
    expect(st.moveFloor(Object.keys(st.layout.floors)[0], 1)).toBe(false);
    expect(st.deleteFloor(Object.keys(st.layout.floors)[1])).toBe(false);
    expect(st.addFloor("Attic")).toBe("");
    expect(JSON.stringify(st.layout)).toBe(before);
  });

  it("everything works again once it is unlocked", () => {
    const st = locked();
    st.planLocked = false;
    expect(st.edit((f) => { f.rooms[0].name = "Changed"; })).toBe(true);
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
    expect(st.edit((f) => { f.rooms[0].name = "Changed"; })).toBe(false);
    expect(st.planBlocked).toBe(true);
    expect(st.edit((f) => { f.rooms[0].scenes = [{ id: "s2", name: "X", items: [{ entity: "light.demo_living", on: true }] }]; f.rooms[0].name = "Changed"; })).toBe(false); // both at once is still a plan change
  });
});

// Opus re-check of task/s22-fix: a writer that says no for its own reason (an empty or unchanged title, the last floor,
// the same angle) must not leave `planBlocked` from an earlier refusal, or the editor blames the lock for it.
describe("EditorState: planBlocked names only the lock's own refusals", () => {
  beforeEach(() => localStorage.clear());
  it("is cleared by a floor or rotate writer that refuses for its own reason, locked or not", () => {
    const st = locked();
    expect(st.renameFloor("ground", "Loft")).toBe(false);
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
        st.renameFloor("ground", "Loft"); // locked: sets the flag; unlocked: renames, so put it back
        if (!lock) st.renameFloor("ground", "Ground");
        expect(run(), why).toBe(false);
        expect(st.planBlocked, why).toBe(false);
      }
    }
  });
  it("deleting the only floor under the lock is the last floor's refusal, not the lock's", () => {
    const st = new EditorState(fresh());
    st.deleteFloor("test"); st.deleteFloor("first");
    st.planLocked = true;
    st.renameFloor("ground", "Loft"); // a lock refusal first, so a stale flag would show
    expect(st.deleteFloor("ground")).toBe(false);
    expect(st.planBlocked).toBe(false);
  });
});

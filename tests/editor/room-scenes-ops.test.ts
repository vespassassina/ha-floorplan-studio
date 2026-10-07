import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validate } from "../../src/core/schema";
import type { Floor, Room } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { addScene, addSceneItem, removeScene, removeSceneItem, renameScene, roomSceneTargets, setRoomHaScenes, setSceneItem } from "../../src/editor/room-scenes-ops";

// S14.7: the editor's writers for a room's custom scenes. Like setRoomList for sensors (CLAUDE.md finding 12), a
// writer can commit an invalid layout (`EditorState.edit` does not validate), so every operation, in every order, must
// leave a layout `validate` accepts.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const roomOf = (): Room => structuredClone(demo.floors.ground.rooms[0]);

describe("roomSceneTargets: the lights and switches the room can put in a scene", () => {
  it("is the room's own lights and switches by entity, named, once each; a camera or another room's lamp is not one", () => {
    const f = demo.floors.ground as Floor;
    const t = roomSceneTargets(f, 0);
    expect(t.map((x) => x.entity)).toContain("light.demo_living");
    expect(t.map((x) => x.entity)).not.toContain("light.demo_kitchen");
    expect(t.every((x) => /^(light|switch|fan|cover|climate|media_player)\./.test(x.entity))).toBe(true);
    expect(new Set(t.map((x) => x.entity)).size).toBe(t.length);
    expect(roomSceneTargets(f, 99)).toEqual([]);
  });
});

describe("scene writers", () => {
  it("addScene names and ids it uniquely, fills it with the given entities switched on, and stops at the cap", () => {
    const r = roomOf();
    expect(addScene(r, ["light.a", "switch.b"])).toBe(true);
    expect(addScene(r, ["light.b"])).toBe(true);
    expect(r.scenes!.map((s) => s.name)).toEqual(["Scene 1", "Scene 2"]);
    expect(new Set(r.scenes!.map((s) => s.id)).size).toBe(2);
    expect(r.scenes![0].items).toEqual([{ entity: "light.a", on: true }, { entity: "switch.b", on: true }]);
    removeScene(r, r.scenes![0].id);
    addScene(r, ["light.b"]);
    expect(new Set(r.scenes!.map((s) => s.id)).size).toBe(2); // an id of a removed scene is never handed out twice in a row
    while (r.scenes!.length < 12) addScene(r, ["light.b"]);
    expect(addScene(r, ["light.b"])).toBe(false);
  });
  it("addScene refuses an empty scene: no target, or none that is a light or a switch (S14 review)", () => {
    const r = roomOf();
    expect(addScene(r, [])).toBe(false);
    expect(addScene(r, ["sensor.t", "fan.x"])).toBe(false);
    expect(r.scenes).toBeUndefined();
  });
  it("renameScene trims, refuses an empty name, and reports no change for the same name", () => {
    const r = roomOf(); addScene(r, ["light.a"]);
    const id = r.scenes![0].id;
    expect(renameScene(r, id, "  Movie  ")).toBe(true);
    expect(r.scenes![0].name).toBe("Movie");
    expect(renameScene(r, id, "Movie")).toBe(false);
    expect(renameScene(r, id, "   ")).toBe(false);
    expect(r.scenes![0].name).toBe("Movie");
  });
  it("setSceneItem: brightness is clamped to 1-100 and whole, empty clears it, switching off drops the light fields, a switch takes no brightness", () => {
    const r = roomOf(); addScene(r, ["light.a", "switch.b"]);
    const id = r.scenes![0].id;
    setSceneItem(r, id, "light.a", { brightness: 150 });
    expect(r.scenes![0].items[0].brightness).toBe(100);
    setSceneItem(r, id, "light.a", { brightness: 0.2 });
    expect(r.scenes![0].items[0].brightness).toBe(1);
    setSceneItem(r, id, "light.a", { brightness: 33.6 });
    expect(r.scenes![0].items[0].brightness).toBe(34);
    setSceneItem(r, id, "light.a", { brightness: null });
    expect(r.scenes![0].items[0]).toEqual({ entity: "light.a", on: true });
    setSceneItem(r, id, "light.a", { brightness: 50 });
    setSceneItem(r, id, "light.a", { on: false });
    expect(r.scenes![0].items[0]).toEqual({ entity: "light.a", on: false });
    setSceneItem(r, id, "switch.b", { brightness: 50 });
    expect(r.scenes![0].items[1]).toEqual({ entity: "switch.b", on: true });
    expect(setSceneItem(r, id, "light.a", { brightness: NaN })).toBe(false);
  });
  it("addSceneItem takes an entity once; removeSceneItem and removeScene remove", () => {
    const r = roomOf(); addScene(r, ["light.a"]);
    const id = r.scenes![0].id;
    expect(addSceneItem(r, id, "light.a")).toBe(false);
    expect(addSceneItem(r, id, "light.z")).toBe(true);
    expect(r.scenes![0].items.map((i) => i.entity)).toEqual(["light.a", "light.z"]);
    expect(removeSceneItem(r, id, "light.a")).toBe(true);
    expect(removeSceneItem(r, id, "light.a")).toBe(false);
    expect(removeScene(r, id)).toBe(true);
    expect(r.scenes).toBeUndefined(); // an empty list is removed, like an empty sensor list
  });
  it("setRoomHaScenes keeps scene.* only, once each, capped, and an empty list deletes the key", () => {
    const r = roomOf();
    setRoomHaScenes(r, ["scene.a", "scene.a", "light.x", "scene.b"]);
    expect(r.haScenes).toEqual(["scene.a", "scene.b"]);
    setRoomHaScenes(r, []);
    expect(r.haScenes).toBeUndefined();
  });
  it("every combination leaves a layout validate accepts", () => {
    const l = structuredClone(demo);
    const r = l.floors.ground.rooms[0] as Room;
    for (const ents of [["light.demo_kitchen"], ["light.demo_living"], ["light.demo_living", "switch.demo_hall"]]) {
      addScene(r, ents);
      const id = r.scenes![r.scenes!.length - 1].id;
      for (const patch of [{ brightness: 500 }, { brightness: -3 }, { on: false }, { on: true, brightness: 40 }, { brightness: null }]) for (const e of ents) setSceneItem(r, id, e, patch);
      addSceneItem(r, id, "light.demo_kitchen"); renameScene(r, id, "x".repeat(40));
      expect(validate(l), JSON.stringify(validate(l))).toEqual({ ok: true, layout: expect.anything() });
    }
    setRoomHaScenes(r, ["scene.relax"]);
    expect(validate(l).ok).toBe(true);
  });
  it("through EditorState.edit, one gesture is one undo step and a repeat is none", () => {
    const st = new EditorState(structuredClone(demo));
    st.floor = "ground";
    expect(st.edit((f) => { addScene(f.rooms[0], ["light.demo_living"]); })).toBe(true);
    const id = st.f.rooms[0].scenes![0].id;
    expect(st.edit((f) => { renameScene(f.rooms[0], id, "Scene 1"); })).toBe(false); // unchanged: no step
    expect(st.undo()).toBe(true);
    expect(st.f.rooms[0].scenes).toBeUndefined();
  });
});

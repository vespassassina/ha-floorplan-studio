import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validate } from "../../src/core/schema";
import type { Floor, Room } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { removeScene, saveScene, roomSceneTargets, setRoomHaScenes } from "../../src/editor/room-scenes-ops";

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

describe("roomSceneTargets: curtains and covers on the room's doors and windows (S18.4)", () => {
  it("lists a door's cover by the door's name, in the room whose edge it lies on, and not in another room", () => {
    const f = demo.floors.ground as Floor;
    expect(roomSceneTargets(f, 2)).toContainEqual({ entity: "cover.demo_garage_door", name: "Garage door" });
    expect(roomSceneTargets(f, 0).map((x) => x.entity)).not.toContain("cover.demo_garage_door");
  });
});

describe("roomSceneTargets: no thermostat in the designer (S18.4)", () => {
  it("leaves out a climate device the room holds; validate still accepts climate in an older scene", () => {
    const f = structuredClone(demo.floors.ground) as Floor;
    f.devices.push({ id: "trv-1", type: "climate", entity: "climate.trv", name: "TRV", x: 100, y: 100 } as Floor["devices"][number]);
    expect(roomSceneTargets(f, 0).map((x) => x.entity)).not.toContain("climate.trv");
  });
});

describe("scene writers", () => {
  // S19.E6: addScene, renameScene, addSceneItem, removeSceneItem and setSceneItem were unused since the designer (S17.3) and are gone with their
  // tests; what they pinned that still matters is asserted below on `saveScene`, the one writer the panel calls.
  it("saveScene names and ids scenes uniquely, and stops at the cap", () => {
    const r = roomOf();
    expect(saveScene(r, null, "A", [{ entity: "light.a", on: true }, { entity: "switch.b", on: true }])).toEqual({ ok: true, id: "scene-1" });
    expect(saveScene(r, null, "B", [{ entity: "light.b", on: true }])).toEqual({ ok: true, id: "scene-2" });
    removeScene(r, "scene-1");
    expect(saveScene(r, null, "C", [{ entity: "light.b", on: true }])).toEqual({ ok: true, id: "scene-3" }); // scene-2 is still there, so the next id is the first free one after it
    while (r.scenes!.length < 12) saveScene(r, null, `S${r.scenes!.length}x`, [{ entity: "light.b", on: true }]);
    expect(saveScene(r, null, "Over", [{ entity: "light.b", on: true }])).toMatchObject({ ok: false });
    expect(new Set(r.scenes!.map((s) => s.id)).size).toBe(r.scenes!.length);
  });
  it("removeScene removes, and an empty list is removed like an empty sensor list", () => {
    const r = roomOf();
    saveScene(r, null, "A", [{ entity: "light.a", on: true }]);
    expect(removeScene(r, "nope")).toBe(false);
    expect(removeScene(r, "scene-1")).toBe(true);
    expect(r.scenes).toBeUndefined();
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
      for (const patch of [{ brightness: 500 }, { brightness: -3 }, { on: false }, { on: true, brightness: 40 }]) {
        saveScene(r, null, `S${r.scenes?.length ?? 0}`, ents.map((entity) => ({ entity, ...{ on: true }, ...patch })) as never);
        expect(validate(l), JSON.stringify(validate(l))).toEqual({ ok: true, layout: expect.anything() });
      }
    }
    setRoomHaScenes(r, ["scene.relax"]);
    expect(validate(l).ok).toBe(true);
  });
  it("through EditorState.edit, one gesture is one undo step and a refused save is none", () => {
    const st = new EditorState(structuredClone(demo));
    st.floor = "ground";
    expect(st.edit((f) => { saveScene(f.rooms[0], null, "Scene 1", [{ entity: "light.demo_living", on: true }]); })).toBe(true);
    expect(st.edit((f) => { saveScene(f.rooms[0], null, "Scene 1", [{ entity: "light.demo_living", on: true }]); })).toBe(false); // the name is taken: nothing changes, no step
    expect(st.undo()).toBe(true);
    expect(st.f.rooms[0].scenes).toBeUndefined();
  });
});

// S17.3: the designer's Save.
describe("saveScene: the designer's Save", () => {
  const room = () => ({ id: "r", name: "R", scenes: [{ id: "scene-1", name: "Old", items: [{ entity: "light.a", on: true }] }] }) as never as Room;
  it("refuses an empty name and no devices, with the reason, changing nothing", () => {
    const r = room();
    expect(saveScene(r, null, "  ", [{ entity: "light.b", on: true }])).toEqual({ ok: false, reason: "Give the scene a name." });
    expect(saveScene(r, null, "X", [{ entity: "lock.b", on: true }] as never)).toMatchObject({ ok: false });
    expect(r.scenes).toHaveLength(1);
  });
  it("adds a new scene, or replaces one in place, and refuses a taken name", () => {
    const r = room();
    expect(saveScene(r, null, "Movie", [{ entity: "light.b", on: true, brightness: 30 }])).toEqual({ ok: true, id: "scene-2" });
    expect(saveScene(r, "scene-1", "Old", [{ entity: "fan.x", on: true }])).toEqual({ ok: true, id: "scene-1" });
    expect(r.scenes![0].items).toEqual([{ entity: "fan.x", on: true }]);
    expect(saveScene(r, null, "Movie", [{ entity: "light.b", on: true }])).toMatchObject({ ok: false });
  });
  it("keeps only the fields of the type, only when on, clamped; duplicates dropped", () => {
    const r = room();
    saveScene(r, null, "S", [
      { entity: "light.b", on: true, brightness: 500, kelvin: 2700, percentage: 5 } as never,
      { entity: "light.b", on: true },
      { entity: "light.c", on: false, brightness: 40 },
      { entity: "cover.d", on: true, position: -9, volume: 3 } as never,
      { entity: "climate.e", on: true, hvac: "  heat ", temperature: NaN } as never,
    ]);
    expect(r.scenes![1].items).toEqual([
      { entity: "light.b", on: true, brightness: 100, kelvin: 2700 },
      { entity: "light.c", on: false },
      { entity: "cover.d", on: true, position: 0 },
      { entity: "climate.e", on: true, hvac: "heat" },
    ]);
  });
});

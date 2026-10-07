import { describe, it, expect } from "vitest";
import type { Layout } from "../../src/core/schema";
import { FURNITURE } from "../../src/core";
import { addCandidates, furnitureForEntity, furnitureForType } from "../../src/core";
import { EditorState } from "../../src/editor/state";

const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "room-ground-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [], devices: [] } },
  catalog: [],
} as unknown as Layout);
const ha = (entities: object[]) => ({ entities } as never);

// S18.11: an entity that is a tv or a speaker is placed as a furniture piece that tracks it, not as a device icon.
describe("S18.11 the rule", () => {
  it("a media_player of class tv or speaker is a piece; any other entity is not", () => {
    expect(furnitureForEntity({ id: "media_player.a", name: "A", domain: "media_player", dc: "tv" })).toBe("tv");
    expect(furnitureForEntity({ id: "media_player.b", name: "B", domain: "media_player", dc: "speaker" })).toBe("speaker");
    expect(furnitureForEntity({ id: "media_player.c", name: "C", domain: "media_player" })).toBeNull();
    expect(furnitureForEntity({ id: "media_player.d", name: "D", domain: "media_player", dc: "receiver" })).toBeNull();
    expect(furnitureForEntity({ id: "switch.e", name: "E", domain: "switch", dc: "tv" })).toBeNull();
  });
  it("a catalog type of tv, speaker or computer is a piece; nothing else", () => {
    expect(furnitureForType("tv")).toBe("tv");
    expect(furnitureForType("speaker")).toBe("speaker");
    expect(furnitureForType("computer")).toBe("computer");
    for (const t of ["media", "light", "plug", "other", "server"] as const) expect(furnitureForType(t)).toBeNull();
  });
});

describe("S18.11 addEntity", () => {
  it("a tv player lands as a tv piece in its area's room centre, default size, entity set, selected, one undo step", () => {
    const st = new EditorState(layout());
    expect(st.addEntity({ id: "media_player.tv", name: "Living TV", domain: "media_player", dc: "tv", area: "kitchen" }, [999, 999])).toBe(true);
    expect(st.f.devices).toHaveLength(0);
    expect(st.f.furniture).toHaveLength(1);
    expect(st.f.furniture[0]).toMatchObject({ symbol: "tv", entity: "media_player.tv", name: "Living TV", x: 200, y: 150, rot: 0, w: FURNITURE.tv.w, h: FURNITURE.tv.h });
    expect(st.sel).toEqual({ t: "furn", i: 0 });
    expect(st.layout.catalog).toEqual([expect.objectContaining({ type: "tv", entity: "media_player.tv", room: "Kitchen", id: st.f.furniture[0].id })]);
    expect(st.undo()).toBe(true);
    expect(st.f.furniture).toHaveLength(0);
    expect(st.layout.catalog).toHaveLength(0);
    expect(st.canUndo).toBe(false);
  });
  it("a speaker player takes the fallback point when its area has no room", () => {
    const st = new EditorState(layout());
    st.addEntity({ id: "media_player.sp", name: "Kitchen speaker", domain: "media_player", dc: "speaker" }, [500, 40]);
    expect(st.f.furniture[0]).toMatchObject({ symbol: "speaker", x: 500, y: 40, w: FURNITURE.speaker.w, h: FURNITURE.speaker.h });
  });
  it("a plain media_player stays a device icon", () => {
    const st = new EditorState(layout());
    st.addEntity({ id: "media_player.x", name: "X", domain: "media_player" }, [10, 10]);
    expect(st.f.furniture).toHaveLength(0);
    expect(st.f.devices[0]).toMatchObject({ type: "media", entity: "media_player.x" });
  });
  it("a placed piece is not offered again, and refuses a second add", () => {
    const st = new EditorState(layout());
    const e = { id: "media_player.tv", name: "TV", domain: "media_player", dc: "tv" };
    st.addEntity(e, [10, 10]);
    expect(addCandidates(st.layout, ha([e])).map((c) => c.entity)).not.toContain("media_player.tv");
    expect(st.addEntity(e, [20, 20])).toBe(false);
    expect(st.f.furniture).toHaveLength(1);
  });
});

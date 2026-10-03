import { beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { viewBoxFor } from "../../src/core";
import { EditorState } from "../../src/editor/state";
import { VIEW_MEMORY_KEY, parseViewMemory, readViewMemory, writeViewMemory } from "../../src/editor/view-memory";

const fresh = () => structuredClone(demo) as unknown as Layout;

describe("parseViewMemory: storage is untrusted", () => {
  it("keeps good fields and drops bad ones on their own", () => {
    const m = parseViewMemory({ v: 1, floor: "first", mode: "2.5d", tilt: 0.4, labels: false, rotation: 100, zooms: [["ground", { zoom: 2, focus: [10, 20] }]] });
    expect(m).toEqual({ floor: "first", mode: "2.5d", tilt: 0.4, labels: false, rotation: 90, zooms: [["ground", { zoom: 2, focus: [10, 20] }]] });
    const bad = parseViewMemory({ floor: 5, mode: "3d", tilt: "x", labels: "no", rotation: "90", zooms: "all" });
    expect(bad).toEqual({});
  });
  it("never throws and returns nothing for junk", () => {
    for (const raw of [null, undefined, 5, "not json", "[1]", "{", [], "null", { zooms: [[1, 2]] }]) expect(() => parseViewMemory(raw), String(raw)).not.toThrow();
    expect(parseViewMemory("not json")).toEqual({});
    expect(parseViewMemory("{\"mode\":\"2.5d\"}")).toEqual({ mode: "2.5d" });
  });
  it("clamps zoom and tilt, bounds the focus, drops a zoom with a bad focus, caps the count", () => {
    const m = parseViewMemory({ tilt: 9, zooms: [["a", { zoom: 99, focus: [1e12, -1e12] }], ["b", { zoom: 2, focus: [NaN, 0] }], ["c", { zoom: 2 }], ["d", { zoom: 0.01, focus: [0, 0] }]] });
    expect(m.tilt).toBe(1);
    expect(m.zooms?.map(([k]) => k)).toEqual(["a", "d"]);
    expect(m.zooms![0]![1]).toEqual({ zoom: 8, focus: [1e6, -1e6] });
    expect(m.zooms![1]![1].zoom).toBe(0.4);
    const many = parseViewMemory({ zooms: Array.from({ length: 500 }, (_, i) => [`f${i}`, { zoom: 2, focus: [0, 0] }]) });
    expect(many.zooms!.length).toBe(50);
  });
  it("a floor named __proto__ is just a name", () => {
    const raw = JSON.parse('{"zooms":[["__proto__",{"zoom":2,"focus":[0,0]}]]}');
    const m = parseViewMemory(raw);
    expect(m.zooms?.[0]?.[0]).toBe("__proto__");
    expect(({} as Record<string, unknown>).zoom).toBeUndefined();
  });
});

describe("read and write", () => {
  beforeEach(() => localStorage.clear());
  it("round trips through localStorage under one key", () => {
    expect(writeViewMemory({ mode: "2.5d", rotation: 45 })).toBe(true);
    expect(Object.keys(localStorage)).toEqual([VIEW_MEMORY_KEY]);
    expect(readViewMemory()).toEqual({ mode: "2.5d", rotation: 45 });
  });
  it("an empty memory removes the entry", () => {
    writeViewMemory({ rotation: 45 });
    writeViewMemory({});
    expect(localStorage.getItem(VIEW_MEMORY_KEY)).toBeNull();
  });
  it("blocked storage is silent: false from write, nothing from read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(writeViewMemory({ rotation: 45 })).toBe(false);
    expect(readViewMemory()).toEqual({});
    vi.restoreAllMocks();
  });
});

describe("EditorState: the user's turn", () => {
  it("adds to the layout's own rotate and never edits it", () => {
    const l = fresh();
    l.rotate = 90;
    const st = new EditorState(l);
    st.viewRot = 45;
    expect(st.rotation?.deg).toBe(135);
    expect(st.layout.rotate).toBe(90);
    expect(st.canUndo).toBe(false);
  });
  it("is no rotation at all when the two cancel, and a frame in flight wins over the settled step", () => {
    const l = fresh();
    l.rotate = 45;
    const st = new EditorState(l);
    st.viewRot = 315;
    expect(st.rotation).toBeUndefined();
    st.turning = 20;
    expect(st.rotation?.deg).toBe(65);
  });
  it("a document rotate (an undo step) is still its own thing: Plan rotate does not touch the view's turn", () => {
    const st = new EditorState(fresh());
    st.viewRot = 90;
    expect(st.setRotate(45)).toBe(true);
    expect(st.viewRot).toBe(90);
    expect(st.rotation?.deg).toBe(135);
    st.undo();
    expect(st.rotation?.deg).toBe(90);
  });
});

describe("EditorState: export and import of the view", () => {
  it("round trips mode, tilt, labels, turn, floor and a zoomed floor", () => {
    const a = new EditorState(fresh());
    a.setViewMode("2.5d");
    a.setTilt(0.7);
    a.setLabels(false);
    a.viewRot = 135;
    a.setFloor("first");
    const fit = viewBoxFor(a.f, 80, a.rotation, a.viewMode, a.tilt);
    a.views.first = { x: 10, y: 20, w: fit.w / 2, h: fit.h / 2 };
    const m = a.exportView();
    const b = new EditorState(fresh());
    b.importView(m);
    expect(b.viewMode).toBe("2.5d");
    expect(b.tilt).toBeCloseTo(0.7, 6);
    expect(b.labels).toBe(false);
    expect(b.viewRot).toBe(135);
    expect(b.floor).toBe("first");
    const v = b.views.first!, w = a.views.first!;
    expect(v.w).toBeCloseTo(w.w, 6);
    expect(v.x + v.w / 2).toBeCloseTo(w.x + w.w / 2, 6);
    expect(v.y + v.h / 2).toBeCloseTo(w.y + w.h / 2, 6);
  });
  it("keeps the shape of a zoomed box when the tilt changed after it was made (the fit changes shape, the box does not)", () => {
    const a = new EditorState(fresh());
    a.setViewMode("2.5d");
    a.setTilt(0.1);
    const fit = viewBoxFor(a.f, 80, a.rotation, a.viewMode, a.tilt);
    a.views.ground = { x: 0, y: 0, w: fit.w / 2, h: fit.h / 2 };
    a.setTilt(0.9); // zoomed, so the box stays as it was
    const b = new EditorState(fresh());
    b.importView(a.exportView());
    expect(b.views.ground!.w).toBeCloseTo(a.views.ground!.w, 6);
    expect(b.views.ground!.h).toBeCloseTo(a.views.ground!.h, 6);
  });
  it("a floor shown whole (at fit) is not stored: a plan that grows must not be clipped by an old fit", () => {
    const a = new EditorState(fresh());
    void a.view; // creates the fit view of the floor
    expect(a.exportView().zooms ?? []).toEqual([]);
    expect(Object.keys(a.views)).toHaveLength(1);
  });
  it("a floor the layout does not have is ignored, not an error, and a bad floor name keeps the current floor", () => {
    const st = new EditorState(fresh());
    const was = st.floor;
    st.importView({ floor: "attic", zooms: [["attic", { zoom: 2, focus: [0, 0] }], ["__proto__", { zoom: 2, focus: [0, 0] }]] });
    expect(st.floor).toBe(was);
    expect(Object.keys(st.views)).toEqual([]);
  });
  it("importing is no edit: no undo step, the layout is unchanged", () => {
    const st = new EditorState(fresh());
    const before = JSON.stringify(st.layout);
    st.importView({ mode: "2.5d", rotation: 90, tilt: 0.2, labels: false });
    expect(st.canUndo).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(before);
  });
  it("a turn that is not a multiple of 45 is rounded to one", () => {
    const st = new EditorState(fresh());
    st.importView({ rotation: 100 } as never);
    expect(st.viewRot).toBe(90);
  });
});

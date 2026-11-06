import { describe, it, expect } from "vitest";
import { validate, type Layout } from "../../src/core/schema";
import { setEdgeColour } from "../../src/core/geometry";
import { MAX_PALETTE } from "../../src/core";
import { EditorState } from "../../src/editor/state";

// B53.9: the Studio's wall colour writers. One undo step each, none when nothing changes (finding 6), a layout `validate`
// accepts after the step, Undo and Redo (finding 12), a custom colour joins layout.palette in the same step.
const rect = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: number[][]) => ({ id, name: id, area: id, label: "", kind: "room", pts, wk: pts.map(() => "wall") });
const make = (over: { palette?: string[]; wallColors?: Record<string, string> } = {}) => {
  const l = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], ...(over.palette ? { palette: over.palette } : {}), ...(over.wallColors ? { wallColors: over.wallColors } : {}),
    floors: { ground: { title: "Ground", outline: rect(0, 0, 1000, 800), rooms: [room("a", rect(0, 0, 500, 800)), room("b", rect(500, 0, 1000, 800))], walls: [{ id: "wall-ground-1", a: [100, 100], b: [300, 100], kind: "wall" }], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] } } } as unknown as Layout;
  return new EditorState(l);
};
const ok = (st: EditorState, what: string) => { const r = validate(st.layout); expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true); };
function oneStep(st: EditorState, what: string, go: () => boolean) {
  const before = JSON.stringify(st.layout);
  expect(go(), what).toBe(true);
  const after = JSON.stringify(st.layout);
  expect(after, what).not.toBe(before);
  ok(st, `${what} (done)`);
  expect(st.undo(), what).toBe(true);
  expect(JSON.stringify(st.layout), `${what} undone in one step`).toBe(before);
  ok(st, `${what} (undone)`);
  expect(st.redo(), what).toBe(true);
  expect(JSON.stringify(st.layout), `${what} redone`).toBe(after);
  ok(st, `${what} (redone)`);
}
const none = (st: EditorState, what: string, go: () => boolean) => {
  const before = JSON.stringify(st.layout);
  expect(go(), what).toBe(false);
  expect(JSON.stringify(st.layout), what).toBe(before);
};

describe("setEdgeColour (pure)", () => {
  const f = () => make().f;
  it("colours the shared edge on both rooms", () => {
    const g = setEdgeColour(f(), "r0", 1, "#aa0000"); // a's east edge, b's west edge
    expect(g.rooms[0].wc).toEqual([null, "#aa0000", null, null]);
    expect(g.rooms[1].wc).toEqual([null, null, null, "#aa0000"]);
    expect(g.owc).toBeUndefined();
  });
  it("a room edge on the outline colours the outline too, or the outline would win", () => {
    const g = setEdgeColour(f(), "r0", 0, "#aa0000"); // a's north edge lies on the outline's first half
    expect(g.rooms[0].wc?.[0]).toBe("#aa0000");
  });
  it("the outline edge colours the rooms that sit on it", () => {
    const g = setEdgeColour(f(), "o", 3, "#00bb00"); // west edge, a's west edge
    expect(g.owc).toEqual([null, null, null, "#00bb00"]);
    expect(g.rooms[0].wc).toEqual([null, null, null, "#00bb00"]);
  });
  it("a free wall carries its own colour", () => {
    const g = setEdgeColour(f(), "w", 0, "#0000cc");
    expect(g.walls[0].color).toBe("#0000cc");
  });
  it("null clears, and the arrays go when nothing is left", () => {
    const g = setEdgeColour(setEdgeColour(f(), "r0", 1, "#aa0000"), "r0", 1, null);
    expect(g.rooms[0].wc).toBeUndefined();
    expect(g.rooms[1].wc).toBeUndefined();
    const w = setEdgeColour(setEdgeColour(f(), "w", 0, "#0000cc"), "w", 0, null);
    expect(w.walls[0]).not.toHaveProperty("color");
  });
  it("unchanged, unknown and a zone's edge return the floor itself", () => {
    const base = f();
    expect(setEdgeColour(base, "r0", 1, null)).toBe(base);
    expect(setEdgeColour(base, "w", 5, "#aa0000")).toBe(base);
    expect(setEdgeColour(base, "nope", 0, "#aa0000")).toBe(base);
    expect(setEdgeColour(base, "r0", 9, "#aa0000")).toBe(base);
    const z = structuredClone(base);
    z.rooms[0].kind = "zone";
    expect(setEdgeColour(z, "r0", 1, "#aa0000")).toBe(z);
  });
});

describe("setWallColour (layout default)", () => {
  it("a built-in colour is stored lower-cased, one step", () => {
    const st = make();
    oneStep(st, "wall", () => st.setWallColour("wall", "#AA0000"));
    expect(st.layout.wallColors).toEqual({ wall: "#aa0000" });
  });
  it("a custom colour joins layout.palette in the same step, once; undo takes both back", () => {
    const st = make();
    oneStep(st, "custom", () => st.setWallColour("external", "#12AB34"));
    expect(st.layout.palette).toEqual(["#12ab34"]);
    st.setWallColour("fence", "#12ab34");
    expect(st.layout.palette).toEqual(["#12ab34"]);
    expect(st.layout.wallColors).toEqual({ external: "#12ab34", fence: "#12ab34" });
  });
  it("the palette stays within its cap", () => {
    const st = make();
    for (let i = 0; i < MAX_PALETTE + 3; i++) st.setWallColour("wall", `#12ab${(10 + i).toString(16)}`.slice(0, 7));
    expect((st.layout.palette ?? []).length).toBeLessThanOrEqual(MAX_PALETTE);
  });
  it("null removes the key; the object goes when empty; none when there is none", () => {
    const st = make({ wallColors: { wall: "#112233" } });
    oneStep(st, "theme default", () => st.setWallColour("wall", null));
    expect(st.layout.wallColors).toBeUndefined();
    none(make(), "again", () => make().setWallColour("wall", null));
  });
  it("the same colour again is no step; junk and unknown keys are refused", () => {
    const st = make({ wallColors: { wall: "#112233" }, palette: ["#112233"] });
    none(st, "same", () => st.setWallColour("wall", "#112233"));
    for (const bad of ["red", "#12345", "#1234567", "112233", "#gggggg", "", "url(x)", '"><script>']) none(st, bad, () => st.setWallColour("wall", bad));
    for (const key of ["parapet", "edge", "__proto__", "constructor", ""]) none(st, key, () => st.setWallColour(key as never, "#112233"));
  });
});

describe("paintEdge (one wall)", () => {
  it("one step for a shared edge: both rooms, the palette, and undo takes all back", () => {
    const st = make();
    oneStep(st, "edge", () => st.paintEdge("r0", 1, "#12AB34"));
    expect(st.f.rooms[0].wc?.[1]).toBe("#12ab34");
    expect(st.f.rooms[1].wc?.[3]).toBe("#12ab34");
    expect(st.layout.palette).toEqual(["#12ab34"]);
  });
  it("a free wall: one step", () => {
    const st = make();
    oneStep(st, "free wall", () => st.paintEdge("w", 0, "#aa0000"));
    expect(st.f.walls[0].color).toBe("#aa0000");
  });
  it("null is the default: one step, none when it is already", () => {
    const st = make();
    st.paintEdge("w", 0, "#aa0000");
    oneStep(st, "default", () => st.paintEdge("w", 0, null));
    none(st, "default again", () => st.paintEdge("w", 0, null));
  });
  it("the same colour again is no step; junk and a missing edge are refused", () => {
    const st = make();
    st.paintEdge("r0", 1, "#aa0000");
    none(st, "same", () => st.paintEdge("r0", 1, "#AA0000"));
    for (const bad of ["red", "#12345", "", "url(x)", '"><script>']) none(st, bad, () => st.paintEdge("r0", 1, bad));
    none(st, "no edge", () => st.paintEdge("r7", 0, "#aa0000"));
    none(st, "no wall", () => st.paintEdge("w", 4, "#aa0000"));
  });
  it("works while the plan is locked: a colour is not geometry", () => {
    const st = make();
    st.planLocked = true;
    expect(st.paintEdge("w", 0, "#aa0000")).toBe(true);
  });
});

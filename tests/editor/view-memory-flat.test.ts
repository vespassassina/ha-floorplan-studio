import { beforeEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { viewBoxFor } from "../../src/core";
import { EditorState } from "../../src/editor/state";
import { parseViewMemory, readViewMemory, writeViewMemory } from "../../src/editor/view-memory";

// S12.1: the editor draws flat only. A view stored by an older editor may say "2.5d", a tilt or a wall mode; none of it
// is read, none of it throws, and the editor opens flat (CLAUDE.md finding 1: storage is untrusted).

const fresh = () => structuredClone(demo) as unknown as Layout;
const OLD = { v: 1, floor: "first", mode: "2.5d", tilt: 0.9, walls: "full", labels: false, rotation: 90 };

beforeEach(() => localStorage.clear());

describe("view memory has no 2.5D", () => {
  it("drops mode, tilt and walls from an old entry and keeps the rest", () => {
    expect(parseViewMemory(OLD)).toEqual({ floor: "first", labels: false, rotation: 90 });
    expect(parseViewMemory(JSON.stringify(OLD))).toEqual({ floor: "first", labels: false, rotation: 90 });
  });

  it("garbage in the old fields never throws and never comes out", () => {
    for (const junk of [5, "x", null, [], {}, true, "2.5d", ["2.5d"]]) {
      const m = parseViewMemory({ mode: junk, tilt: junk, walls: junk });
      expect(m, JSON.stringify(junk)).toEqual({});
    }
    for (const raw of [{ mode: 5, tilt: "x" }, { mode: null, tilt: null }, [{ mode: "2.5d" }], "[\"2.5d\"]"]) {
      expect(() => parseViewMemory(raw), JSON.stringify(raw)).not.toThrow();
      expect(parseViewMemory(raw)).toEqual({});
    }
  });

  it("a stored 2.5d entry in localStorage reads back without it", () => {
    localStorage.setItem("floorplan-studio:view", JSON.stringify(OLD));
    expect(readViewMemory()).toEqual({ floor: "first", labels: false, rotation: 90 });
  });

  it("the state has no view mode, tilt or walls to remember or to import", () => {
    const st = new EditorState(fresh());
    expect(Object.keys(st.exportView()).sort()).toEqual(["floor", "labels"]);
    for (const k of ["viewMode", "tilt", "walls", "preview", "setViewMode", "setTilt", "setWalls"]) expect(k in st, k).toBe(false);
  });

  it("importing an old 2.5d entry, or junk, gives the same view as the entry without those fields", () => {
    for (const memory of [OLD, { mode: 5, tilt: "x", walls: [], rotation: 45 }, { mode: "2.5d", floor: "ground" }]) {
      const rest = { ...(memory as Record<string, unknown>) };
      for (const k of ["mode", "tilt", "walls"]) delete rest[k];
      const a = new EditorState(fresh()), b = new EditorState(fresh());
      expect(() => a.importView(memory as never), JSON.stringify(memory)).not.toThrow();
      b.importView(rest as never);
      a.fit(); b.fit();
      expect(a.view).toEqual(b.view);
      const flat = viewBoxFor(a.f, 80, a.rotation); // the flat fit, whatever the entry said
      expect([a.view.w, a.view.h]).toEqual([flat.w, flat.h]);
    }
  });

  it("writing a memory never stores a mode, tilt or walls", () => {
    const st = new EditorState(fresh());
    writeViewMemory(st.exportView());
    const stored = localStorage.getItem("floorplan-studio:view") ?? "";
    for (const k of ["mode", "tilt", "walls", "2.5d"]) expect(stored, k).not.toContain(k);
  });
});

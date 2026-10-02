import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

const fresh = () => structuredClone(demo) as unknown as Layout;

describe("EditorState view mode", () => {
  beforeEach(() => localStorage.clear());

  it("starts flat and editable, and 2.5D is a preview", () => {
    const st = new EditorState(fresh());
    expect(st.viewMode).toBe("2d");
    expect(st.preview).toBe(false);
    st.setViewMode("2.5d");
    expect(st.preview).toBe(true);
  });

  it("ignores a value that is not a view", () => {
    const st = new EditorState(fresh());
    st.setViewMode("3d" as never);
    st.setViewMode(undefined as never);
    expect(st.viewMode).toBe("2d");
  });

  it("is no undo step, not in the layout, not stored, and leaves the selection and the zoom alone", () => {
    const st = new EditorState(fresh());
    st.sel = { t: "room", i: 1 };
    const zoomed = { ...st.view, w: st.view.w / 2 };
    st.views[st.floor] = zoomed;
    const layout = JSON.stringify(st.layout);
    st.setViewMode("2.5d");
    expect(st.canUndo).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(layout);
    expect(st.sel).toEqual({ t: "room", i: 1 });
    expect(st.views[st.floor]).toEqual(zoomed);
    expect(Object.keys(localStorage).filter((k) => localStorage.getItem(k)?.includes("2.5d"))).toEqual([]);
  });

  it("Fit to window in 2.5D leaves room for the lift: the box is taller than the flat one", () => {
    const st = new EditorState(fresh());
    st.fit();
    const flat = st.view.h;
    st.setViewMode("2.5d");
    st.fit();
    expect(st.view.h).toBeGreaterThan(flat);
  });
});
